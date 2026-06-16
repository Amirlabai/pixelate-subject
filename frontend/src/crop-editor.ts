export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CropAspectPreset =
  | "free"
  | "1:1"
  | "4:3"
  | "3:4"
  | "16:9"
  | "9:16"
  | "3:2"
  | "2:3";

export const CROP_ASPECT_PRESETS: { id: CropAspectPreset; label: string; w: number; h: number }[] = [
  { id: "free", label: "Free", w: 0, h: 0 },
  { id: "1:1", label: "1:1", w: 1, h: 1 },
  { id: "4:3", label: "4:3", w: 4, h: 3 },
  { id: "3:4", label: "3:4", w: 3, h: 4 },
  { id: "16:9", label: "16:9", w: 16, h: 9 },
  { id: "9:16", label: "9:16", w: 9, h: 16 },
  { id: "3:2", label: "3:2", w: 3, h: 2 },
  { id: "2:3", label: "2:3", w: 2, h: 3 },
];

export function aspectRatioFromPreset(preset: CropAspectPreset): number | null {
  const entry = CROP_ASPECT_PRESETS.find((p) => p.id === preset);
  if (!entry || preset === "free") return null;
  return entry.w / entry.h;
}

export function isCropAspectPreset(value: string): value is CropAspectPreset {
  return CROP_ASPECT_PRESETS.some((p) => p.id === value);
}

export function maxCropRectForAspect(
  imgW: number,
  imgH: number,
  ratioW: number,
  ratioH: number,
): CropRect {
  const aspect = ratioW / ratioH;
  let width = imgW;
  let height = width / aspect;
  if (height > imgH) {
    height = imgH;
    width = height * aspect;
  }
  return clampRect(
    {
      x: (imgW - width) / 2,
      y: (imgH - height) / 2,
      width,
      height,
    },
    imgW,
    imgH,
  );
}

const MIN_CROP_SIZE = 32;
const HANDLE_SIZE = 10;

type DragMode =
  | "move"
  | "nw"
  | "ne"
  | "sw"
  | "se"
  | "n"
  | "s"
  | "e"
  | "w"
  | null;

function clampRect(rect: CropRect, imgW: number, imgH: number): CropRect {
  let { x, y, width, height } = rect;

  width = Math.max(MIN_CROP_SIZE, Math.min(width, imgW));
  height = Math.max(MIN_CROP_SIZE, Math.min(height, imgH));
  x = Math.max(0, Math.min(x, imgW - width));
  y = Math.max(0, Math.min(y, imgH - height));

  return { x, y, width, height };
}

function resizeWithAspect(
  r: CropRect,
  mode: Exclude<DragMode, null | "move">,
  dx: number,
  dy: number,
  aspect: number,
): CropRect {
  let x = r.x;
  let y = r.y;
  let width = r.width;
  let height = r.height;

  switch (mode) {
    case "se":
      width = r.width + dx;
      height = width / aspect;
      break;
    case "nw":
      width = r.width - dx;
      height = width / aspect;
      x = r.x + r.width - width;
      y = r.y + r.height - height;
      break;
    case "ne":
      width = r.width + dx;
      height = width / aspect;
      y = r.y + r.height - height;
      break;
    case "sw":
      width = r.width - dx;
      height = width / aspect;
      x = r.x + r.width - width;
      break;
    case "e":
      width = r.width + dx;
      height = width / aspect;
      y = r.y + (r.height - height) / 2;
      break;
    case "w":
      width = r.width - dx;
      height = width / aspect;
      x = r.x + r.width - width;
      y = r.y + (r.height - height) / 2;
      break;
    case "s":
      height = r.height + dy;
      width = height * aspect;
      x = r.x + (r.width - width) / 2;
      break;
    case "n":
      height = r.height - dy;
      width = height * aspect;
      y = r.y + r.height - height;
      x = r.x + (r.width - width) / 2;
      break;
  }

  return { x, y, width, height };
}

export function fullImageCrop(width: number, height: number): CropRect {
  return { x: 0, y: 0, width, height };
}

export function applyCropToCanvas(canvas: HTMLCanvasElement, rect: CropRect): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = Math.round(rect.width);
  out.height = Math.round(rect.height);
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Could not create cropped canvas");
  ctx.drawImage(
    canvas,
    Math.round(rect.x),
    Math.round(rect.y),
    Math.round(rect.width),
    Math.round(rect.height),
    0,
    0,
    out.width,
    out.height,
  );
  return out;
}

export function applyCropToImageData(data: ImageData, rect: CropRect): ImageData {
  const x = Math.round(rect.x);
  const y = Math.round(rect.y);
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  const out = new ImageData(w, h);

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const srcIdx = ((y + row) * data.width + (x + col)) * 4;
      const dstIdx = (row * w + col) * 4;
      out.data[dstIdx] = data.data[srcIdx];
      out.data[dstIdx + 1] = data.data[srcIdx + 1];
      out.data[dstIdx + 2] = data.data[srcIdx + 2];
      out.data[dstIdx + 3] = data.data[srcIdx + 3];
    }
  }

  return out;
}

