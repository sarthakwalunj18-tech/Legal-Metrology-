export interface StabilityResult {
  isStable: boolean;
  score: number;
  motionRaw: number;
}

export function checkStability(
  currentFrame: Uint8ClampedArray,
  previousFrame: Uint8ClampedArray | null,
  width: number,
  height: number
): StabilityResult {
  if (!previousFrame || currentFrame.length !== previousFrame.length) {
    // If no previous frame, assume neutral initial stability
    return { isStable: true, score: 80, motionRaw: 0 };
  }

  let totalDiff = 0;
  let count = 0;

  // Sample every 4th pixel for high responsiveness
  for (let i = 0; i < currentFrame.length; i += 16) {
    const cg = currentFrame[i] * 0.299 + currentFrame[i + 1] * 0.587 + currentFrame[i + 2] * 0.114;
    const pg = previousFrame[i] * 0.299 + previousFrame[i + 1] * 0.587 + previousFrame[i + 2] * 0.114;

    totalDiff += Math.abs(cg - pg);
    count++;
  }

  const motionRaw = count > 0 ? totalDiff / count : 0;

  // Micro-tremor / subtle hand movement: motionRaw < 5.0
  // Intentional rotation or rapid movement: motionRaw > 8.0
  let score = 100;
  if (motionRaw > 3.5) {
    score = Math.max(0, Math.round(100 - (motionRaw - 3.5) * 10));
  }

  return {
    isStable: score >= 45, // Accommodates natural human holding
    score,
    motionRaw
  };
}
