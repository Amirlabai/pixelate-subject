export type PixelateTarget = "subject" | "background" | "full";
export type PreviewMode = "original" | "result";
export type BrushMode = "add" | "remove";
export type SegmentModel = "general" | "people" | "fast";
export type VideoEasing =
  | "linear"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "ease-in-cubic"
  | "ease-out-cubic";

export interface AppParams {
  target: PixelateTarget;
  blockSize: number;
  feather: number;
  showSelection: boolean;
  overlayOpacity: number;
  brushSize: number;
  previewMode: PreviewMode;
  segmentModel: SegmentModel;
  alphaMatting: boolean;
  maskThreshold: number;
  maskExpand: number;
  subjectSaturation: number;
  backgroundSaturation: number;
  videoDurationSec: number;
  videoEasing: VideoEasing;
}

export interface AppState {
  maskCanvas: HTMLCanvasElement | null;
  resultCanvas: HTMLCanvasElement | null;
  params: AppParams;
  brushMode: BrushMode;
  hasResult: boolean;
  cropMode: boolean;
}

export function createDefaultParams(): AppParams {
  return {
    target: "subject",
    blockSize: 16,
    feather: 4,
    showSelection: true,
    overlayOpacity: 40,
    brushSize: 24,
    previewMode: "original",
    segmentModel: "general",
    alphaMatting: false,
    maskThreshold: 100,
    maskExpand: 0,
    subjectSaturation: 100,
    backgroundSaturation: 100,
    videoDurationSec: 2,
    videoEasing: "ease-out",
  };
}

export function createInitialState(): AppState {
  return {
    maskCanvas: null,
    resultCanvas: null,
    params: createDefaultParams(),
    brushMode: "add",
    hasResult: false,
    cropMode: false,
  };
}

export const MAX_PREVIEW_EDGE = 2048;

export function fitPreviewSize(width: number, height: number): { width: number; height: number } {
  const maxEdge = Math.max(width, height);
  if (maxEdge <= MAX_PREVIEW_EDGE) {
    return { width, height };
  }
  const scale = MAX_PREVIEW_EDGE / maxEdge;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}
