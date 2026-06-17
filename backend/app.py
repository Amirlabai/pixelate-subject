"""FastAPI application for subject segmentation."""

import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from backend.pixelate import VideoEasing
from backend.segment import MODELS, segment_subject
from backend.video import encode_frame_dir_to_mp4, ffmpeg_available, is_png
from backend.video_jobs import get_job, start_pixelate_video_job

app = FastAPI(title="Pixelate Subject API")

# 5 s @ 30 fps; matches frontend max duration
MAX_VIDEO_FRAMES = 150
MAX_FRAME_BYTES = 15 * 1024 * 1024
MAX_TOTAL_UPLOAD_BYTES = 200 * 1024 * 1024
MAX_SOURCE_BYTES = 25 * 1024 * 1024
VIDEO_EASINGS: tuple[VideoEasing, ...] = (
    "linear",
    "ease-in",
    "ease-out",
    "ease-in-out",
    "ease-in-cubic",
    "ease-out-cubic",
)
PIXELATE_TARGETS = ("subject", "background", "full")

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


@app.post("/api/pixelate-video")
async def pixelate_video_start(
    image: UploadFile = File(...),
    mask: UploadFile | None = File(None),
    target: str = Form("subject"),
    feather: int = Form(4),
    subject_saturation: int = Form(100),
    background_saturation: int = Form(100),
    duration_sec: float = Form(2.0),
    easing: str = Form("ease-out"),
    fps: int = Form(30),
) -> dict[str, str | int]:
    if not ffmpeg_available():
        raise HTTPException(
            status_code=503,
            detail="ffmpeg is not installed or not on PATH",
        )

    if target not in PIXELATE_TARGETS:
        raise HTTPException(status_code=400, detail=f"Unknown target: {target}")

    if easing not in VIDEO_EASINGS:
        raise HTTPException(status_code=400, detail=f"Unknown easing: {easing}")

    if fps < 1 or fps > 120:
        raise HTTPException(status_code=400, detail="fps must be between 1 and 120")

    if duration_sec < 0.5 or duration_sec > 5.0:
        raise HTTPException(status_code=400, detail="duration_sec must be between 0.5 and 5")

    if target != "full" and mask is None:
        raise HTTPException(status_code=400, detail="mask required unless target is full")

    image_data = await image.read()
    if not image_data:
        raise HTTPException(status_code=400, detail="Empty image file")
    if len(image_data) > MAX_SOURCE_BYTES:
        raise HTTPException(status_code=400, detail="Image file too large")

    mask_data: bytes | None = None
    if mask is not None:
        mask_data = await mask.read()
        if not mask_data:
            raise HTTPException(status_code=400, detail="Empty mask file")
        if len(mask_data) > MAX_SOURCE_BYTES:
            raise HTTPException(status_code=400, detail="Mask file too large")

    total_frames = max(2, round(duration_sec * fps))
    if total_frames > MAX_VIDEO_FRAMES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many frames (max {MAX_VIDEO_FRAMES})",
        )

    job_id = start_pixelate_video_job(
        image_data,
        mask_data,
        target,
        feather,
        float(subject_saturation),
        float(background_saturation),
        total_frames,
        easing,  # type: ignore[arg-type]
        fps,
    )
    return {"job_id": job_id, "total_frames": total_frames}


@app.get("/api/pixelate-video/{job_id}")
async def pixelate_video_status(job_id: str) -> dict[str, str | int | bool | None]:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job")

    return {
        "frame": job.frame,
        "total": job.total,
        "phase": job.phase,
        "done": job.phase == "done",
        "error": job.error,
    }


@app.get("/api/pixelate-video/{job_id}/file")
async def pixelate_video_file(job_id: str) -> Response:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job")
    if job.phase == "error":
        raise HTTPException(status_code=500, detail=job.error or "Video job failed")
    if job.phase != "done" or job.mp4_bytes is None:
        raise HTTPException(status_code=409, detail="Video not ready")

    return Response(content=job.mp4_bytes, media_type="video/mp4")
