/** Live mask tuning applied after detection (no re-run needed). */

export function processMask(raw: ImageData, threshold: number, expand: number): ImageData {
  const { width, height, data } = raw;
  const size = width * height;
  let values = new Uint8Array(size);

  for (let i = 0; i < size; i++) {
    values[i] = data[i * 4] >= threshold ? 255 : 0;
  }

  if (expand !== 0) {
    values = new Uint8Array(morphCircular(values, width, height, expand));
  }

  const out = new ImageData(width, height);
  for (let i = 0; i < size; i++) {
    const v = values[i];
    const o = i * 4;
    out.data[o] = v;
    out.data[o + 1] = v;
    out.data[o + 2] = v;
    out.data[o + 3] = 255;
  }
  return out;
}

export function dilateBinaryMask(
  mask: ImageData,
  radius: number,
  threshold = 128,
): ImageData {
  const { width, height, data } = mask;
  const size = width * height;
  let values = new Uint8Array(size);

  for (let i = 0; i < size; i++) {
    values[i] = data[i * 4] >= threshold ? 255 : 0;
  }

  if (radius > 0) {
    values = new Uint8Array(morphCircular(values, width, height, radius));
  }

  const out = new ImageData(width, height);
  for (let i = 0; i < size; i++) {
    const v = values[i];
    const o = i * 4;
    out.data[o] = v;
    out.data[o + 1] = v;
    out.data[o + 2] = v;
    out.data[o + 3] = 255;
  }
  return out;
}

function morphCircular(
  data: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius === 0) return data;

  const r = Math.abs(radius);
  const dilate = radius > 0;
  const out = new Uint8Array(data.length);
  const r2 = r * r;

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height - 1, y + r);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width - 1, x + r);
      let best = dilate ? 0 : 255;

      for (let ny = y0; ny <= y1; ny++) {
        for (let nx = x0; nx <= x1; nx++) {
          const dx = nx - x;
          const dy = ny - y;
          if (dx * dx + dy * dy > r2) continue;
          const v = data[ny * width + nx];
          best = dilate ? Math.max(best, v) : Math.min(best, v);
        }
      }
      out[y * width + x] = best;
    }
  }

  return out;
}

export function imageDataFromMaskImage(img: HTMLImageElement): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read mask image");
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
