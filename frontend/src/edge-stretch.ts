import { fillDirectionalToEdges, type StretchDirection } from "./edge-fill";

function imageDataToCanvas(data: ImageData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = data.width;
  canvas.height = data.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create canvas");
  ctx.putImageData(data, 0, 0);
  return canvas;
}

export function applyEdgeStretch(
  source: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  direction: StretchDirection,
): HTMLCanvasElement {
  const width = source.width;
  const height = source.height;

  const srcCtx = source.getContext("2d");
  if (!srcCtx) throw new Error("Could not read source");

  const maskCtx = maskCanvas.getContext("2d");
  if (!maskCtx) throw new Error("Could not read mask");

  const sourceData = srcCtx.getImageData(0, 0, width, height);
  const maskData = maskCtx.getImageData(0, 0, width, height);
  const filled = fillDirectionalToEdges(sourceData, maskData, direction);
  return imageDataToCanvas(filled);
}
