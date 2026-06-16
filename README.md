# Pixelate Subject

Local web tool to upload a photo, automatically detect the subject with rembg, refine the selection mask, and apply block pixelation to the subject or background.

## Requirements

- Python 3.10+
- Node.js 18+
- ffmpeg on PATH (for video export)

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
8. Optionally click **Crop** to trim the frame (before or after masking), then **Apply crop**.
9. Set **Video duration**, then click **Generate Video** to download an MP4. Block size animates from 4 px to 64 px (default easing: ease out — slow at the end). Requires ffmpeg on PATH.

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
| Video duration | Length of animated export (1–5 s, default 2 s) |

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check (`ok`, `ffmpeg`) |
| `/api/segment` | POST | Upload image, returns grayscale mask PNG |
| `/api/render-video` | POST | Upload PNG frames + fps, returns MP4 |

## Architecture

- **Frontend** — Vite + TypeScript on port 5173
- **Backend** — FastAPI + rembg on port 8000
- Segmentation and video encoding are server-side; pixelation, mask editing, crop, and frame rendering are client-side.

## Versioning

Releases are automated on push to `main` via [`.github/workflows/release.yml`](.github/workflows/release.yml). Commit messages (on `main`) drive semver:

| Prefix | Bump | Example |
|--------|------|---------|
| `fix:` | patch | `fix: crop epsilon on full frame` |
| `feat:` | minor | `feat: animated MP4 export` |
| `major:` | major | `major: drop legacy mask API` |

Also triggers a major bump: `BREAKING CHANGE` in the body, or `!` after the type (`feat!: …`).

PR titles are checked by [`.github/workflows/pull-request.yml`](.github/workflows/pull-request.yml) (`feat`, `fix`, `major`, `chore`, `docs`, `ci`, `refactor`). Prefer **squash merge** so the PR title becomes the release commit.

Current version is in [`VERSION`](VERSION). To start from `1.0.0`, tag once before the first automated release:

```powershell
git tag v1.0.0
git push origin v1.0.0
```
