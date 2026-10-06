export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PolygonPoint {
  x: number;
  y: number;
}

export interface RawOcrToken {
  text: string;
  normalizedText: string;
  confidence: number;
  boundingBox: BoundingBox; // Normalized 0-1000 or raw pixel
  rawBoundingBox?: BoundingBox; // Raw pixel coords on source image
  polygon?: PolygonPoint[];
}

export interface RawOcrLineEvidence {
  text: string;
  normalizedText: string;
  confidence: number;
  boundingBox: BoundingBox;
  rawBoundingBox?: BoundingBox;
  words: RawOcrToken[];
  imageIndex: number;
}

export interface RawOcrFrameEvidence {
  imageIndex: number;
  imageWidth: number;
  imageHeight: number;
  rawText: string;
  lines: RawOcrLineEvidence[];
  averageConfidence: number;
  provider: string;
  preprocessingVariant?: string;
  timestamp: number;
}

export interface ImageQualityResult {
  blurScore: number; // 0-100
  brightnessScore: number; // 0-100
  contrastScore: number; // 0-100
  glareScore: number; // 0-100 (higher = more glare)
  reflectionScore: number; // 0-100
  resolutionScore: number; // 0-100
  coverageScore: number; // 0-100
  overallScore: number; // 0-1 (normalized)
  usable: boolean;
  issues: string[];
  guidanceMessage?: string;
}

export interface ConfidenceBreakdown {
  ocr: number;
  semantic: number;
  spatial: number;
  imageQuality: number;
  crossFrameAgreement: number;
  final: number;
}

export type FieldStatus =
  | "VERIFIED"
  | "DETECTED"
  | "DETECTED_LOCATION_UNCERTAIN"
  | "NOT_DETECTED"
  | "LOW_CONFIDENCE"
  | "UNREADABLE"
  | "UNVERIFIABLE"
  | "CONFLICTING_EVIDENCE"
  | "REQUIRES_MANUAL_REVIEW";

export interface SemanticFieldCandidate {
  field: string;
  value: string | null;
  normalizedValue?: any;
  sourceText: string | null;
  boundingBox: BoundingBox | null;
  rawBoundingBox?: BoundingBox | null;
  polygon?: PolygonPoint[] | null;
  confidence: number;
  confidenceBreakdown?: ConfidenceBreakdown;
  evidenceFrame: number | null; // 0-based image index
  extractionMethod: "ocr_pattern_match" | "gemini_vision" | "spatial_proximity" | "multi_frame_consensus" | "regex_fallback";
  status: FieldStatus;
  matchingTokens?: RawOcrToken[];
  suggestedAction?: string;
  unverifiableReason?: string;
}
