export interface ProductDetectionResult {
  detected: boolean;
  position: "GOOD_POSITION" | "NO_PRODUCT" | "PARTIALLY_OUTSIDE" | "TOO_SMALL" | "HUMAN_FACE_REJECTED";
  presenceScore: number;
  framingScore: number;
  detailCount: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
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

  let skinPixels = 0;

  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;

  // Step 2x2 through the frame for high speed and thorough spatial coverage
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const idx = (y * width + x) * 4;
      const rightIdx = idx + 4;
      const downIdx = idx + width * 4;

      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      const luma = r * 0.299 + g * 0.587 + b * 0.114;
      const gr = data[rightIdx] * 0.299 + data[rightIdx + 1] * 0.587 + data[rightIdx + 2] * 0.114;
      const gd = data[downIdx] * 0.299 + data[downIdx + 1] * 0.587 + data[downIdx + 2] * 0.114;

      // Combined 2D gradient magnitude
      const grad = Math.abs(luma - gr) + Math.abs(luma - gd);

      const isCenter = x >= leftMargin && x <= rightMargin && y >= topMargin && y <= bottomMargin;

      // Basic skin tone heuristic to prevent capturing faces instead of products
      if (
        r > 95 && g > 40 && b > 20 &&
        r > g && r > b &&
        Math.abs(r - g) > 15 &&
        Math.max(r, g, b) - Math.min(r, g, b) > 15
      ) {
        skinPixels++;
      }

      // Check for sharp edges (text, barcodes, product outlines)
      // Increasing the threshold heavily to ignore soft gradients (like faces/clothes)
      if (grad > 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

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
  const skinRatio = totalSamples > 0 ? skinPixels / totalSamples : 0;

  // Presence score based heavily on sharp structural detail (text, edges)
  let presenceScore = Math.min(100, Math.round((detailRatio / 0.05) * 100));

  // Determine framing & position
  let position: ProductDetectionResult["position"] = "GOOD_POSITION";
  let framingScore = 80;

  if (skinRatio > 0.08 && presenceScore < 55) {
    // If significantly skin-colored and lacks extreme high-contrast geometries, it's a person/face.
    position = "HUMAN_FACE_REJECTED";
    framingScore = 0;
    presenceScore = 0; // Force rejection
  } else if (presenceScore < 15 && totalDetails < 10) {
    position = "NO_PRODUCT";
    framingScore = 0;
  } else if (centerDetailRatio < 0.015 && edgeDetail > centerDetail * 3) {
    position = "PARTIALLY_OUTSIDE";
    framingScore = 40;
  } else if (centerDetail < 6 && totalDetails < 15) {
    position = "TOO_SMALL";
    framingScore = 45;
  } else {
    position = "GOOD_POSITION";
    framingScore = Math.min(100, 60 + Math.round((centerDetailRatio / 0.06) * 40));
  }

  // Construct a padded bounding box if product found
  let boundingBox;
  if (position === "GOOD_POSITION" || position === "PARTIALLY_OUTSIDE" || position === "TOO_SMALL") {
    // Add 10% padding
    const padX = Math.round((maxX - minX) * 0.1);
    const padY = Math.round((maxY - minY) * 0.1);

    const bx = Math.max(0, minX - padX);
    const by = Math.max(0, minY - padY);
    const bw = Math.min(width - bx, (maxX - minX) + Math.round(padX * 2));
    const bh = Math.min(height - by, (maxY - minY) + Math.round(padY * 2));

    boundingBox = { x: bx, y: by, width: bw, height: bh };
  }

  return {
    detected: presenceScore >= 20 && position !== "HUMAN_FACE_REJECTED",
    position,
    presenceScore,
    framingScore,
    detailCount: totalDetails,
    boundingBox
  };
}
