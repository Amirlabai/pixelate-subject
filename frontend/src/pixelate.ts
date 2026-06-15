import type { PixelateTarget } from "./state";

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function adjustSaturation(
  r: number,
  g: number,
  b: number,
  percent: number,
): [number, number, number] {
  const amount = percent / 100;
  const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [
    clampByte(gray + (r - gray) * amount),
    clampByte(gray + (g - gray) * amount),
    clampByte(gray + (b - gray) * amount),
  ];
}

function buildSaturatedComposite(
  sourceData: ImageData,
  feathered: Uint8ClampedArray | null,
  subjectSaturation: number,
  backgroundSaturation: number,
): ImageData {
  const { width, height, data: src } = sourceData;
  const out = new ImageData(width, height);
  const dst = out.data;
  const size = width * height;

  for (let i = 0; i < size; i++) {
    const o = i * 4;
    const r = src[o];
    const g = src[o + 1];
    const b = src[o + 2];

    const [sr, sg, sb] = adjustSaturation(r, g, b, subjectSaturation);
    const [br, bg, bb] = adjustSaturation(r, g, b, backgroundSaturation);

    let maskVal = 1;
    if (feathered) {
      maskVal = feathered[i] / 255;
    }

    dst[o] = clampByte(br * (1 - maskVal) + sr * maskVal);
    dst[o + 1] = clampByte(bg * (1 - maskVal) + sg * maskVal);
    dst[o + 2] = clampByte(bb * (1 - maskVal) + sb * maskVal);
    dst[o + 3] = 255;
  }

  return out;
}

function pixelateImageData(data: ImageData, blockSize: number): ImageData {
  const { width, height, data: pixels } = data;
  const out = new ImageData(width, height);
  const dst = out.data;

  for (let by = 0; by < height; by += blockSize) {
    for (let bx = 0; bx < width; bx += blockSize) {
      const bw = Math.min(blockSize, width - bx);
      const bh = Math.min(blockSize, height - by);

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;

      for (let y = by; y < by + bh; y++) {
        for (let x = bx; x < bx + bw; x++) {
          const i = (y * width + x) * 4;
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
          a += pixels[i + 3];
          count++;
        }
      }

      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);
      a = Math.round(a / count);

      for (let y = by; y < by + bh; y++) {
        for (let x = bx; x < bx + bw; x++) {
          const i = (y * width + x) * 4;
          dst[i] = r;
          dst[i + 1] = g;
          dst[i + 2] = b;
          dst[i + 3] = a;
        }
      }
    }
  }

  return out;
}

function featherMask(maskData: ImageData, radius: number): Uint8ClampedArray {
  const { width, height, data } = maskData;
  const out = new Uint8ClampedArray(width * height);

  if (radius <= 0) {
    for (let i = 0; i < width * height; i++) {
      out[i] = data[i * 4];
    }
    return out;
  }

  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = width;
  tmpCanvas.height = height;
  const ctx = tmpCanvas.getContext("2d");
  if (!ctx) throw new Error("Could not feather mask");

  const gray = new ImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const v = data[i * 4];
    gray.data[i * 4] = v;
    gray.data[i * 4 + 1] = v;
    gray.data[i * 4 + 2] = v;
    gray.data[i * 4 + 3] = 255;
  }

  ctx.putImageData(gray, 0, 0);
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(tmpCanvas, 0, 0);
  ctx.filter = "none";

  const blurred = ctx.getImageData(0, 0, width, height).data;
  for (let i = 0; i < width * height; i++) {
    out[i] = blurred[i * 4];
  }
  return out;
}

export function applyPixelation(
  source: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement | null,
  target: PixelateTarget,
  blockSize: number,
  feather: number,
  subjectSaturation: number,
  backgroundSaturation: number,
): HTMLCanvasElement {
  const width = source.width;
  const height = source.height;

  const srcCtx = source.getContext("2d");
  if (!srcCtx) throw new Error("Could not read source");

  const sourceData = srcCtx.getImageData(0, 0, width, height);

  let feathered: Uint8ClampedArray | null = null;
  if (maskCanvas) {
    const maskCtx = maskCanvas.getContext("2d");
    if (!maskCtx) throw new Error("Could not read mask");
    const maskData = maskCtx.getImageData(0, 0, width, height);
    feathered = featherMask(maskData, feather);
  }

  const saturated = buildSaturatedComposite(
    sourceData,
    feathered,
    subjectSaturation,
    backgroundSaturation,
  );
  const pixelated = pixelateImageData(saturated, blockSize);

  const outCanvas = document.createElement("canvas");
  outCanvas.width = width;
  outCanvas.height = height;

  if (target === "full" || !feathered) {
    outCanvas.getContext("2d")!.putImageData(pixelated, 0, 0);
    return outCanvas;
  }

  const out = outCanvas.getContext("2d")!.createImageData(width, height);
  const dst = out.data;
  const src = saturated.data;
  const pix = pixelated.data;

  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    let maskVal = feathered[i] / 255;
    if (target === "background") {
      maskVal = 1 - maskVal;
    }

    dst[o] = Math.round(src[o] * (1 - maskVal) + pix[o] * maskVal);
    dst[o + 1] = Math.round(src[o + 1] * (1 - maskVal) + pix[o + 1] * maskVal);
    dst[o + 2] = Math.round(src[o + 2] * (1 - maskVal) + pix[o + 2] * maskVal);
    dst[o + 3] = 255;
  }

  outCanvas.getContext("2d")!.putImageData(out, 0, 0);
  return outCanvas;
}

export function buildSelectionOverlay(
  maskCanvas: HTMLCanvasElement,
  opacity: number,
): HTMLCanvasElement {
  const width = maskCanvas.width;
  const height = maskCanvas.height;
  const maskCtx = maskCanvas.getContext("2d");
  if (!maskCtx) throw new Error("Could not read mask");

  const maskData = maskCtx.getImageData(0, 0, width, height);
  const overlay = document.createElement("canvas");
  overlay.width = width;
  overlay.height = height;
  const overlayData = overlay.getContext("2d")!.createImageData(width, height);
  const alpha = Math.round((opacity / 100) * 255);

  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const m = maskData.data[o];
    if (m > 10) {
      overlayData.data[o] = 80;
      overlayData.data[o + 1] = 200;
      overlayData.data[o + 2] = 120;
      overlayData.data[o + 3] = Math.round((m / 255) * alpha);
    }
  }

  overlay.getContext("2d")!.putImageData(overlayData, 0, 0);
  return overlay;
}

export function createSourceCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create source canvas");
  ctx.drawImage(img, 0, 0);
  return canvas;
}
