import { checkHealth, loadImageFromBlob, loadImageFromFile, segmentImage } from "./api";
import { CanvasView } from "./canvas-view";
import {
  applyCropToCanvas,
  applyCropToImageData,
  CROP_ASPECT_PRESETS,
  CropEditor,
  fullImageCrop,
  isCropAspectPreset,
} from "./crop-editor";
import { MaskEditor } from "./mask-editor";
import { imageDataFromMaskImage, processMask } from "./mask-postprocess";
import { applyPixelation, createSourceCanvas } from "./pixelate";
import {
  createDefaultParams,
  createInitialState,
  fitPreviewSize,
  type AppParams,
  type AppState,
  type BrushMode,
} from "./state";
import { exportPixelateVideo, isVideoEasing, VIDEO_EASING_OPTIONS } from "./video-export";
import { WebcamCapture } from "./webcam";

function getEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function getElAs<T extends HTMLElement>(id: string): T {
  return getEl(id) as T;
}

function populateSelect(
  selectId: string,
  options: { id: string; label: string }[],
  selectedId?: string,
): void {
  const select = getElAs<HTMLSelectElement>(selectId);
  select.replaceChildren();
  for (const opt of options) {
    const el = document.createElement("option");
    el.value = opt.id;
    el.textContent = opt.label;
    if (selectedId !== undefined && opt.id === selectedId) {
      el.selected = true;
    }
    select.appendChild(el);
  }
}

class App {
  private state: AppState = createInitialState();
  private sourceCanvas: HTMLCanvasElement | null = null;
  private maskEditor: MaskEditor | null = null;
  private rawMaskData: ImageData | null = null;
  private canvasView: CanvasView;
  private lastPaint: { x: number; y: number } | null = null;
  private isPainting = false;
  private tuneTimer: ReturnType<typeof setTimeout> | null = null;
  private webcam = new WebcamCapture();
  private cropEditor: CropEditor | null = null;
  private ffmpegAvailable = false;
  private isGeneratingVideo = false;
  private isApplyingPixelation = false;

  constructor() {
    const canvas = getElAs<HTMLCanvasElement>("main-canvas");
    const cursorCanvas = getElAs<HTMLCanvasElement>("brush-cursor");
    this.canvasView = new CanvasView(canvas, cursorCanvas);
    populateSelect(
      "param-crop-aspect",
      CROP_ASPECT_PRESETS.map((p) => ({ id: p.id, label: p.label })),
      "free",
    );
    populateSelect(
      "param-video-easing",
      VIDEO_EASING_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
      "ease-out",
    );
    getEl("app-version").textContent = `v${__APP_VERSION__}`;
    this.bindUi();
    this.setStatus("Connecting to backend…", "busy");
    void this.initHealth();
  }

