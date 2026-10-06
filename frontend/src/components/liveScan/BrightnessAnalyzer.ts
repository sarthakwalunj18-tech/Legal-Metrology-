export interface BrightnessResult {
  status: "TOO_DARK" | "TOO_BRIGHT" | "BAD_COLOR_CAST" | "GOOD";
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
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let count = 0;

  // Sample every 8th pixel (RGBA = 32 bytes step) for accurate mean
  for (let i = 0; i < data.length; i += 32) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luma = r * 0.299 + g * 0.587 + b * 0.114;
    
    totalR += r;
    totalG += g;
    totalB += b;
    totalLuma += luma;
    count++;
  }

  const meanLuma = count > 0 ? totalLuma / count : 0;
  const meanR = count > 0 ? totalR / count : 0;
  const meanG = count > 0 ? totalG / count : 0;
  const meanB = count > 0 ? totalB / count : 0;

  let score = 100;
  let status: "TOO_DARK" | "TOO_BRIGHT" | "BAD_COLOR_CAST" | "GOOD" = "GOOD";

  // Check for extreme color cast (e.g., magenta/pink grow light)
  // If one channel dominates strongly over green (which is heavily weighted in luma), OCR drops significantly.
  // We allow some disparity, but a huge gap indicates colored lighting.
  const isExtremeColorCast = (meanR > meanG * 2.5 && meanB > meanG * 2.0 && meanR > 100) || 
                             (Math.abs(meanR - meanB) < 30 && meanG < (meanR * 0.3) && meanR > 80);

  if (meanLuma < 20) {
    status = "TOO_DARK";
    score = Math.max(0, Math.round((meanLuma / 20) * 40));
  } else if (meanLuma > 235) {
    status = "TOO_BRIGHT";
    score = Math.max(0, Math.round(((255 - meanLuma) / 20) * 40));
  } else if (isExtremeColorCast) {
    status = "BAD_COLOR_CAST";
    // Significantly penalize lighting score to prevent capture
    score = 30;
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
