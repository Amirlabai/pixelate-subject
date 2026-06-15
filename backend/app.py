"""FastAPI application for subject segmentation."""

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from backend.segment import MODELS, segment_subject

app = FastAPI(title="Pixelate Subject API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, bool]:
    return {"ok": True}


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
