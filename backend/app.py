"""FastAPI application for subject segmentation."""

import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from backend.segment import MODELS, segment_subject
from backend.video import encode_frame_dir_to_mp4, ffmpeg_available, is_png

app = FastAPI(title="Pixelate Subject API")

# 5 s @ 30 fps; matches frontend max duration
MAX_VIDEO_FRAMES = 150
MAX_FRAME_BYTES = 15 * 1024 * 1024
MAX_TOTAL_UPLOAD_BYTES = 200 * 1024 * 1024

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, bool]:
    return {"ok": True, "ffmpeg": ffmpeg_available()}


@app.post("/api/segment")
async def segment(
    image: UploadFile = File(...),
    model: str = Form("general"),
    alpha_matting: str = Form("false"),
) -> Response:
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Expected an image file")

    if model not in MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown model: {model}")

    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    use_matting = alpha_matting.lower() in ("true", "1", "on", "yes")

    try:
        mask_png = segment_subject(data, model=model, alpha_matting=use_matting)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Segmentation failed: {exc}") from exc

    return Response(content=mask_png, media_type="image/png")


@app.post("/api/render-video")
async def render_video(
    fps: int = Form(30),
    # Repeated multipart field name "frames" — client must send one part per PNG
    frames: list[UploadFile] = File(...),
) -> Response:
    if not ffmpeg_available():
        raise HTTPException(
            status_code=503,
            detail="ffmpeg is not installed or not on PATH",
        )

    if not frames:
        raise HTTPException(status_code=400, detail="No frames provided")

    if len(frames) > MAX_VIDEO_FRAMES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many frames (max {MAX_VIDEO_FRAMES})",
        )

    if fps < 1 or fps > 120:
        raise HTTPException(status_code=400, detail="fps must be between 1 and 120")

    total_bytes = 0
    frame_count = 0

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)

        for i, upload in enumerate(frames):
            data = await upload.read()
            if not data:
                raise HTTPException(status_code=400, detail="Empty frame file")

            if len(data) > MAX_FRAME_BYTES:
                raise HTTPException(status_code=400, detail="Frame file too large")

            if not is_png(data):
                raise HTTPException(status_code=400, detail="Each frame must be a PNG image")

            total_bytes += len(data)
            if total_bytes > MAX_TOTAL_UPLOAD_BYTES:
                raise HTTPException(status_code=400, detail="Total upload size too large")

            (tmp_path / f"frame_{i:04d}.png").write_bytes(data)
            frame_count += 1

        try:
            mp4 = encode_frame_dir_to_mp4(tmp_path, frame_count, fps=fps)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return Response(content=mp4, media_type="video/mp4")
