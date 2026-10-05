import { detectProductAndPosition, ProductDetectionResult } from "./ProductDetector";
import { analyzeBrightness, BrightnessResult } from "./BrightnessAnalyzer";
import { checkStability, StabilityResult } from "./StabilityDetector";
import { checkBlur, BlurResult } from "./BlurDetector";

export interface FrameQualityResult {
  isAcceptable: boolean;
  status:
    | "GOOD_POSITION"
    | "TOO_DARK"
    | "TOO_BRIGHT"
    | "TOO_BLURRY"
    | "MOVING"
    | "NO_PRODUCT"
    | "PARTIALLY_OUTSIDE"
    | "TOO_SMALL";
  qualityScore: number;
  metrics: {
    presence: number;
    framing: number;
    brightness: number;
    sharpness: number;
    stability: number;
  };
}

export function evaluateFrame(
  currentFrame: Uint8ClampedArray,
  previousFrame: Uint8ClampedArray | null,
  width: number,
  height: number,
  requireStability = true
): FrameQualityResult {
  // 1. Lighting analysis
  const brightness: BrightnessResult = analyzeBrightness(currentFrame, width, height);

  // 2. Product presence & framing
  const product: ProductDetectionResult = detectProductAndPosition(currentFrame, width, height);

  // 3. Motion stability
  const stability: StabilityResult = requireStability
    ? checkStability(currentFrame, previousFrame, width, height)
    : { isStable: true, score: 100, motionRaw: 0 };

  // 4. Sharpness / Blur analysis
  const blur: BlurResult = checkBlur(currentFrame, width, height);

  // Composite Quality Score (0-100)
  const qualityScore = Math.round(
    product.presenceScore * 0.30 +
    product.framingScore * 0.15 +
    blur.score * 0.20 +
    brightness.score * 0.10 +
    stability.score * 0.25
  );

  const metrics = {
    presence: product.presenceScore,
    framing: product.framingScore,
    brightness: brightness.score,
    sharpness: blur.score,
    stability: stability.score
  };

  // Diagnostic status determination with clear priority
  let status: FrameQualityResult["status"] = "GOOD_POSITION";

  if (!product.detected || product.presenceScore < 18) {
    status = "NO_PRODUCT";
  } else if (brightness.status === "TOO_DARK") {
    status = "TOO_DARK";
  } else if (brightness.status === "TOO_BRIGHT") {
    status = "TOO_BRIGHT";
  } else if (!stability.isStable) {
    status = "MOVING";
  } else if (!blur.isSharp) {
    status = "TOO_BLURRY";
  } else if (product.position === "PARTIALLY_OUTSIDE" && product.framingScore < 50) {
    status = "PARTIALLY_OUTSIDE";
  } else if (product.position === "TOO_SMALL" && product.framingScore < 50) {
    status = "TOO_SMALL";
  } else {
    status = "GOOD_POSITION";
  }

  // A frame is acceptable for OCR when:
  // - Product is detected with sufficient detail
  // - Lighting is acceptable
  // - Hand/product is sufficiently stable
  // - Image is reasonably sharp
  // - Overall composite quality score >= 58
  const isAcceptable =
    status === "GOOD_POSITION" &&
    qualityScore >= 58 &&
    product.detected &&
    blur.isSharp &&
    stability.isStable;

  return {
    isAcceptable,
    status,
    qualityScore,
    metrics
  };
}
