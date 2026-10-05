export function checkStability(
  currentFrame: Uint8ClampedArray,
  previousFrame: Uint8ClampedArray | null,
  width: number,
  height: number,
  motionThreshold = 8
): { isStable: boolean; motionScore: number } {
  if (!previousFrame || currentFrame.length !== previousFrame.length) {
    return { isStable: false, motionScore: -1 };
  }

  let totalDiff = 0;
  let count = 0;

  // Sample every 4th pixel for speed
  for (let i = 0; i < currentFrame.length; i += 16) {
    const cg = currentFrame[i] * 0.299 + currentFrame[i + 1] * 0.587 + currentFrame[i + 2] * 0.114;
    const pg = previousFrame[i] * 0.299 + previousFrame[i + 1] * 0.587 + previousFrame[i + 2] * 0.114;
    
    totalDiff += Math.abs(cg - pg);
    count++;
  }

  const motionScore = totalDiff / count;
  
  return {
    isStable: motionScore < motionThreshold,
    motionScore
  };
}
