import { detectProductAndPosition } from "./ProductDetector";
import { analyzeBrightness } from "./BrightnessAnalyzer";
import { checkStability } from "./StabilityDetector";
import { checkBlur } from "./BlurDetector";

export interface FrameQualityResult {
  isAcceptable: boolean;
  status: "GOOD_POSITION" | "TOO_DARK" | "TOO_BRIGHT" | "TOO_BLURRY" | "MOVING" | "NO_PRODUCT" | "PARTIALLY_OUTSIDE" | "TOO_SMALL";
  metrics: {
    brightness: number;
    motion: number;
    sharpness: number;
    confidence: number;
  };
}

export function evaluateFrame(
  currentFrame: Uint8ClampedArray,
  previousFrame: Uint8ClampedArray | null,
  width: number,
  height: number,
  requireStability = true
): FrameQualityResult {
  
  // 1. Basic Lighting
  const brightness = analyzeBrightness(currentFrame, width, height);
  if (brightness.status !== "GOOD") {
    return {
      isAcceptable: false,
      status: brightness.status,
      metrics: {
        brightness: brightness.score,
        motion: 0,
        sharpness: 0,
        confidence: 0
      }
    };
  }

  // 2. Product Detection & Framing
  const product = detectProductAndPosition(currentFrame, width, height);
  if (product.position !== "GOOD_POSITION") {
    // Overload types for UI
    return {
      isAcceptable: false,
      status: product.position as FrameQualityResult["status"],
      metrics: {
        brightness: brightness.score,
        motion: 0,
        sharpness: 0,
        confidence: product.confidence
      }
    };
  }
  
  // 3. Motion/Stability
  let motionScore = 0;
  if (requireStability && previousFrame) {
    const stability = checkStability(currentFrame, previousFrame, width, height);
    motionScore = stability.motionScore;
    if (!stability.isStable) {
       return {
        isAcceptable: false,
        status: "MOVING",
        metrics: {
          brightness: brightness.score,
          motion: stability.motionScore,
          sharpness: 0,
          confidence: product.confidence
        }
      };
    }
  }

  // 4. Sharpness/Blur Check (Do this last because it's expensive-ish)
  const blur = checkBlur(currentFrame, width, height);
  if (!blur.isSharp) {
    return {
      isAcceptable: false,
      status: "TOO_BLURRY",
      metrics: {
        brightness: brightness.score,
        motion: motionScore,
        sharpness: blur.score,
        confidence: product.confidence
      }
    };
  }

  return {
    isAcceptable: true,
    status: "GOOD_POSITION",
    metrics: {
      brightness: brightness.score,
      motion: motionScore,
      sharpness: blur.score,
      confidence: product.confidence
    }
  };
}
