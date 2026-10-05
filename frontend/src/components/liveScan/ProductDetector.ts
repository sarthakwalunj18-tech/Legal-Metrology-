export interface ProductDetectionResult {
  detected: boolean;
  position: "GOOD_POSITION" | "NO_PRODUCT" | "PARTIALLY_OUTSIDE" | "TOO_SMALL";
  presenceScore: number;
  framingScore: number;
  detailCount: number;
}

export function detectProductAndPosition(
  data: Uint8ClampedArray,
  width: number,
  height: number
): ProductDetectionResult {
  if (!data?.length || width < 4 || height < 4) {
    return { detected: false, position: "NO_PRODUCT", presenceScore: 0, framingScore: 0, detailCount: 0 };
  }

  // Margin definitions (20% on each edge)
  const leftMargin = width * 0.2;
  const rightMargin = width * 0.8;
  const topMargin = height * 0.2;
  const bottomMargin = height * 0.8;

  let centerDetail = 0;
  let edgeDetail = 0;
  let centerSamples = 0;
  let edgeSamples = 0;

  // Step 2x2 through the frame for high speed and thorough spatial coverage
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const idx = (y * width + x) * 4;
      const rightIdx = idx + 4;
      const downIdx = idx + width * 4;

      const g = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      const gr = data[rightIdx] * 0.299 + data[rightIdx + 1] * 0.587 + data[rightIdx + 2] * 0.114;
      const gd = data[downIdx] * 0.299 + data[downIdx + 1] * 0.587 + data[downIdx + 2] * 0.114;

      // Combined 2D gradient magnitude
      const grad = Math.abs(g - gr) + Math.abs(g - gd);

      const isCenter = x >= leftMargin && x <= rightMargin && y >= topMargin && y <= bottomMargin;

      if (grad > 6) { // detail threshold
        if (isCenter) {
          centerDetail++;
        } else {
          edgeDetail++;
        }
      }

      if (isCenter) {
        centerSamples++;
      } else {
        edgeSamples++;
      }
    }
  }

  const totalDetails = centerDetail + edgeDetail;
  const totalSamples = centerSamples + edgeSamples;
  const detailRatio = totalSamples > 0 ? totalDetails / totalSamples : 0;
  const centerDetailRatio = centerSamples > 0 ? centerDetail / centerSamples : 0;

  // Presence score:
  // Packaged commodities with text/graphics easily exhibit >= 3% gradient pixels.
  // 1.5% gives a baseline score of 50. >= 4% gives 100.
  let presenceScore = Math.min(100, Math.round((detailRatio / 0.04) * 100));

  // Determine framing & position
  let position: "GOOD_POSITION" | "NO_PRODUCT" | "PARTIALLY_OUTSIDE" | "TOO_SMALL" = "GOOD_POSITION";
  let framingScore = 80;

  if (presenceScore < 15 && totalDetails < 8) {
    // Blank wall, lens covered, or empty background
    position = "NO_PRODUCT";
    framingScore = 0;
  } else if (centerDetailRatio < 0.01 && edgeDetail > centerDetail * 4) {
    // Product is clipping the extreme border and completely empty in the center
    position = "PARTIALLY_OUTSIDE";
    framingScore = 40;
  } else if (centerDetail < 4 && totalDetails < 12) {
    // Tiny speck in the distance
    position = "TOO_SMALL";
    framingScore = 45;
  } else {
    // Good central coverage - suitable for OCR
    position = "GOOD_POSITION";
    framingScore = Math.min(100, 60 + Math.round((centerDetailRatio / 0.05) * 40));
  }

  return {
    detected: presenceScore >= 18,
    position,
    presenceScore,
    framingScore,
    detailCount: totalDetails
  };
}
