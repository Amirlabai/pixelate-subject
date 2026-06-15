# Pixelate Subject

Local web tool to upload a photo, automatically detect the subject with rembg, refine the selection mask, and apply block pixelation to the subject or background.

## Requirements

- Python 3.10+
- Node.js 18+

## Quick start

From the repository root:

```powershell
.\scripts\serve.ps1
```

Then open [http://localhost:5173](http://localhost:5173).

The first "Detect Subject" run downloads the rembg model (~170 MB). The backend may take up to a minute to start while rembg loads.

## Manual setup

### Backend

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.app:app --reload --port 8000
```

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

## Usage

1. Upload a JPEG, PNG, or WebP image.
2. Click **Detect Subject** to generate a mask with rembg.
3. Tune **Cutoff** and **Grow / shrink** for a better fit without brushing.
4. Toggle **Show selection overlay** and refine with add/remove brush if needed.
5. Set **Pixelate target** to Subject or Background.
6. Adjust **Block size** and **Edge feather**.
7. Click **Apply Pixelation**, switch preview to **Result**, and **Download Result**.

## Parameters

| Parameter | Description |
|-----------|-------------|
| Detection model | General, People (portraits), or Fast |
| Refine edges | Alpha matting on detect (slower, cleaner edges) |
| Cutoff | Tighten or loosen the selection after detect |
| Grow / shrink | Expand or contract the mask by pixels |
| Pixelate target | Subject, Background, or Full image (no mask needed) |
| Block size | Pixel block size in pixels (4–64) |
| Edge feather | Softens the mask edge before compositing (0–20 px) |
| Show selection | Green overlay on detected subject |
| Overlay opacity | Strength of the selection overlay |
| Brush size | Mask refinement stroke width (circle shown on image) |
| Preview | Original (with overlay) or Result |

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/segment` | POST | Upload image, returns grayscale mask PNG |

## Architecture

- **Frontend** — Vite + TypeScript on port 5173
- **Backend** — FastAPI + rembg on port 8000
- Segmentation is server-side; pixelation and mask editing are client-side.