export function drawCropOverlay(
  ctx: CanvasRenderingContext2D,
  rect: CropRect,
  imgW: number,
  imgH: number,
): void {
  const { x, y, width, height } = rect;

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(0, 0, imgW, y);
  ctx.fillRect(0, y + height, imgW, imgH - y - height);
  ctx.fillRect(0, y, x, height);
  ctx.fillRect(x + width, y, imgW - x - width, height);

  ctx.strokeStyle = "#5b8def";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);

  const hs = HANDLE_SIZE;
  const handles: [number, number][] = [
    [x, y],
    [x + width, y],
    [x, y + height],
    [x + width, y + height],
    [x + width / 2, y],
    [x + width / 2, y + height],
    [x, y + height / 2],
    [x + width, y + height / 2],
  ];

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#5b8def";
  ctx.lineWidth = 1.5;
  for (const [hx, hy] of handles) {
    ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
    ctx.strokeRect(hx - hs / 2 + 0.5, hy - hs / 2 + 0.5, hs - 1, hs - 1);
  }

  ctx.restore();
}

export class CropEditor {
  private rect: CropRect;
  private dragMode: DragMode = null;
  private dragStart: { x: number; y: number; rect: CropRect } | null = null;
  private aspectRatio: number | null = null;
  private aspectPreset: CropAspectPreset = "free";

  constructor(
    private imgW: number,
    private imgH: number,
    initialRect?: CropRect,
  ) {
    this.rect = clampRect(initialRect ?? fullImageCrop(imgW, imgH), imgW, imgH);
  }

  getAspectPreset(): CropAspectPreset {
    return this.aspectPreset;
  }

  setAspectPreset(preset: CropAspectPreset): void {
    this.aspectPreset = preset;
    this.aspectRatio = aspectRatioFromPreset(preset);

    if (this.aspectRatio === null) return;

    const entry = CROP_ASPECT_PRESETS.find((p) => p.id === preset);
    if (!entry) return;

    this.rect = maxCropRectForAspect(this.imgW, this.imgH, entry.w, entry.h);
  }

  getRect(): CropRect {
    return { ...this.rect };
  }

  setRect(rect: CropRect): void {
    this.rect = clampRect(rect, this.imgW, this.imgH);
  }

  private hitTest(px: number, py: number): DragMode {
    const { x, y, width, height } = this.rect;
    const hs = HANDLE_SIZE;
    const tol = hs;

    const inHandle = (hx: number, hy: number) =>
      Math.abs(px - hx) <= tol && Math.abs(py - hy) <= tol;

    if (inHandle(x, y)) return "nw";
    if (inHandle(x + width, y)) return "ne";
    if (inHandle(x, y + height)) return "sw";
    if (inHandle(x + width, y + height)) return "se";
    if (inHandle(x + width / 2, y)) return "n";
    if (inHandle(x + width / 2, y + height)) return "s";
    if (inHandle(x, y + height / 2)) return "w";
    if (inHandle(x + width, y + height / 2)) return "e";

    if (px >= x && px <= x + width && py >= y && py <= y + height) return "move";
    return null;
  }

  onPointerDown(px: number, py: number): boolean {
    const mode = this.hitTest(px, py);
    if (!mode) return false;
    this.dragMode = mode;
    this.dragStart = { x: px, y: py, rect: { ...this.rect } };
    return true;
  }

  onPointerMove(px: number, py: number): void {
    if (!this.dragMode || !this.dragStart) return;

    const dx = px - this.dragStart.x;
    const dy = py - this.dragStart.y;
    const r = this.dragStart.rect;

    let next: CropRect;

    if (this.dragMode === "move" || this.aspectRatio === null) {
      switch (this.dragMode) {
        case "move":
          next = { x: r.x + dx, y: r.y + dy, width: r.width, height: r.height };
          break;
        case "nw":
          next = { x: r.x + dx, y: r.y + dy, width: r.width - dx, height: r.height - dy };
          break;
        case "ne":
          next = { x: r.x, y: r.y + dy, width: r.width + dx, height: r.height - dy };
          break;
        case "sw":
          next = { x: r.x + dx, y: r.y, width: r.width - dx, height: r.height + dy };
          break;
        case "se":
          next = { x: r.x, y: r.y, width: r.width + dx, height: r.height + dy };
          break;
        case "n":
          next = { x: r.x, y: r.y + dy, width: r.width, height: r.height - dy };
          break;
        case "s":
          next = { x: r.x, y: r.y, width: r.width, height: r.height + dy };
          break;
        case "w":
          next = { x: r.x + dx, y: r.y, width: r.width - dx, height: r.height };
          break;
        case "e":
          next = { x: r.x, y: r.y, width: r.width + dx, height: r.height };
          break;
        default:
          return;
      }
    } else {
      next = resizeWithAspect(r, this.dragMode, dx, dy, this.aspectRatio);
    }

    this.rect = clampRect(next, this.imgW, this.imgH);
  }

  onPointerUp(): void {
    this.dragMode = null;
    this.dragStart = null;
  }

  isDragging(): boolean {
    return this.dragMode !== null;
  }
}
