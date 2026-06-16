# Status

## Objectives

- [x] Localhost web UI for photo upload, subject detection, mask editing, and pixelation
- [x] Python backend with rembg segmentation
- [x] Client-side pixelation with subject/background toggle
- [x] General crop tool (source + mask)
- [x] Animated MP4 export (30 fps, block 4→64 px ease-out default, ffmpeg)

## Completed

- Project scaffold (backend, frontend, scripts)
- FastAPI `/api/health`, `/api/segment`, `/api/render-video`
- Vite frontend with upload, params, canvas, mask editor, crop, video export
- `scripts/serve.ps1` launcher
- `backend/video.py` ffmpeg encoder
- `frontend/src/crop-editor.ts`, `frontend/src/video-export.ts`
- Smoke test (API health/segment/video, UI upload/detect/pixelate/crop/video; ffmpeg on PATH)
- Smoke test + review fixes (upload caps, PNG validation, ffmpeg timeout, easing docs, crop/video UX guards)
- UX/a11y pass: panel reorder, keyboard help, focus rings, empty state, fieldsets, aria labels, select single-source
- Semantic release GitHub Actions (`fix`/`feat`/`major` → semver tags + releases)

## Next steps

- [ ] Manual test with varied real photos (portraits, objects, busy backgrounds) on your machine
- [ ] Optional: polygon lasso — YAGNI unless brush + cutoff/grow fail on real photos
- [ ] Optional: server-side full-resolution export — YAGNI unless canvas resolution proves too low