  private async initHealth(): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const health = await checkHealth();
      if (health.ok) {
        this.ffmpegAvailable = health.ffmpeg;
        if (!health.ffmpeg) {
          this.setStatus("Backend ready. Video export needs ffmpeg on PATH.", "warn");
        } else {
          this.setStatus("Backend ready. Import a photo to start.");
        }
        this.updateButtons();
        return;
      }
      if (attempt < 29) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    this.setStatus("Backend not reachable. Run scripts/serve.ps1 first.", "error");
    this.updateButtons();
  }

  private async refreshHealth(): Promise<void> {
    const health = await checkHealth();
    if (health.ok) {
      this.ffmpegAvailable = health.ffmpeg;
      this.updateButtons();
    }
  }

  private bindUi(): void {
    const dropZone = getEl("drop-zone");
    const fileInput = getElAs<HTMLInputElement>("file-input");

    dropZone.addEventListener("click", () => fileInput.click());
    dropZone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileInput.click();
      }
    });

    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) void this.loadFile(file);
    });

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith("image/")) void this.loadFile(file);
    });

    getEl("btn-webcam").addEventListener("click", () => void this.startWebcam());
    getEl("btn-webcam-capture").addEventListener("click", () => void this.captureWebcam());
    getEl("btn-webcam-cancel").addEventListener("click", () => this.stopWebcam());

    getEl("btn-detect").addEventListener("click", () => void this.detectSubject());
    getEl("btn-apply").addEventListener("click", () => void this.applyPixelation());
    getEl("btn-reset-mask").addEventListener("click", () => this.resetMask());
    getEl("btn-download").addEventListener("click", () => this.downloadResult());
    getEl("btn-generate-video").addEventListener("click", () => void this.generateVideo());
    getEl("btn-undo").addEventListener("click", () => this.undoMask());

    getEl("btn-crop").addEventListener("click", () => this.enterCropMode());
    getEl("btn-crop-apply").addEventListener("click", () => this.applyCrop());
    getEl("btn-crop-cancel").addEventListener("click", () => this.cancelCrop());

    getElAs<HTMLSelectElement>("param-crop-aspect").addEventListener("change", (e) => {
      if (!this.cropEditor) return;
      const value = (e.target as HTMLSelectElement).value;
      if (isCropAspectPreset(value)) {
        this.cropEditor.setAspectPreset(value);
        this.redraw();
      }
    });

    getEl("brush-add").addEventListener("click", () => this.setBrushMode("add"));
    getEl("brush-remove").addEventListener("click", () => this.setBrushMode("remove"));

    getElAs<HTMLSelectElement>("param-model").addEventListener("change", (e) => {
      const value = (e.target as HTMLSelectElement).value;
      if (value === "general" || value === "people" || value === "fast") {
        this.state.params.segmentModel = value;
      }
    });

    getElAs<HTMLInputElement>("param-alpha-matting").addEventListener("change", (e) => {
      this.state.params.alphaMatting = (e.target as HTMLInputElement).checked;
    });

    this.bindParam("param-block-size", "val-block-size", "blockSize", (v) => `${v}`, undefined, (v) => `${v} pixels`);
    this.bindParam("param-feather", "val-feather", "feather", (v) => `${v}`, undefined, (v) => `${v} pixels`);
    this.bindParam("param-subject-sat", "val-subject-sat", "subjectSaturation", (v) => `${v}`, undefined, (v) => `${v} percent`);
    this.bindParam("param-background-sat", "val-background-sat", "backgroundSaturation", (v) => `${v}`, undefined, (v) => `${v} percent`);
    this.bindParam("param-overlay", "val-overlay", "overlayOpacity", (v) => `${v}`, undefined, (v) => `${v} percent`);
    this.bindParam("param-brush", "val-brush", "brushSize", (v) => `${v}`, () => {
      this.updateBrushCursorFromLastEvent();
    }, (v) => `${v} pixels`);
    this.bindParam("param-video-duration", "val-video-duration", "videoDurationSec", (v) => `${v}`, undefined, (v) => `${v} seconds`);

    getElAs<HTMLSelectElement>("param-video-easing").addEventListener("change", (e) => {
      const value = (e.target as HTMLSelectElement).value;
      if (isVideoEasing(value)) {
        this.state.params.videoEasing = value;
      }
    });

    this.bindMaskTuneParam("param-threshold", "val-threshold", "maskThreshold");
    this.bindMaskTuneParam("param-expand", "val-expand", "maskExpand", (v) => `${v}`);

    getElAs<HTMLInputElement>("param-show-selection").addEventListener("change", (e) => {
      this.state.params.showSelection = (e.target as HTMLInputElement).checked;
      this.redraw();
    });

    document.querySelectorAll('input[name="target"]').forEach((el) => {
      el.addEventListener("change", (e) => {
        const value = (e.target as HTMLInputElement).value;
        if (value === "subject" || value === "background" || value === "full") {
          this.state.params.target = value;
          this.updateButtons();
          if (this.state.hasResult) void this.applyPixelation(false);
        }
      });
    });

    document.querySelectorAll('input[name="preview"]').forEach((el) => {
      el.addEventListener("change", (e) => {
        const value = (e.target as HTMLInputElement).value;
        if (value === "original" || value === "result") {
          if (value === "result" && !this.state.hasResult) {
            getElAs<HTMLInputElement>("preview-original").checked = true;
            this.setStatus("Apply pixelation first to preview the result.");
            return;
          }
          this.state.params.previewMode = value;
          this.redraw();
          if (value === "result") this.canvasView.hideBrushCursor();
        }
      });
    });

    const canvas = getElAs<HTMLCanvasElement>("main-canvas");
    canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    canvas.addEventListener("pointerup", () => this.onPointerUp());
    canvas.addEventListener("pointerleave", () => {
      this.onPointerUp();
      this.canvasView.hideBrushCursor();
    });
    canvas.addEventListener("pointerenter", (e) => this.showBrushCursor(e));

    document.addEventListener("keydown", (e) => this.onKeyDown(e));
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!e.ctrlKey) return;

    const key = e.key.toLowerCase();
    if (key === "z") {
      e.preventDefault();
      this.undoMask();
      return;
    }

    if (key === "0") {
      e.preventDefault();
      this.canvasView.resetZoomToDefault();
      return;
    }

    if (key === "=" || key === "+") {
      e.preventDefault();
      this.canvasView.zoomIn();
      return;
    }

    if (key === "-") {
      e.preventDefault();
      this.canvasView.zoomOut();
    }
  }

  private lastPointer: PointerEvent | null = null;

  private showBrushCursor(e: PointerEvent): void {
    if (this.state.cropMode) return;
    this.lastPointer = e;
    this.canvasView.updateBrushCursor(
      e.clientX,
      e.clientY,
      this.state.params,
      this.state.brushMode,
      !!this.sourceCanvas && this.state.params.previewMode !== "result",
    );
  }

  private updateBrushCursorFromLastEvent(): void {
    if (!this.lastPointer) return;
    this.showBrushCursor(this.lastPointer);
  }

  private bindParam(
    inputId: string,
    labelId: string,
    key: keyof AppParams,
    format: (v: number) => string,
    onChange?: () => void,
    valueText?: (v: number) => string,
  ): void {
    const input = getElAs<HTMLInputElement>(inputId);
    const label = getEl(labelId);
    const defaults = createDefaultParams();

    const apply = (value: number) => {
      input.value = String(value);
      (this.state.params as unknown as Record<string, number>)[key] = value;
      label.textContent = format(value);
      input.setAttribute("aria-valuetext", valueText ? valueText(value) : format(value));
      if (
        key === "feather" ||
        key === "subjectSaturation" ||
        key === "backgroundSaturation"
      ) {
        if (this.state.hasResult) {
          void this.applyPixelation(false);
        }
      }
      if (key === "overlayOpacity") this.redraw();
      onChange?.();
    };

    input.addEventListener("input", () => apply(Number(input.value)));
    if (key === "blockSize") {
      input.addEventListener("change", () => {
        if (this.state.hasResult) void this.applyPixelation(false);
      });
    }
    input.addEventListener("dblclick", (e) => {
      e.preventDefault();
      apply(defaults[key] as number);
      if (key === "blockSize" && this.state.hasResult) {
        void this.applyPixelation(false);
      }
    });
  }

  private bindMaskTuneParam(
    inputId: string,
    labelId: string,
    key: "maskThreshold" | "maskExpand",
    format: (v: number) => string = (v) => `${v}`,
  ): void {
    const input = getElAs<HTMLInputElement>(inputId);
    const label = getEl(labelId);
    const defaults = createDefaultParams();

    const apply = (value: number) => {
      input.value = String(value);
      this.state.params[key] = value;
      label.textContent = format(value);
      input.setAttribute("aria-valuetext", format(value));
      this.scheduleMaskTune();
    };

    input.addEventListener("input", () => apply(Number(input.value)));
    input.addEventListener("dblclick", (e) => {
      e.preventDefault();
      apply(defaults[key]);
    });
  }

  private scheduleMaskTune(): void {
    if (!this.rawMaskData) return;
    if (this.tuneTimer) clearTimeout(this.tuneTimer);
    this.tuneTimer = setTimeout(() => this.applyMaskTune(), 80);
  }

  private applyMaskTune(): void {
    if (!this.rawMaskData || !this.maskEditor) return;
    const tuned = processMask(
      this.rawMaskData,
      this.state.params.maskThreshold,
      this.state.params.maskExpand,
    );
    this.maskEditor.restoreOriginal(tuned);
    this.state.hasResult = false;
    this.canvasView.setResult(null);
    this.redraw();
    this.updateButtons();
  }

  private setMaskTuneEnabled(enabled: boolean): void {
    getElAs<HTMLInputElement>("param-threshold").disabled = !enabled;
    getElAs<HTMLInputElement>("param-expand").disabled = !enabled;
  }

  private resetMaskTuneUi(): void {
    const defaults = createDefaultParams();
    this.state.params.maskThreshold = defaults.maskThreshold;
    this.state.params.maskExpand = defaults.maskExpand;
    getElAs<HTMLInputElement>("param-threshold").value = String(defaults.maskThreshold);
    getElAs<HTMLInputElement>("param-expand").value = String(defaults.maskExpand);
    getEl("val-threshold").textContent = String(defaults.maskThreshold);
    getEl("val-expand").textContent = String(defaults.maskExpand);
  }

  private flushUi(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }

  private setStatus(message: string, kind: "" | "error" | "busy" | "warn" = ""): void {
    const el = getEl("status");
    el.textContent = message;
    el.className = "status" + (kind ? ` ${kind}` : "");
    el.setAttribute("role", kind === "error" ? "alert" : "status");
    el.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
  }

  private setBrushMode(mode: BrushMode): void {
    this.state.brushMode = mode;
    getEl("brush-add").classList.toggle("active", mode === "add");
    getEl("brush-remove").classList.toggle("active", mode === "remove");
    getElAs<HTMLButtonElement>("brush-add").setAttribute("aria-pressed", mode === "add" ? "true" : "false");
    getElAs<HTMLButtonElement>("brush-remove").setAttribute("aria-pressed", mode === "remove" ? "true" : "false");
    this.updateBrushCursorFromLastEvent();
  }

  private updateButtons(): void {
    const hasImage = !!this.sourceCanvas;
    const hasSelection = this.maskEditor?.hasSelection() ?? false;
    const needsMask = this.state.params.target !== "full";
    const inCrop = this.state.cropMode;
    getElAs<HTMLButtonElement>("btn-detect").disabled = !hasImage || inCrop;
    getElAs<HTMLButtonElement>("btn-apply").disabled =
      !hasImage || (needsMask && !hasSelection) || inCrop || this.isApplyingPixelation || this.isGeneratingVideo;
    getElAs<HTMLButtonElement>("btn-reset-mask").disabled =
      !hasImage || (!hasSelection && !this.rawMaskData) || inCrop;
    getElAs<HTMLButtonElement>("btn-download").disabled = !this.state.hasResult || inCrop;
    getElAs<HTMLInputElement>("preview-result").disabled = !this.state.hasResult || inCrop;
    if (!this.state.hasResult && this.state.params.previewMode === "result") {
      this.state.params.previewMode = "original";
      getElAs<HTMLInputElement>("preview-original").checked = true;
    }
    getElAs<HTMLButtonElement>("btn-generate-video").disabled =
      !hasImage ||
      this.isGeneratingVideo ||
      inCrop ||
      !this.ffmpegAvailable ||
      (needsMask && !hasSelection);
    getElAs<HTMLButtonElement>("brush-add").disabled = !hasImage || inCrop;
    getElAs<HTMLButtonElement>("brush-remove").disabled = !hasImage || inCrop;
    getElAs<HTMLButtonElement>("btn-undo").disabled = !this.maskEditor?.canUndo() || inCrop;
    getElAs<HTMLButtonElement>("btn-crop").disabled = !hasImage || inCrop || this.isGeneratingVideo;
    getElAs<HTMLInputElement>("param-video-duration").disabled =
      this.isGeneratingVideo || inCrop || !hasImage;
    getElAs<HTMLSelectElement>("param-video-easing").disabled =
      this.isGeneratingVideo || inCrop || !hasImage;
    this.updateVideoButtonHint(hasImage, hasSelection, needsMask, inCrop);
    this.updateWorkspaceChrome();
  }

  private updateWorkspaceChrome(): void {
    const hasImage = !!this.sourceCanvas;
    getEl("canvas-empty").classList.toggle("hidden", hasImage);

    const canvas = getEl("main-canvas");
    let label = "Image workspace — import a photo to begin";
    if (hasImage) {
      if (this.state.cropMode) {
        label = "Crop mode — drag handles to trim the frame";
      } else if (this.state.params.previewMode === "result" && this.state.hasResult) {
        label = "Pixelated result preview";
      } else {
        label = "Image preview — pointer only for brush and crop";
      }
    }
    canvas.setAttribute("aria-label", label);
  }

  private updateVideoButtonHint(
    hasImage: boolean,
    hasSelection: boolean,
    needsMask: boolean,
    inCrop: boolean,
  ): void {
    const btn = getElAs<HTMLButtonElement>("btn-generate-video");
    const hint = getEl("video-export-hint");
    if (!btn.disabled) {
      btn.title = "";
      hint.textContent = "";
      hint.classList.add("hidden");
      return;
    }

    const reasons: string[] = [];
    if (!hasImage) reasons.push("Load an image first");
    if (this.isGeneratingVideo) reasons.push("Export in progress — cannot cancel");
    if (inCrop) reasons.push("Apply or cancel crop first");
    if (!this.ffmpegAvailable) reasons.push("ffmpeg not on PATH — video export unavailable");
    if (needsMask && !hasSelection) {
      reasons.push("Detect subject or brush a selection, or set Pixelate target to Full image");
    }
    const text = reasons.join(". ");
    btn.title = text;
    hint.textContent = text;
    hint.classList.toggle("hidden", !text);
  }

  private async loadFile(file: File): Promise<void> {
    this.stopWebcam();
    try {
      this.setStatus("Loading image...");
      const img = await loadImageFromFile(file);
      await this.loadImageElement(img);
    } catch (err) {
      this.setStatus(err instanceof Error ? err.message : "Failed to load image", "error");
    }
  }

  private async loadImageElement(img: HTMLImageElement): Promise<void> {
    const fitted = fitPreviewSize(img.naturalWidth, img.naturalHeight);

    let drawImg = img;
    if (fitted.width !== img.naturalWidth || fitted.height !== img.naturalHeight) {
      const tmp = document.createElement("canvas");
      tmp.width = fitted.width;
      tmp.height = fitted.height;
      tmp.getContext("2d")!.drawImage(img, 0, 0, fitted.width, fitted.height);
      drawImg = await new Promise((resolve, reject) => {
        const scaled = new Image();
        scaled.onload = () => resolve(scaled);
        scaled.onerror = reject;
        scaled.src = tmp.toDataURL("image/png");
      });
    }

    this.sourceCanvas = createSourceCanvas(drawImg);
    this.maskEditor = new MaskEditor(this.sourceCanvas.width, this.sourceCanvas.height);
    this.rawMaskData = null;
    this.setMaskTuneEnabled(false);
    this.canvasView.setMaskEditor(this.maskEditor);
    this.canvasView.setSource(this.sourceCanvas);
    this.state.maskCanvas = this.maskEditor.canvas;
    this.state.resultCanvas = null;
    this.state.hasResult = false;
    this.state.cropMode = false;
    this.cropEditor = null;
    getEl("crop-actions").classList.add("hidden");
    this.canvasView.setResult(null);
    this.canvasView.hideBrushCursor();
    this.redraw();
    this.updateButtons();
    void this.refreshHealth();
    this.setStatus("Image loaded. Detect subject or set Full image target for video export.");
  }

  private async startWebcam(): Promise<void> {
    const panel = getEl("webcam-panel");
    const video = getElAs<HTMLVideoElement>("webcam-video");
    try {
      this.setStatus("Starting webcam...");
      panel.classList.remove("hidden");
      await this.webcam.start(video);
      this.setStatus("Webcam ready. Click Capture photo.");
    } catch (err) {
      this.stopWebcam();
      this.setStatus(err instanceof Error ? err.message : "Could not access webcam", "error");
    }
  }

  private async captureWebcam(): Promise<void> {
    const video = getElAs<HTMLVideoElement>("webcam-video");
    try {
      const file = await this.webcam.capture(video);
      this.stopWebcam();
      const img = await loadImageFromFile(file);
      await this.loadImageElement(img);
    } catch (err) {
      this.setStatus(err instanceof Error ? err.message : "Capture failed", "error");
    }
  }

  private stopWebcam(): void {
    const panel = getEl("webcam-panel");
    const video = getElAs<HTMLVideoElement>("webcam-video");
    this.webcam.stop(video);
    panel.classList.add("hidden");
  }

  private enterCropMode(): void {
    if (!this.sourceCanvas) return;
    this.state.cropMode = true;
    this.cropEditor = new CropEditor(
      this.sourceCanvas.width,
      this.sourceCanvas.height,
      fullImageCrop(this.sourceCanvas.width, this.sourceCanvas.height),
    );
    getElAs<HTMLSelectElement>("param-crop-aspect").value = "free";
    getEl("crop-actions").classList.remove("hidden");
    this.canvasView.hideBrushCursor();
    this.redraw();
    this.updateButtons();
    this.setStatus("Drag the crop box or pick an aspect ratio. Apply crop when ready.");
  }

  private cancelCrop(): void {
    this.state.cropMode = false;
    this.cropEditor = null;
    getEl("crop-actions").classList.add("hidden");
    this.redraw();
    this.updateButtons();
    this.setStatus("Crop cancelled.");
  }

  private applyCrop(): void {
    if (!this.sourceCanvas || !this.cropEditor) return;

    try {
      const rect = this.cropEditor.getRect();
      const imgW = this.sourceCanvas.width;
      const imgH = this.sourceCanvas.height;
      const isFull =
        Math.abs(rect.x) < 0.5 &&
        Math.abs(rect.y) < 0.5 &&
        Math.abs(Math.round(rect.width) - imgW) < 0.5 &&
        Math.abs(Math.round(rect.height) - imgH) < 0.5;

      if (!isFull) {
        this.sourceCanvas = applyCropToCanvas(this.sourceCanvas, rect);

        if (this.maskEditor) {
          const maskCropped = applyCropToCanvas(this.maskEditor.canvas, rect);
          const maskCtx = maskCropped.getContext("2d");
          if (!maskCtx) {
            this.setStatus("Could not read cropped mask", "error");
            return;
          }
          const maskData = maskCtx.getImageData(0, 0, maskCropped.width, maskCropped.height);

          this.maskEditor = new MaskEditor(maskCropped.width, maskCropped.height);
          this.maskEditor.restore(maskData);

          if (this.rawMaskData) {
            this.rawMaskData = applyCropToImageData(this.rawMaskData, rect);
          }

          this.canvasView.setMaskEditor(this.maskEditor);
          this.state.maskCanvas = this.maskEditor.canvas;
        }

        this.canvasView.setSource(this.sourceCanvas);
      }

      this.state.cropMode = false;
      this.cropEditor = null;
      this.state.hasResult = false;
      this.state.resultCanvas = null;
      this.canvasView.setResult(null);
      getEl("crop-actions").classList.add("hidden");
      this.redraw();
      this.updateButtons();
      this.setStatus(isFull ? "No crop change applied." : "Crop applied.");
    } catch (err) {
      this.setStatus(err instanceof Error ? err.message : "Crop failed", "error");
    }
  }

  private async generateVideo(): Promise<void> {
    if (!this.sourceCanvas || this.isGeneratingVideo) return;
    if (this.state.params.target !== "full" && !this.maskEditor?.hasSelection()) return;

    const btn = getElAs<HTMLButtonElement>("btn-generate-video");
    const progress = getElAs<HTMLProgressElement>("video-progress");
    const prevLabel = btn.textContent ?? "Generate Video";
    this.isGeneratingVideo = true;
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.textContent = "Generating…";
    progress.classList.remove("hidden");
    progress.removeAttribute("value");
    progress.setAttribute("value", "0");
    this.updateButtons();

    const setVideoProgress = (frame: number, total: number, phase: "upload" | "render" | "encode") => {
      if (phase === "upload") {
        btn.textContent = "Uploading…";
        progress.removeAttribute("value");
        this.setStatus("Uploading image and mask to server…", "busy");
        return;
      }
      if (phase === "encode") {
        btn.textContent = "Encoding…";
        progress.setAttribute("value", "100");
        this.setStatus(`Encoding MP4 with ffmpeg (frame ${total}/${total})…`, "busy");
        return;
      }
      const pct = total > 0 ? Math.round((frame / total) * 100) : 0;
      btn.textContent = `Rendering ${frame}/${total}…`;
      progress.setAttribute("value", String(pct));
      this.setStatus(`Server rendering frame ${frame} of ${total}…`, "busy");
    };

    try {
      const blob = await exportPixelateVideo({
        source: this.sourceCanvas,
        mask: this.maskEditor?.canvas ?? null,
        params: this.state.params,
        durationSec: this.state.params.videoDurationSec,
        onProgress: setVideoProgress,
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pixelated.mp4";
      a.click();
      URL.revokeObjectURL(url);
      this.setStatus("Video download started.");
    } catch (err) {
      this.setStatus(err instanceof Error ? err.message : "Video export failed", "error");
    } finally {
      this.isGeneratingVideo = false;
      btn.removeAttribute("aria-busy");
      btn.textContent = prevLabel;
      progress.classList.add("hidden");
      progress.setAttribute("value", "0");
      this.updateButtons();
    }
  }

  private async detectSubject(): Promise<void> {
    if (!this.sourceCanvas || !this.maskEditor) return;

    if (this.maskEditor.canUndo()) {
      const ok = window.confirm(
        "Re-detect will replace the mask and discard brush edits. Continue?",
      );
      if (!ok) return;
    }

    const btn = getElAs<HTMLButtonElement>("btn-detect");
    btn.disabled = true;
    this.setStatus("Detecting subject (first run may download the model)...", "busy");

    try {
      const imageBlob = await new Promise<Blob>((resolve, reject) => {
        this.sourceCanvas!.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Failed to export image for segmentation"));
        }, "image/png");
      });
      const segmentFile = new File([imageBlob], "source.png", { type: "image/png" });
      const maskBlob = await segmentImage(segmentFile, {
        model: this.state.params.segmentModel,
        alphaMatting: this.state.params.alphaMatting,
      });
      const maskImg = await loadImageFromBlob(maskBlob);

      this.rawMaskData = imageDataFromMaskImage(maskImg);
      this.resetMaskTuneUi();
      this.setMaskTuneEnabled(true);
      this.applyMaskTune();

      this.redraw();
      this.updateButtons();
      this.setStatus("Subject detected. Tune cutoff or grow/shrink, then apply pixelation.");
    } catch (err) {
      this.setStatus(err instanceof Error ? err.message : "Segmentation failed", "error");
    } finally {
      btn.disabled = false;
      this.updateButtons();
    }
  }

  private async applyPixelation(showStatus = true): Promise<void> {
    if (this.isApplyingPixelation || !this.sourceCanvas) return;
    if (this.state.params.target !== "full") {
      if (!this.maskEditor?.hasSelection()) return;
    } else if (!this.maskEditor) {
      return;
    }

    const btn = getElAs<HTMLButtonElement>("btn-apply");
    const prevLabel = btn.textContent ?? "Apply Pixelation";
    this.isApplyingPixelation = true;
    btn.setAttribute("aria-busy", "true");
    btn.textContent = "Applying…";
    this.setStatus("Applying pixelation in browser…", "busy");
    this.updateButtons();
    await this.flushUi();

    try {
      const result = applyPixelation(
        this.sourceCanvas,
        this.maskEditor?.canvas ?? null,
        this.state.params.target,
        this.state.params.blockSize,
        this.state.params.feather,
        this.state.params.subjectSaturation,
        this.state.params.backgroundSaturation,
      );
      this.state.resultCanvas = result;
      this.state.hasResult = true;
      this.canvasView.setResult(result);
      this.redraw();
      this.updateButtons();
      if (showStatus) {
        this.setStatus("Pixelation applied. Switch preview to Result or download.");
      }
    } catch (err) {
      this.setStatus(err instanceof Error ? err.message : "Pixelation failed", "error");
    } finally {
      this.isApplyingPixelation = false;
      btn.removeAttribute("aria-busy");
      btn.textContent = prevLabel;
      this.updateButtons();
    }
  }

  private resetMask(): void {
    if (!this.maskEditor) return;

    if (this.maskEditor.canUndo()) {
      const ok = window.confirm("Reset mask? Brush edits will be lost.");
      if (!ok) return;
    }

    if (this.rawMaskData) {
      this.resetMaskTuneUi();
      this.applyMaskTune();
      this.setStatus("Mask reset to last detection.");
    } else {
      this.maskEditor.clear();
      this.state.hasResult = false;
      this.canvasView.setResult(null);
      this.setStatus("Mask cleared.");
    }

    this.redraw();
    this.updateButtons();
  }

  private undoMask(): void {
    if (!this.maskEditor) return;
    this.maskEditor.undo();
    this.state.hasResult = false;
    this.canvasView.setResult(null);
    this.redraw();
    this.updateButtons();
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.sourceCanvas || this.state.params.previewMode === "result") return;

    if (this.state.cropMode && this.cropEditor) {
      const coords = this.canvasView.canvasToImageCoords(e.clientX, e.clientY);
      if (!coords) return;
      if (this.cropEditor.onPointerDown(coords.x, coords.y)) {
        this.redraw();
        (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      }
      return;
    }

    if (!this.maskEditor) return;
    const coords = this.canvasView.canvasToImageCoords(e.clientX, e.clientY);
    if (!coords) return;

    this.isPainting = true;
    this.lastPaint = coords;
    this.maskEditor.beginStroke();
    this.maskEditor.paintAt(coords.x, coords.y, this.state.params.brushSize, this.state.brushMode);
    this.redraw();
    this.showBrushCursor(e);
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.state.cropMode && this.cropEditor) {
      const coords = this.canvasView.canvasToImageCoords(e.clientX, e.clientY);
      if (coords && this.cropEditor.isDragging()) {
        this.cropEditor.onPointerMove(coords.x, coords.y);
        this.redraw();
      }
      return;
    }

    this.showBrushCursor(e);

    if (!this.isPainting || !this.maskEditor || !this.lastPaint) return;
    const coords = this.canvasView.canvasToImageCoords(e.clientX, e.clientY);
    if (!coords) return;

    this.maskEditor.paintLine(
      this.lastPaint.x,
      this.lastPaint.y,
      coords.x,
      coords.y,
      this.state.params.brushSize,
      this.state.brushMode,
    );
    this.lastPaint = coords;
    this.redraw();
  }

  private onPointerUp(): void {
    if (this.state.cropMode && this.cropEditor) {
      this.cropEditor.onPointerUp();
      return;
    }

    if (!this.isPainting || !this.maskEditor) return;
    this.isPainting = false;
    this.lastPaint = null;
    this.maskEditor.endStroke();
    this.state.hasResult = false;
    this.canvasView.setResult(null);
    this.updateButtons();
    this.redraw();
  }

  private redraw(): void {
    const cropOverlay =
      this.state.cropMode && this.cropEditor
        ? { active: true, rect: this.cropEditor.getRect() }
        : { active: false, rect: null };
    this.canvasView.render(this.state.params, cropOverlay);
    this.updateWorkspaceChrome();
  }

  private downloadResult(): void {
    const canvas = this.state.resultCanvas;
    if (!canvas) return;

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pixelated.png";
      a.click();
      URL.revokeObjectURL(url);
      this.setStatus("Download started.");
    }, "image/png");
  }
}

new App();
