export function detectProductAndPosition(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 30
): { detected: boolean; position: string; confidence: number; boundingBox?: any } {
  // We divide the image into a 3x3 grid
  // We want the central area to have high contrast/details (product)
  // We want the extreme edges to have low variance (background)
  // This is a fast, lightweight heuristic since full YOLO is too heavy.

  if (!data?.length || width < 3 || height < 3) {
    return { detected: false, position: "NO_FRAME", confidence: 0 };
  }

  const cellW = Math.floor(width / 3);
  const cellH = Math.floor(height / 3);

  let centerVariance = 0;
  let edgeVariance = 0;
  let centerCount = 0;
  let edgeCount = 0;

  // Compute simple variance approximation per region
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const idx = (y * width + x) * 4;
      const gray = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      
      const isCenter = x > cellW && x < width - cellW && y > cellH && y < height - cellH;
      
      // Look at neighbor for crude gradient
      if (x < width - 4) {
        const nextIdx = (y * width + x + 4) * 4;
        const nextGray = data[nextIdx] * 0.299 + data[nextIdx + 1] * 0.587 + data[nextIdx + 2] * 0.114;
        const diff = Math.abs(gray - nextGray);
        
        if (isCenter) {
          centerVariance += diff;
          centerCount++;
        } else {
          // Edges are the top/bottom 10% and left/right 10%
          if (x < cellW * 0.5 || x > width - cellW * 0.5 || y < cellH * 0.5 || y > height - cellH * 0.5) {
            edgeVariance += diff;
            edgeCount++;
          }
        }
      }
    }
  }

  const avgCenter = centerCount > 0 ? centerVariance / centerCount : 0;
  const avgEdge = edgeCount > 0 ? edgeVariance / edgeCount : 0;

  // Product Detection Logic
  // A clear product will have high variance in the center and low variance on the edges.
  const confidence = Math.min(1, avgCenter / (threshold * 2));
  
  if (avgCenter < threshold) {
    return { detected: false, position: "NO_PRODUCT", confidence };
  }

  if (avgEdge > threshold * 0.8) {
    return { detected: true, position: "PARTIALLY_OUTSIDE", confidence };
  }

  if (avgCenter > threshold * 3 && avgEdge < threshold * 0.3) {
      // Very tiny product in the absolute center
      return { detected: true, position: "TOO_SMALL", confidence };
  }

  return { detected: true, position: "GOOD_POSITION", confidence };
}
