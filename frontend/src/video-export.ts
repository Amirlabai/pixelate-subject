import { applyPixelation } from "./pixelate";
import { renderVideo } from "./api";
import type { AppParams, VideoEasing } from "./state";

const VIDEO_FPS = 30;
const BLOCK_MIN = 4;
const BLOCK_MAX = 64;

export interface VideoExportOptions {
  source: HTMLCanvasElement;
  mask: HTMLCanvasElement | null;
  params: Pick<
    AppParams,
    "target" | "feather" | "subjectSaturation" | "backgroundSaturation" | "videoEasing"
  >;
  durationSec: number;
  onProgress?: (frame: number, total: number, phase: "render" | "encode") => void;
}

export const VIDEO_EASING_OPTIONS: { id: VideoEasing; label: string }[] = [
  { id: "linear", label: "Linear" },
  { id: "ease-in", label: "Ease in (slow start)" },
  { id: "ease-out", label: "Ease out (slow end)" },
  { id: "ease-in-out", label: "Ease in-out" },
  { id: "ease-in-cubic", label: "Ease in cubic" },
  { id: "ease-out-cubic", label: "Ease out cubic" },
];

export function isVideoEasing(value: string): value is VideoEasing {
  return VIDEO_EASING_OPTIONS.some((o) => o.id === value);
}

export function applyEasing(t: number, easing: VideoEasing): number {
  const clamped = Math.max(0, Math.min(1, t));
  switch (easing) {
    case "linear":
      return clamped;
    case "ease-in":
      return clamped * clamped;
    case "ease-out":
      return 1 - (1 - clamped) * (1 - clamped);
    case "ease-in-out":
      return clamped < 0.5
        ? 2 * clamped * clamped
        : 1 - Math.pow(-2 * clamped + 2, 2) / 2;
    case "ease-in-cubic":
      return clamped * clamped * clamped;
    case "ease-out-cubic":
      return 1 - Math.pow(1 - clamped, 3);
  }
}

export function blockSizeForFrame(
  frameIndex: number,
  totalFrames: number,
  easing: VideoEasing = "ease-out",
): number {
  if (totalFrames <= 1) return BLOCK_MAX;
  const t = frameIndex / (totalFrames - 1);
  const eased = applyEasing(t, easing);
  return Math.round(BLOCK_MIN + eased * (BLOCK_MAX - BLOCK_MIN));
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to export frame as PNG"));
    }, "image/png");
  });
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export async function exportPixelateVideo(options: VideoExportOptions): Promise<Blob> {
  const { source, mask, params, durationSec, onProgress } = options;
  const totalFrames = Math.max(2, Math.round(durationSec * VIDEO_FPS));
  const frames: Blob[] = [];

  for (let i = 0; i < totalFrames; i++) {
    const blockSize = blockSizeForFrame(i, totalFrames, params.videoEasing);
    const frameCanvas = applyPixelation(
      source,
      mask,
      params.target,
      blockSize,
      params.feather,
      params.subjectSaturation,
      params.backgroundSaturation,
    );
    frames.push(await canvasToPngBlob(frameCanvas));
    onProgress?.(i + 1, totalFrames, "render");
    await yieldToMain();
  }

  onProgress?.(totalFrames, totalFrames, "encode");
  return renderVideo(frames, VIDEO_FPS);
}
