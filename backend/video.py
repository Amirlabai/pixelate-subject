"""Video encoding via ffmpeg."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

FFMPEG_TIMEOUT_SEC = 120
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def is_png(data: bytes) -> bool:
    return len(data) >= len(PNG_SIGNATURE) and data[: len(PNG_SIGNATURE)] == PNG_SIGNATURE


def encode_frame_dir_to_mp4(frame_dir: Path, frame_count: int, fps: int = 30) -> bytes:
    if frame_count < 1:
        raise ValueError("No frames provided")
    if not ffmpeg_available():
        raise RuntimeError("ffmpeg is not installed or not on PATH")

    out_path = frame_dir / "out.mp4"
    cmd = [
        "ffmpeg",
        "-y",
        "-framerate",
        str(fps),
        "-i",
        str(frame_dir / "frame_%04d.png"),
        "-frames:v",
        str(frame_count),
        "-vf",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        str(out_path),
    ]

    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=FFMPEG_TIMEOUT_SEC)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("ffmpeg timed out") from exc
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.decode("utf-8", errors="replace") if exc.stderr else ""
        raise RuntimeError(f"ffmpeg failed: {stderr}") from exc

    return out_path.read_bytes()


def encode_frames_to_mp4(frames: list[bytes], fps: int = 30) -> bytes:
    # ponytail: list API kept for simple callers; writes to temp dir before ffmpeg
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        for i, data in enumerate(frames):
            (tmp_path / f"frame_{i:04d}.png").write_bytes(data)
        return encode_frame_dir_to_mp4(tmp_path, len(frames), fps=fps)
