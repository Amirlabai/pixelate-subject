"""Server-side pixelation (mirrors frontend/src/pixelate.ts)."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from io import BytesIO
from typing import Literal

import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import binary_dilation, distance_transform_edt

PixelateTarget = Literal["subject", "background", "full"]
VideoEasing = Literal[
    "linear",
    "ease-in",
    "ease-out",
    "ease-in-out",
    "ease-in-cubic",
    "ease-out-cubic",
]

BLOCK_MIN = 4
BLOCK_MAX = 64


def load_rgb(data: bytes) -> np.ndarray:
    return np.array(Image.open(BytesIO(data)).convert("RGB"), dtype=np.uint8)


def load_mask_gray(data: bytes) -> np.ndarray:
    return np.array(Image.open(BytesIO(data)).convert("L"), dtype=np.uint8)


def _adjust_saturation(rgb: np.ndarray, percent: float) -> np.ndarray:
    amount = percent / 100.0
    gray = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    out = gray[..., None] + (rgb - gray[..., None]) * amount
    return np.clip(np.round(out), 0, 255).astype(np.uint8)


def _feather_mask(mask_gray: np.ndarray, radius: int) -> np.ndarray:
    if radius <= 0:
        return mask_gray.astype(np.float32) / 255.0
    img = Image.fromarray(mask_gray, mode="L")
    blurred = img.filter(ImageFilter.GaussianBlur(radius=radius))
    return np.array(blurred, dtype=np.float32) / 255.0


def _build_saturated_composite(
    source_rgb: np.ndarray,
    feathered: np.ndarray | None,
    subject_saturation: float,
    background_saturation: float,
) -> np.ndarray:
    sub = _adjust_saturation(source_rgb, subject_saturation)
    bg = _adjust_saturation(source_rgb, background_saturation)
    if feathered is None:
        return sub.copy()
    m = feathered[..., None]
    blended = bg * (1.0 - m) + sub * m
    return np.clip(np.round(blended), 0, 255).astype(np.uint8)


def _pixelate_fast(rgb: np.ndarray, block_size: int) -> np.ndarray:
    h, w, c = rgb.shape
    out = rgb.copy()
    for by in range(0, h, block_size):
        for bx in range(0, w, block_size):
            bh = min(block_size, h - by)
            bw = min(block_size, w - bx)
            mean = np.round(rgb[by : by + bh, bx : bx + bw].mean(axis=(0, 1))).astype(np.uint8)
            out[by : by + bh, bx : bx + bw] = mean
    return out


def _dilate_binary_mask(mask_gray: np.ndarray, radius: int, threshold: int = 128) -> np.ndarray:
    if radius <= 0:
        return mask_gray
    binary = mask_gray >= threshold
    dilated = binary_dilation(binary, iterations=radius)
    return (dilated.astype(np.uint8) * 255)


def _fill_outward_under_mask(
    rgb: np.ndarray,
    mask_gray: np.ndarray,
    radius: int,
    threshold: int = 128,
) -> np.ndarray:
    if radius <= 0:
        return rgb.copy()
    in_mask = mask_gray >= threshold
    outside = ~in_mask
    dist, indices = distance_transform_edt(outside, return_indices=True)
    ring = outside & (dist <= radius)
    out = rgb.copy()
    out[ring] = rgb[indices[0][ring], indices[1][ring]]
    return out


def _composite_block_aligned(
    sharp: np.ndarray,
    pixelated: np.ndarray,
    mask_gray: np.ndarray,
    block_size: int,
    target: PixelateTarget,
    threshold: int = 128,
) -> np.ndarray:
    h, w, _ = sharp.shape
    out = np.empty_like(sharp)
    for by in range(0, h, block_size):
        for bx in range(0, w, block_size):
            bh = min(block_size, h - by)
            bw = min(block_size, w - bx)
            cx = bx + bw // 2
            cy = by + bh // 2
            in_subject = mask_gray[cy, cx] >= threshold
            use_pixelated = in_subject if target == "subject" else not in_subject
            src = pixelated if use_pixelated else sharp
            out[by : by + bh, bx : bx + bw] = src[by : by + bh, bx : bx + bw]
    return out


def _composite_background_overlay(
    sharp: np.ndarray,
    pixelated: np.ndarray,
    mask_gray: np.ndarray,
) -> np.ndarray:
    alpha = mask_gray.astype(np.float32) / 255.0
    blended = pixelated.astype(np.float32) * (1.0 - alpha[..., None]) + sharp.astype(
        np.float32
    ) * alpha[..., None]
    return np.clip(np.round(blended), 0, 255).astype(np.uint8)


@dataclass
class PixelatePrepared:
    saturated: np.ndarray
    mask_gray: np.ndarray | None
    target: PixelateTarget
    dilate_cache: dict[int, np.ndarray] = field(default_factory=dict)

    def inclusion_mask(self, fill_radius: int) -> np.ndarray:
        if fill_radius not in self.dilate_cache:
            assert self.mask_gray is not None
            self.dilate_cache[fill_radius] = _dilate_binary_mask(
                self.mask_gray, fill_radius
            )
        return self.dilate_cache[fill_radius]


def prepare_pixelation(
    source_rgb: np.ndarray,
    mask_gray: np.ndarray | None,
    target: PixelateTarget,
    feather: int,
    subject_saturation: float,
    background_saturation: float,
) -> PixelatePrepared:
    feathered = _feather_mask(mask_gray, feather) if mask_gray is not None else None
    saturated = _build_saturated_composite(
        source_rgb,
        feathered,
        subject_saturation,
        background_saturation,
    )
    return PixelatePrepared(saturated, mask_gray, target)


def render_frame(prepared: PixelatePrepared, block_size: int) -> np.ndarray:
    if prepared.target == "full" or prepared.mask_gray is None:
        return _pixelate_fast(prepared.saturated, block_size)

    if prepared.target == "subject":
        fill_radius = math.ceil(block_size / 2)
        filled = _fill_outward_under_mask(
            prepared.saturated, prepared.mask_gray, fill_radius
        )
        pixelated = _pixelate_fast(filled, block_size)
        inclusion = prepared.inclusion_mask(fill_radius)
        return _composite_block_aligned(
            prepared.saturated,
            pixelated,
            inclusion,
            block_size,
            "subject",
        )

    pixelated = _pixelate_fast(prepared.saturated, block_size)
    return _composite_background_overlay(
        prepared.saturated, pixelated, prepared.mask_gray
    )


def apply_pixelation(
    source_rgb: np.ndarray,
    mask_gray: np.ndarray | None,
    target: PixelateTarget,
    block_size: int,
    feather: int,
    subject_saturation: float,
    background_saturation: float,
) -> np.ndarray:
    prepared = prepare_pixelation(
        source_rgb,
        mask_gray,
        target,
        feather,
        subject_saturation,
        background_saturation,
    )
    return render_frame(prepared, block_size)


def apply_easing(t: float, easing: VideoEasing) -> float:
    clamped = max(0.0, min(1.0, t))
    if easing == "linear":
        return clamped
    if easing == "ease-in":
        return clamped * clamped
    if easing == "ease-out":
        return 1.0 - (1.0 - clamped) ** 2
    if easing == "ease-in-out":
        return (
            2 * clamped * clamped
            if clamped < 0.5
            else 1 - ((-2 * clamped + 2) ** 2) / 2
        )
    if easing == "ease-in-cubic":
        return clamped**3
    if easing == "ease-out-cubic":
        return 1 - (1 - clamped) ** 3
    return clamped


def block_size_for_frame(
    frame_index: int,
    total_frames: int,
    easing: VideoEasing = "ease-out",
) -> int:
    if total_frames <= 1:
        return BLOCK_MAX
    t = frame_index / (total_frames - 1)
    eased = apply_easing(t, easing)
    return round(BLOCK_MIN + eased * (BLOCK_MAX - BLOCK_MIN))
