export function checkBlur(
  data: Uint8ClampedArray, 
  width: number, 
  height: number,
  threshold = 8
): { isSharp: boolean; score: number } {
  if (!data?.length || width < 3 || height < 3) return { isSharp: false, score: 0 };
  
  let total = 0;
  let count = 0;
  
  // Calculate gradients using adjacent pixels
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const idx = (y * width + x) * 4;
      const right = idx + 4;
      const down = idx + width * 4;
      
      const current = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      const r = data[right] * 0.299 + data[right + 1] * 0.587 + data[right + 2] * 0.114;
      const d = data[down] * 0.299 + data[down + 1] * 0.587 + data[down + 2] * 0.114;
      
      total += Math.abs(current - r) + Math.abs(current - d);
      count += 2;
    }
  }
  
  const sharpnessScore = count ? total / count : 0;
  
  return {
    isSharp: sharpnessScore > threshold,
    score: sharpnessScore
  };
}
