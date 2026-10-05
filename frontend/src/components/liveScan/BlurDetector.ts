export interface BlurResult {
  isSharp: boolean;
  score: number;
  rawSharpness: number;
}

export function checkBlur(
  data: Uint8ClampedArray,
  width: number,
  height: number
): BlurResult {
  if (!data?.length || width < 4 || height < 4) {
    return { isSharp: false, score: 0, rawSharpness: 0 };
  }

  let totalGradient = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const idx = (y * width + x) * 4;
      const right = idx + 4;
      const down = idx + width * 4;

      const current = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      const r = data[right] * 0.299 + data[right + 1] * 0.587 + data[right + 2] * 0.114;
      const d = data[down] * 0.299 + data[down + 1] * 0.587 + data[down + 2] * 0.114;

      totalGradient += Math.abs(current - r) + Math.abs(current - d);
      count += 2;
    }
  }

  const rawSharpness = count > 0 ? totalGradient / count : 0;

  // Normalizing:
  // Heavily blurred or out-of-focus: rawSharpness < 2.5
  // Readable package text: rawSharpness between 4.0 and 12.0+
  // We award a score up to 100 based on standard package detail
  let score = Math.min(100, Math.round((rawSharpness / 6.5) * 100));

  return {
    isSharp: score >= 35, // Accessible threshold for real-world webcams
    score,
    rawSharpness
  };
}
