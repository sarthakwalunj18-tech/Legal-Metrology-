export function analyzeBrightness(
  data: Uint8ClampedArray,
  width: number,
  height: number
): { status: "TOO_DARK" | "TOO_BRIGHT" | "GOOD"; score: number } {
  if (!data?.length) return { status: "TOO_DARK", score: 0 };

  let totalLuma = 0;
  let count = 0;
  
  // Sample every 4th pixel to save CPU
  for (let i = 0; i < data.length; i += 16) {
    const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    totalLuma += luma;
    count++;
  }

  const meanBrightness = totalLuma / count;

  if (meanBrightness < 40) {
    return { status: "TOO_DARK", score: meanBrightness };
  }

  if (meanBrightness > 220) {
    return { status: "TOO_BRIGHT", score: meanBrightness };
  }

  return { status: "GOOD", score: meanBrightness };
}
