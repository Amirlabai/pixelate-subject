import { checkHealth, loadImageFromBlob, loadImageFromFile, segmentImage } from "./api";
import { CanvasView } from "./canvas-view";
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
import { WebcamCapture } from "./webcam";

function getEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function getElAs<T extends HTMLElement>(id: string): T {
  return getEl(id) as T;
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

  constructor() {
    const canvas = getElAs<HTMLCanvasElement>("main-canvas");
    const cursorCanvas = getElAs<HTMLCanvasElement>("brush-cursor");
    this.canvasView = new CanvasView(canvas, cursorCanvas);
    this.bindUi();
    void this.initHealth();
  }

  private async initHealth(): Promise<void> {
    const ok = await checkHealth();
    if (!ok) {
      this.setStatus("Backend not reachable. Run scripts/serve.ps1 first.", "error");
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
    getEl("btn-apply").addEventListener("click", () => this.applyPixelation());
    getEl("btn-reset-mask").addEventListener("click", () => this.resetMask());
    getEl("btn-download").addEventListener("click", () => this.downloadResult());
    getEl("btn-undo").addEventListener("click", () => this.undoMask());

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

    this.bindParam("param-block-size", "val-block-size", "blockSize", (v) => `${v}`);
    this.bindParam("param-feather", "val-feather", "feather", (v) => `${v}`);
    this.bindParam("param-subject-sat", "val-subject-sat", "subjectSaturation", (v) => `${v}`);
    this.bindParam("param-background-sat", "val-background-sat", "backgroundSaturation", (v) => `${v}`);
    this.bindParam("param-overlay", "val-overlay", "overlayOpacity", (v) => `${v}`);
    this.bindParam("param-brush", "val-brush", "brushSize", (v) => `${v}`, () => {
      this.updateBrushCursorFromLastEvent();
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
          if (this.state.hasResult) this.applyPixelation(false);
        }
      });
    });

    document.querySelectorAll('input[name="preview"]').forEach((el) => {
      el.addEventListener("change", (e) => {
        const value = (e.target as HTMLInputElement).value;
        if (value === "original" || value === "result") {
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
    }
  }

  private lastPointer: PointerEvent | null = null;

  private showBrushCursor(e: PointerEvent): void {
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
  ): void {
    const input = getElAs<HTMLInputElement>(inputId);
    const label = getEl(labelId);
    const defaults = createDefaultParams();

    const apply = (value: number) => {
      input.value = String(value);
      (this.state.params as unknown as Record<string, number>)[key] = value;
      label.textContent = format(value);
      if (
        key === "blockSize" ||
        key === "feather" ||
        key === "subjectSaturation" ||
        key === "backgroundSaturation"
      ) {
        if (this.state.hasResult) {
          this.applyPixelation(false);
        }
      }
      if (key === "overlayOpacity") this.redraw();
      onChange?.();
    };

    input.addEventListener("input", () => apply(Number(input.value)));
    input.addEventListener("dblclick", (e) => {
      e.preventDefault();
      apply(defaults[key] as number);
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
    this.state.originalMaskSnapshot = this.maskEditor.snapshot();
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

  private setStatus(message: string, kind: "" | "error" | "busy" = ""): void {
    const el = getEl("status");
    el.textContent = message;
    el.className = "status" + (kind ? ` ${kind}` : "");
  }

  private setBrushMode(mode: BrushMode): void {
    this.state.brushMode = mode;
    getEl("brush-add").classList.toggle("active", mode === "add");
    getEl("brush-remove").classList.toggle("active", mode === "remove");
    this.updateBrushCursorFromLastEvent();
  }

  private updateButtons(): void {
    const hasImage = !!this.sourceCanvas;
    const hasSelection = this.maskEditor?.hasSelection() ?? false;
    const needsMask = this.state.params.target !== "full";
    getElAs<HTMLButtonElement>("btn-detect").disabled = !hasImage;
    getElAs<HTMLButtonElement>("btn-apply").disabled = !hasImage || (needsMask && !hasSelection);
    getElAs<HTMLButtonElement>("btn-reset-mask").disabled =
      !hasImage || (!hasSelection && !this.rawMaskData);
    getElAs<HTMLButtonElement>("btn-download").disabled = !this.state.hasResult;
    getElAs<HTMLButtonElement>("brush-add").disabled = !hasImage;
    getElAs<HTMLButtonElement>("brush-remove").disabled = !hasImage;
    getElAs<HTMLButtonElement>("btn-undo").disabled = !this.maskEditor?.canUndo();
  }

  private async loadFile(file: File): Promise<void> {
    this.stopWebcam();
    try {
      this.setStatus("Loading image...");
      const img = await loadImageFromFile(file);
      await this.loadImageElement(img, file);
    } catch (err) {
      this.setStatus(err instanceof Error ? err.message : "Failed to load image", "error");
    }
  }

  private async loadImageElement(img: HTMLImageElement, sourceFile: File | null): Promise<void> {
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
    this.state.sourceFile = sourceFile;
    this.state.sourceImage = drawImg;
    this.state.maskCanvas = this.maskEditor.canvas;
    this.state.originalMaskSnapshot = null;
    this.state.resultCanvas = null;
    this.state.hasResult = false;
    this.canvasView.setResult(null);
    this.canvasView.hideBrushCursor();
    this.redraw();
    this.updateButtons();
    this.setStatus("Image loaded. Brush a selection or click Detect Subject.");
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
      await this.loadImageElement(img, file);
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

  private async detectSubject(): Promise<void> {
    if (!this.sourceCanvas || !this.maskEditor) return;

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

  private applyPixelation(showStatus = true): void {
    if (!this.sourceCanvas) return;
    if (this.state.params.target !== "full") {
      if (!this.maskEditor?.hasSelection()) return;
    } else if (!this.maskEditor) {
      return;
    }

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
    }
  }

  private resetMask(): void {
    if (!this.maskEditor) return;

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
    if (!this.maskEditor || !this.sourceCanvas || this.state.params.previewMode === "result") return;
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
    this.canvasView.render(this.state.params);
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
