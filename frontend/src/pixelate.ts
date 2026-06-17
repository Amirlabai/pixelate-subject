import { fillOutwardUnderMask } from "./edge-fill";
import { dilateBinaryMask } from "./mask-postprocess";
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

function imageDataToCanvas(data: ImageData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = data.width;
  canvas.height = data.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create canvas");
  ctx.putImageData(data, 0, 0);
  return canvas;
}

function compositeBlockAligned(
  sharp: ImageData,
  pixelated: ImageData,
  mask: ImageData,
  blockSize: number,
  target: Exclude<PixelateTarget, "full">,
  threshold = 128,
): ImageData {
  const { width, height } = sharp;
  const out = new ImageData(width, height);
  const dst = out.data;
  const sharpD = sharp.data;
  const pixD = pixelated.data;
  const maskD = mask.data;

  for (let by = 0; by < height; by += blockSize) {
    for (let bx = 0; bx < width; bx += blockSize) {
      const bw = Math.min(blockSize, width - bx);
      const bh = Math.min(blockSize, height - by);

      const cx = bx + Math.floor(bw / 2);
      const cy = by + Math.floor(bh / 2);
      const inSubject = maskD[(cy * width + cx) * 4] >= threshold;

      const usePixelated = target === "subject" ? inSubject : !inSubject;
      const src = usePixelated ? pixD : sharpD;

      for (let y = by; y < by + bh; y++) {
        for (let x = bx; x < bx + bw; x++) {
          const i = (y * width + x) * 4;
          dst[i] = src[i];
          dst[i + 1] = src[i + 1];
          dst[i + 2] = src[i + 2];
          dst[i + 3] = 255;
        }
      }
    }
  }

  return out;
}

function maskToAlphaCanvas(maskCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const width = maskCanvas.width;
  const height = maskCanvas.height;
  const maskCtx = maskCanvas.getContext("2d");
  if (!maskCtx) throw new Error("Could not read mask");

  const maskData = maskCtx.getImageData(0, 0, width, height);
  const alphaData = maskCtx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const v = maskData.data[o];
    alphaData.data[o] = 255;
    alphaData.data[o + 1] = 255;
    alphaData.data[o + 2] = 255;
    alphaData.data[o + 3] = v;
  }

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  out.getContext("2d")!.putImageData(alphaData, 0, 0);
  return out;
}

function maskLayerWithAlpha(
  layer: HTMLCanvasElement,
  alphaMask: HTMLCanvasElement,
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = layer.width;
  out.height = layer.height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Could not mask layer");

  ctx.drawImage(layer, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(alphaMask, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  return out;
}

function compositeBackgroundOverlay(
  sharp: HTMLCanvasElement,
  pixelated: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
): HTMLCanvasElement {
  const alphaMask = maskToAlphaCanvas(maskCanvas);

  const out = document.createElement("canvas");
  out.width = sharp.width;
  out.height = sharp.height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Could not composite layers");

  ctx.drawImage(pixelated, 0, 0);
  ctx.drawImage(maskLayerWithAlpha(sharp, alphaMask), 0, 0);
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
  let maskData: ImageData | null = null;
  if (maskCanvas) {
    const maskCtx = maskCanvas.getContext("2d");
    if (!maskCtx) throw new Error("Could not read mask");
    maskData = maskCtx.getImageData(0, 0, width, height);
    feathered = featherMask(maskData, feather);
  }

  const saturated = buildSaturatedComposite(
    sourceData,
    feathered,
    subjectSaturation,
    backgroundSaturation,
  );

  if (target === "full" || !maskData || !maskCanvas) {
    return imageDataToCanvas(pixelateImageData(saturated, blockSize));
  }

  if (target === "subject") {
    const fillRadius = Math.ceil(blockSize / 2);
    const filled = fillOutwardUnderMask(saturated, maskData, fillRadius);
    const pixelated = pixelateImageData(filled, blockSize);
    const inclusionMask = dilateBinaryMask(maskData, fillRadius);
    return imageDataToCanvas(
      compositeBlockAligned(saturated, pixelated, inclusionMask, blockSize, target),
    );
  }

  const pixelated = pixelateImageData(saturated, blockSize);
  return compositeBackgroundOverlay(
    imageDataToCanvas(saturated),
    imageDataToCanvas(pixelated),
    maskCanvas,
  );
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
