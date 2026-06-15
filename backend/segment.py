"""rembg-based subject segmentation."""

from io import BytesIO

import numpy as np
from PIL import Image
from rembg import new_session, remove

MODELS: dict[str, str] = {
    "general": "u2net",
    "people": "u2net_human_seg",
    "fast": "u2netp",
}

_sessions: dict[str, object] = {}


def _get_session(model_key: str):
    model_name = MODELS.get(model_key, MODELS["general"])
    if model_name not in _sessions:
        _sessions[model_name] = new_session(model_name)
    return _sessions[model_name]


def segment_subject(
    image_bytes: bytes,
    model: str = "general",
    alpha_matting: bool = False,
) -> bytes:
    """Return a grayscale PNG mask (white=subject, black=background)."""
    source = Image.open(BytesIO(image_bytes)).convert("RGB")
    original_size = source.size

    session = _get_session(model)
    cutout = remove(
        source,
        session=session,
        alpha_matting=alpha_matting,
        post_process_mask=True,
    )
    if isinstance(cutout, bytes):
        cutout = Image.open(BytesIO(cutout)).convert("RGBA")
    else:
        cutout = cutout.convert("RGBA")

    if cutout.size != original_size:
        cutout = cutout.resize(original_size, Image.Resampling.LANCZOS)

    alpha = np.array(cutout.split()[-1], dtype=np.uint8)
    mask = Image.fromarray(alpha, mode="L")
    out = BytesIO()
    mask.save(out, format="PNG")
    return out.getvalue()
