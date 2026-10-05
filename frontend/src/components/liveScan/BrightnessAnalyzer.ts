export interface BrightnessResult {
  status: "TOO_DARK" | "TOO_BRIGHT" | "GOOD";
  score: number;
  meanLuma: number;
}

export function analyzeBrightness(
  data: Uint8ClampedArray,
  width: number,
  height: number
): BrightnessResult {
  if (!data?.length) {
    return { status: "TOO_DARK", score: 0, meanLuma: 0 };
  }

  let totalLuma = 0;
  let count = 0;

  // Sample every 8th pixel (RGBA = 32 bytes step) for accurate mean
  for (let i = 0; i < data.length; i += 32) {
    const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    totalLuma += luma;
    count++;
  }

  const meanLuma = count > 0 ? totalLuma / count : 0;

  let score = 100;
  let status: "TOO_DARK" | "TOO_BRIGHT" | "GOOD" = "GOOD";

  if (meanLuma < 20) {
    // Too dark to read text
    status = "TOO_DARK";
    score = Math.max(0, Math.round((meanLuma / 20) * 40));
  } else if (meanLuma > 235) {
    // Blown out flash / direct glare
    status = "TOO_BRIGHT";
    score = Math.max(0, Math.round(((255 - meanLuma) / 20) * 40));
  } else {
    status = "GOOD";
    // Peak score (100) around 60-190, smoothly tapering slightly towards the bounds
    if (meanLuma < 50) {
      score = 70 + Math.round(((meanLuma - 20) / 30) * 30);
    } else if (meanLuma > 200) {
      score = 70 + Math.round(((235 - meanLuma) / 35) * 30);
    } else {
      score = 100;
    }
  }

  return { status, score, meanLuma };
}
