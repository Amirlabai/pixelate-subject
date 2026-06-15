# Context

## Purpose

Pixelate Subject is a local web tool for privacy editing: upload a photo, auto-detect the foreground subject with rembg, refine the selection with a brush, and apply block pixelation to either the subject or the background.

## Architecture

- **Frontend** — Vite + TypeScript on `http://localhost:5173`
- **Backend** — FastAPI + rembg on `http://localhost:8000`
- Segmentation runs server-side; pixelation and mask editing run in the browser.

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
| Block size | 16 | 4–64 px |
| Edge feather | 4 | 0–20 px |
| Show selection | on | checkbox |
| Overlay opacity | 40% | 10–80% |
| Brush size | 24 | 5–80 px (shown on canvas) |
| Preview mode | original | original / result |

## Conventions

- Python: use `.\.venv\Scripts\python.exe` from repo root
- Start both servers: `.\scripts\serve.ps1`
- Mask: white = subject, black = background
