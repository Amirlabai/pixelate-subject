import type { AppParams, VideoEasing } from "./state";
import {
  downloadPixelateVideoJob,
  getPixelateVideoJobStatus,
  startPixelateVideoJob,
} from "./api";

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
  onProgress?: (frame: number, total: number, phase: "upload" | "render" | "encode") => void;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function exportPixelateVideo(options: VideoExportOptions): Promise<Blob> {
  const { source, mask, params, durationSec, onProgress } = options;

  onProgress?.(0, 0, "upload");
  const imageBlob = await canvasToPngBlob(source);
  const maskBlob = mask ? await canvasToPngBlob(mask) : null;

  const { jobId, totalFrames } = await startPixelateVideoJob({
    image: imageBlob,
    mask: maskBlob,
    target: params.target,
    feather: params.feather,
    subjectSaturation: params.subjectSaturation,
    backgroundSaturation: params.backgroundSaturation,
    durationSec,
    easing: params.videoEasing,
    fps: VIDEO_FPS,
  });

  let lastFrame = 0;
  for (;;) {
    const status = await getPixelateVideoJobStatus(jobId);
    if (status.phase === "error") {
      throw new Error(status.error ?? "Video job failed");
    }

    if (status.phase === "encoding") {
      onProgress?.(status.total, status.total, "encode");
    } else if (status.frame !== lastFrame || status.phase === "queued") {
      lastFrame = status.frame;
      onProgress?.(status.frame, status.total || totalFrames, "render");
    }

    if (status.done) {
      return downloadPixelateVideoJob(jobId);
    }

    await sleep(250);
  }
}
