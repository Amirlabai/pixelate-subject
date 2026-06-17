export type StretchDirection = "horizontal" | "vertical";

export function fillDirectionalToEdges(
  image: ImageData,
  mask: ImageData,
  direction: StretchDirection,
  threshold = 128,
): ImageData {
  const { width, height } = image;
  const out = new ImageData(width, height);
  out.data.set(image.data);
  const dst = out.data;
  const src = image.data;
  const maskData = mask.data;

  const isMasked = (x: number, y: number): boolean =>
    maskData[(y * width + x) * 4] >= threshold;

  if (direction === "horizontal") {
    const leftSrc = new Int32Array(width);
    const rightSrc = new Int32Array(width);

    for (let y = 0; y < height; y++) {
      let last = -1;
      for (let x = 0; x < width; x++) {
        if (isMasked(x, y)) last = x;
        leftSrc[x] = last;
      }
      last = -1;
      for (let x = width - 1; x >= 0; x--) {
        if (isMasked(x, y)) last = x;
        rightSrc[x] = last;
      }

      for (let x = 0; x < width; x++) {
        if (isMasked(x, y)) continue;
        const l = leftSrc[x];
        const r = rightSrc[x];
        if (l < 0 && r < 0) continue;

        let srcX: number;
        if (l < 0) srcX = r;
        else if (r < 0) srcX = l;
        else srcX = x - l <= r - x ? l : r;

        const fo = (y * width + srcX) * 4;
        const to = (y * width + x) * 4;
        dst[to] = src[fo];
        dst[to + 1] = src[fo + 1];
        dst[to + 2] = src[fo + 2];
      }
    }
  } else {
    const aboveSrc = new Int32Array(height);
    const belowSrc = new Int32Array(height);

    for (let x = 0; x < width; x++) {
      let last = -1;
      for (let y = 0; y < height; y++) {
        if (isMasked(x, y)) last = y;
        aboveSrc[y] = last;
      }
      last = -1;
      for (let y = height - 1; y >= 0; y--) {
        if (isMasked(x, y)) last = y;
        belowSrc[y] = last;
      }

      for (let y = 0; y < height; y++) {
        if (isMasked(x, y)) continue;
        const a = aboveSrc[y];
        const b = belowSrc[y];
        if (a < 0 && b < 0) continue;

        let srcY: number;
        if (a < 0) srcY = b;
        else if (b < 0) srcY = a;
        else srcY = y - a <= b - y ? a : b;

        const fo = (srcY * width + x) * 4;
        const to = (y * width + x) * 4;
        dst[to] = src[fo];
        dst[to + 1] = src[fo + 1];
        dst[to + 2] = src[fo + 2];
      }
    }
  }

  return out;
}

export function fillOutwardUnderMask(
  image: ImageData,
  mask: ImageData,
  radius: number,
  threshold = 128,
): ImageData {
  const { width, height } = image;
  const out = new ImageData(width, height);
  out.data.set(image.data);

  if (radius <= 0) return out;

  const size = width * height;
  const extended = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    extended[i] = mask.data[i * 4] >= threshold ? 1 : 0;
  }

  const dst = out.data;

  for (let step = 0; step < radius; step++) {
    const prev = new Uint8Array(extended);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (prev[i]) continue;

        const o = i * 4;
        let no = -1;

        if (x > 0 && prev[i - 1]) no = (i - 1) * 4;
        else if (x < width - 1 && prev[i + 1]) no = (i + 1) * 4;
        else if (y > 0 && prev[i - width]) no = (i - width) * 4;
        else if (y < height - 1 && prev[i + width]) no = (i + width) * 4;

        if (no >= 0) {
          dst[o] = dst[no];
          dst[o + 1] = dst[no + 1];
          dst[o + 2] = dst[no + 2];
          extended[i] = 1;
        }
      }
    }
  }

  return out;
}
