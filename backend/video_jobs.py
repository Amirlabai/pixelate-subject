"""Background pixelate-video jobs with progress."""

from __future__ import annotations

import tempfile
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from PIL import Image

from backend.pixelate import (
    VideoEasing,
    block_size_for_frame,
    load_mask_gray,
    load_rgb,
    prepare_pixelation,
    render_frame,
)
from backend.video import encode_frame_dir_to_mp4

JobPhase = Literal["queued", "rendering", "encoding", "done", "error"]


@dataclass
class VideoJob:
    frame: int = 0
    total: int = 0
    phase: JobPhase = "queued"
    error: str | None = None
    mp4_bytes: bytes | None = None


_jobs: dict[str, VideoJob] = {}
_lock = threading.Lock()


def get_job(job_id: str) -> VideoJob | None:
    with _lock:
        return _jobs.get(job_id)


def _set_job(job_id: str, **kwargs: object) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        for key, value in kwargs.items():
            setattr(job, key, value)


def _delete_job_later(job_id: str, delay_sec: float = 300.0) -> None:
    def _cleanup() -> None:
        import time

        time.sleep(delay_sec)
        with _lock:
            _jobs.pop(job_id, None)

    threading.Thread(target=_cleanup, daemon=True).start()


def _run_job(
    job_id: str,
    image_data: bytes,
    mask_data: bytes | None,
    target: str,
    feather: int,
    subject_saturation: float,
    background_saturation: float,
    total_frames: int,
    easing: VideoEasing,
    fps: int,
) -> None:
    try:
        source_rgb = load_rgb(image_data)
        mask_gray = load_mask_gray(mask_data) if mask_data else None
        if mask_gray is not None and mask_gray.shape[:2] != source_rgb.shape[:2]:
            raise ValueError("Mask size must match image")

        prepared = prepare_pixelation(
            source_rgb,
            mask_gray,
            target,  # type: ignore[arg-type]
            feather,
            subject_saturation,
            background_saturation,
        )

        _set_job(job_id, total=total_frames, phase="rendering", frame=0)

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            for i in range(total_frames):
                block_size = block_size_for_frame(i, total_frames, easing)
                frame_rgb = render_frame(prepared, block_size)
                Image.fromarray(frame_rgb, mode="RGB").save(
                    tmp_path / f"frame_{i:04d}.jpg",
                    format="JPEG",
                    quality=92,
                    optimize=False,
                )
                _set_job(job_id, frame=i + 1)

            _set_job(job_id, phase="encoding")
            mp4 = encode_frame_dir_to_mp4(
                tmp_path, total_frames, fps=fps, frame_pattern="frame_%04d.jpg"
            )

        _set_job(job_id, phase="done", mp4_bytes=mp4)
    except Exception as exc:
        _set_job(job_id, phase="error", error=str(exc))


def start_pixelate_video_job(
    image_data: bytes,
    mask_data: bytes | None,
    target: str,
    feather: int,
    subject_saturation: float,
    background_saturation: float,
    total_frames: int,
    easing: VideoEasing,
    fps: int,
) -> str:
    job_id = uuid.uuid4().hex
    with _lock:
        _jobs[job_id] = VideoJob()
    thread = threading.Thread(
        target=_run_job,
        args=(
            job_id,
            image_data,
            mask_data,
            target,
            feather,
            subject_saturation,
            background_saturation,
            total_frames,
            easing,
            fps,
        ),
        daemon=True,
    )
    thread.start()
    _delete_job_later(job_id)
    return job_id
