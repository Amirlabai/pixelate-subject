# Context

## Purpose

Pixelate Subject is a local web tool for privacy editing: upload a photo, auto-detect the foreground subject with rembg, refine the selection with a brush, optionally crop the frame, apply block pixelation to either the subject or the background, and export a still image or animated MP4.

## Architecture

- **Frontend** — Vite + TypeScript on `http://localhost:5173`
- **Backend** — FastAPI + rembg on `http://localhost:8000`
- Segmentation runs server-side; pixelation, mask editing, crop, and frame rendering run in the browser.
- Video MP4 encoding runs server-side via ffmpeg (`POST /api/render-video` legacy; `POST /api/pixelate-video` renders frames on server then encodes).

## Pixelation compositing

Client-side pixelation (`frontend/src/pixelate.ts`) builds two full-image layers from the saturated composite: sharp and block-pixelated. **Subject** target extends subject colors outward under the mask edge (`fillRadius = ceil(blockSize / 2)`), pixelates that filled image, and composites per block using a dilated inclusion mask so edge blocks reclaim lost real estate (works for multiple mask blobs). **Background** target pixelates the whole image, then overlays the sharp subject masked on top. **Full** target pixelates the entire frame. Saturation edge feather applies only to the saturation blend.

## Key parameters

### Selection (detect + tune)

| Parameter | Default | Notes |
|-----------|---------|-------|
| Detection model | general | general / people / fast |
| Refine edges | off | Alpha matting on re-detect |
| Cutoff | 100 | 30–200, live after detection |
| Grow / shrink | 0 | −12 to +12 px, live after detection |

### Pixelation

| Parameter | Default | Range |
|-----------|---------|-------|
| Pixelate target | subject | subject / background / full |
| Block size | 16 | 4–64 px (still export only; video animates 4→64) |
| Saturation edge feather | 4 | 0–20 px; softens subject/background saturation split only (not pixel block edges) |
| Show selection | on | checkbox |
| Overlay opacity | 40% | 10–80% |
| Brush size | 24 | 5–80 px (shown on canvas) |
| Preview mode | original | original / result |

### Crop

| Parameter | Default | Notes |
|-----------|---------|-------|
| Crop | optional | Available anytime after image load; trims source and mask together |
| Aspect ratio | Free | Free, 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3 — locks resize when set |

### Video export

| Parameter | Default | Notes |
|-----------|---------|-------|
| Duration | 2 s | 1–5 s |
| FPS | 30 | fixed |
| Block animation | 4→64 px | easing: linear, ease in/out, ease in-out, cubic variants (default ease out) |
| Format | MP4 | H.264 via ffmpeg on backend |
| Upload limits | max 150 frames, 200 MB total | PNG magic-byte check on each frame |

## Conventions

- Python: use `.\.venv\Scripts\python.exe` from repo root
- Start both servers: `.\scripts\serve.ps1`
- ffmpeg must be on PATH for video export
- Mask: white = subject, black = background
- Commits: `fix:` patch, `feat:` minor, `major:` major (see README Versioning); CI in `.github/workflows/`
