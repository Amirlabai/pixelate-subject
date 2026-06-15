import type { AppParams, BrushMode } from "./state";
import { buildSelectionOverlay } from "./pixelate";
import type { MaskEditor } from "./mask-editor";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const ZOOM_FACTOR = 1.12;

export class BrushCursorOverlay {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly overlay: HTMLCanvasElement,
    private readonly main: HTMLCanvasElement,
  ) {
    const ctx = overlay.getContext("2d");
    if (!ctx) throw new Error("Could not get brush cursor context");
    this.ctx = ctx;
  }

  syncSize(): void {
    this.overlay.width = this.main.width;
    this.overlay.height = this.main.height;
  }

  show(x: number, y: number, brushSize: number, mode: BrushMode): void {
    this.syncSize();
    this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const radius = brushSize / 2;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fillStyle =
      mode === "add" ? "rgba(80, 200, 120, 0.18)" : "rgba(240, 100, 100, 0.18)";
    this.ctx.fill();
    this.ctx.strokeStyle =
      mode === "add" ? "rgba(80, 220, 130, 0.95)" : "rgba(255, 110, 110, 0.95)";
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
  }

  hide(): void {
    this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }
}

export class CanvasView {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly brushCursor: BrushCursorOverlay;
  private readonly wrap: HTMLElement | null;
  private readonly scrollContent: HTMLElement | null;
  private baseFitScale = 1;
  private userZoom = 1;
  private displayScale = 1;
  private sourceCanvas: HTMLCanvasElement | null = null;
  private resultCanvas: HTMLCanvasElement | null = null;
  private maskEditor: MaskEditor | null = null;

  constructor(canvas: HTMLCanvasElement, cursorCanvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get main canvas context");
    this.canvas = canvas;
    this.ctx = ctx;
    this.brushCursor = new BrushCursorOverlay(cursorCanvas, canvas);

    this.wrap = document.getElementById("canvas-wrap");
    this.scrollContent = this.wrap?.querySelector(".canvas-scroll-content") ?? null;
    if (this.wrap) {
      const observer = new ResizeObserver(() => this.fitToContainer());
      observer.observe(this.wrap);
      this.wrap.addEventListener("wheel", (e) => this.handleWheel(e), { passive: false });
    }
    window.addEventListener("resize", () => this.fitToContainer());
  }

  setSource(source: HTMLCanvasElement): void {
    this.sourceCanvas = source;
    this.resultCanvas = null;
    this.resizeToSource();
    this.brushCursor.syncSize();
    this.resetZoom();
    this.fitToContainer();
    this.render({} as AppParams);
  }

  setMaskEditor(editor: MaskEditor): void {
    this.maskEditor = editor;
  }

  setResult(result: HTMLCanvasElement | null): void {
    this.resultCanvas = result;
  }

  getDisplayScale(): number {
    return this.displayScale;
  }

  canvasToImageCoords(clientX: number, clientY: number): { x: number; y: number } | null {
    if (!this.sourceCanvas) return null;
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) {
      return null;
    }
    return { x, y };
  }

  updateBrushCursor(
    clientX: number,
    clientY: number,
    params: AppParams,
    brushMode: BrushMode,
    hasMask: boolean,
  ): void {
    if (!hasMask || params.previewMode === "result") {
      this.brushCursor.hide();
      return;
    }
    const coords = this.canvasToImageCoords(clientX, clientY);
    if (!coords) {
      this.brushCursor.hide();
      return;
    }
    this.brushCursor.show(coords.x, coords.y, params.brushSize, brushMode);
  }

  hideBrushCursor(): void {
    this.brushCursor.hide();
  }

  render(params: AppParams): void {
    if (!this.sourceCanvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }

    const showResult = params.previewMode === "result" && this.resultCanvas;
    const base = showResult ? this.resultCanvas! : this.sourceCanvas;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(base, 0, 0);

    if (!showResult && params.showSelection && this.maskEditor) {
      const overlay = buildSelectionOverlay(this.maskEditor.canvas, params.overlayOpacity);
      this.ctx.drawImage(overlay, 0, 0);
    }

    this.applyDisplayScale();
  }

  private handleWheel(e: WheelEvent): void {
    if (!this.sourceCanvas || !this.wrap) return;

    if (e.ctrlKey) {
      e.preventDefault();

      const rect = this.wrap.getBoundingClientRect();
      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;
      const oldScale = this.displayScale;

      const factor = e.deltaY > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
      this.userZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.userZoom * factor));
      this.applyDisplayScale();

      const ratio = this.displayScale / oldScale;
      this.wrap.scrollLeft = (this.wrap.scrollLeft + pointerX) * ratio - pointerX;
      this.wrap.scrollTop = (this.wrap.scrollTop + pointerY) * ratio - pointerY;
      return;
    }

    if (!this.canPan()) return;

    e.preventDefault();
    const deltaY = e.deltaY;
    const deltaX = e.deltaX;

    if (e.shiftKey) {
      this.wrap.scrollLeft += deltaY !== 0 ? deltaY : deltaX;
    } else {
      this.wrap.scrollTop += deltaY;
      if (deltaX !== 0) {
        this.wrap.scrollLeft += deltaX;
      }
    }
    this.clampScroll();
  }

  private canPan(): boolean {
    if (!this.wrap) return false;
    return (
      this.wrap.scrollWidth > this.wrap.clientWidth + 1 ||
      this.wrap.scrollHeight > this.wrap.clientHeight + 1
    );
  }

  resetZoomToDefault(): void {
    this.resetZoom();
    this.applyDisplayScale();
  }

  private resetZoom(): void {
    this.userZoom = 1;
    if (this.wrap) {
      this.wrap.scrollLeft = 0;
      this.wrap.scrollTop = 0;
    }
  }

  private computeBaseFitScale(): number {
    if (!this.sourceCanvas || !this.wrap) return 1;
    const availW = this.wrap.clientWidth;
    const availH = this.wrap.clientHeight;
    if (availW <= 0 || availH <= 0) return 1;
    return Math.min(1, availW / this.canvas.width, availH / this.canvas.height);
  }

  private fitToContainer(): void {
    if (!this.sourceCanvas) return;
    this.baseFitScale = this.computeBaseFitScale();
    this.applyDisplayScale();
  }

  private applyDisplayScale(): void {
    if (!this.sourceCanvas) return;
    this.displayScale = this.baseFitScale * this.userZoom;
    const displayW = Math.ceil(this.canvas.width * this.displayScale);
    const displayH = Math.ceil(this.canvas.height * this.displayScale);
    this.canvas.style.width = `${displayW}px`;
    this.canvas.style.height = `${displayH}px`;

    if (this.scrollContent && this.wrap) {
      const viewW = this.wrap.clientWidth;
      const viewH = this.wrap.clientHeight;
      this.scrollContent.style.width = `${Math.max(viewW, displayW)}px`;
      this.scrollContent.style.height = `${Math.max(viewH, displayH)}px`;
    }

    this.clampScroll();
  }

  private clampScroll(): void {
    if (!this.wrap) return;
    const maxLeft = Math.max(0, this.wrap.scrollWidth - this.wrap.clientWidth);
    const maxTop = Math.max(0, this.wrap.scrollHeight - this.wrap.clientHeight);
    this.wrap.scrollLeft = Math.min(this.wrap.scrollLeft, maxLeft);
    this.wrap.scrollTop = Math.min(this.wrap.scrollTop, maxTop);
  }

  private resizeToSource(): void {
    if (!this.sourceCanvas) return;
    this.canvas.width = this.sourceCanvas.width;
    this.canvas.height = this.sourceCanvas.height;
  }
}
