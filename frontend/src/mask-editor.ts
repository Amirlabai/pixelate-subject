import type { BrushMode } from "./state";

const MAX_UNDO = 20;

export class MaskEditor {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private undoStack: ImageData[] = [];
  private painting = false;

  constructor(width: number, height: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create mask canvas context");
    this.ctx = ctx;
    this.clear();
  }

  hasSelection(): boolean {
    const data = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 10) return true;
    }
    return false;
  }

  clear(): void {
    this.ctx.fillStyle = "#000000";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.undoStack = [];
  }

  snapshot(): ImageData {
    return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
  }

  restore(data: ImageData): void {
    this.ctx.putImageData(data, 0, 0);
  }

  restoreOriginal(data: ImageData): void {
    this.restore(data);
    this.undoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (prev) this.restore(prev);
  }

  private pushUndo(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > MAX_UNDO) {
      this.undoStack.shift();
    }
  }

  beginStroke(): void {
    if (!this.painting) {
      this.pushUndo();
      this.painting = true;
    }
  }

  endStroke(): void {
    this.painting = false;
  }

  paintAt(x: number, y: number, brushSize: number, mode: BrushMode): void {
    this.ctx.save();
    this.ctx.fillStyle = mode === "add" ? "#ffffff" : "#000000";
    this.ctx.beginPath();
    this.ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  paintLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    brushSize: number,
    mode: BrushMode,
  ): void {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const step = Math.max(1, brushSize / 4);
    const steps = Math.ceil(dist / step);
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      this.paintAt(x, y, brushSize, mode);
    }
  }
}
