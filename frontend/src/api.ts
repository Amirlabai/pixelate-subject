export interface SegmentOptions {
  model: "general" | "people" | "fast";
  alphaMatting: boolean;
}

export async function segmentImage(file: File, options: SegmentOptions): Promise<Blob> {
  const form = new FormData();
  form.append("image", file);
  form.append("model", options.model);
  form.append("alpha_matting", options.alphaMatting ? "true" : "false");

  const response = await fetch("/api/segment", {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(detail);
  }

  return response.blob();
}

export async function checkHealth(): Promise<{ ok: boolean; ffmpeg: boolean }> {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) return { ok: false, ffmpeg: false };
    const body = (await response.json()) as { ok?: boolean; ffmpeg?: boolean };
    return { ok: body.ok === true, ffmpeg: body.ffmpeg === true };
  } catch {
    return { ok: false, ffmpeg: false };
  }
}

export interface PixelateVideoOptions {
  image: Blob;
  mask: Blob | null;
  target: "subject" | "background" | "full";
  feather: number;
  subjectSaturation: number;
  backgroundSaturation: number;
  durationSec: number;
  easing: string;
  fps: number;
}

export interface PixelateVideoJobStatus {
  frame: number;
  total: number;
  phase: "queued" | "rendering" | "encoding" | "done" | "error";
  done: boolean;
  error: string | null;
}

export async function startPixelateVideoJob(
  options: PixelateVideoOptions,
): Promise<{ jobId: string; totalFrames: number }> {
  const form = new FormData();
  form.append("image", options.image, "source.png");
  if (options.mask) {
    form.append("mask", options.mask, "mask.png");
  }
  form.append("target", options.target);
  form.append("feather", String(options.feather));
  form.append("subject_saturation", String(options.subjectSaturation));
  form.append("background_saturation", String(options.backgroundSaturation));
  form.append("duration_sec", String(options.durationSec));
  form.append("easing", options.easing);
  form.append("fps", String(options.fps));

  const response = await fetch("/api/pixelate-video", {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(detail);
  }

  const body = (await response.json()) as { job_id: string; total_frames: number };
  return { jobId: body.job_id, totalFrames: body.total_frames };
}

export async function getPixelateVideoJobStatus(
  jobId: string,
): Promise<PixelateVideoJobStatus> {
  const response = await fetch(`/api/pixelate-video/${jobId}`);
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(detail);
  }
  const body = (await response.json()) as PixelateVideoJobStatus;
  return body;
}

export async function downloadPixelateVideoJob(jobId: string): Promise<Blob> {
  const response = await fetch(`/api/pixelate-video/${jobId}/file`);
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(detail);
  }
  return response.blob();
}

export async function pixelateVideo(options: PixelateVideoOptions): Promise<Blob> {
  const { jobId } = await startPixelateVideoJob(options);
  for (;;) {
    const status = await getPixelateVideoJobStatus(jobId);
    if (status.phase === "error") {
      throw new Error(status.error ?? "Video job failed");
    }
    if (status.done) {
      return downloadPixelateVideoJob(jobId);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function renderVideo(frames: Blob[], fps: number): Promise<Blob> {
  const form = new FormData();
  form.append("fps", String(fps));
  // Repeated "frames" parts — FastAPI collects them as list[UploadFile]; order must match frame index
  for (let i = 0; i < frames.length; i++) {
    form.append("frames", frames[i], `frame_${i}.png`);
  }

  const response = await fetch("/api/render-video", {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(detail);
  }

  return response.blob();
}

export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

export function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load mask image"));
    };
    img.src = url;
  });
}
