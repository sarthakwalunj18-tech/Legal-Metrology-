import { StructuredDeclarations } from "../../extraction/extraction.schema.js";
import { ClassificationResult } from "../../classification/classifier.service.js";

// New explicitly robust compliance states matching legal workflows
export type CheckStatus =
  | "COMPLIANT"
  | "VIOLATION"
  | "UNVERIFIABLE"
  | "NOT_APPLICABLE"
  | "NEEDS_REVIEW";

export type SeverityLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNVERIFIABLE";

export interface ValidationCheckResult {
  ruleId: string;
  ruleNumber: string;
  fieldName: string;
  status: CheckStatus;
  severity: SeverityLevel;
  title: string;
  reason: string;
  evidence: string;
  confidence: number;
  boundingBox?: { x1: number; y1: number; x2: number; y2: number } | null;
  suggestedAction?: string;
  isEstimatedMeasurement?: boolean;
}

/**
 * How trustworthy the evidence from this scan actually is. A CRITICAL statutory
 * failure must never rest on a scan the pipeline itself could not read reliably.
 */
export interface EvidenceQuality {
  /** Mean OCR confidence across package images (0..1). */
  ocrConfidence: number;
  /** True when Gemini vision was unavailable and regex fallback was used. */
  extractionDegraded: boolean;
}

export interface IValidator {
  name: string;
  validate(
    declarations: StructuredDeclarations,
    classification: ClassificationResult,
    rawText: string,
    evidence?: EvidenceQuality
  ): ValidationCheckResult[];
}

/** OCR below this mean confidence cannot substantiate an "absent declaration" finding. */
export const LOW_OCR_CONFIDENCE = 0.6;

/**
 * Downgrades an absence-based finding from VIOLATION to UNVERIFIABLE when the scan
 * evidence is too weak to support a definitive conclusion, or if the system is in degraded mode.
 */
export function gateAbsenceFinding(
  check: ValidationCheckResult,
  evidence?: EvidenceQuality,
): ValidationCheckResult {
  if (check.status === "NOT_APPLICABLE" || check.status === "COMPLIANT") return check;

  if (!evidence) {
    if (check.status === "VIOLATION") {
      // If we literally have no evidence quality object, we can't be sure it's a true violation for missing fields.
      // But typically we do have evidence.
    }
  } else {
    const weak = evidence.extractionDegraded || evidence.ocrConfidence < LOW_OCR_CONFIDENCE;

    if (weak && check.status === "VIOLATION") {
      const why = evidence.extractionDegraded
        ? "vision extraction was unavailable"
        : `mean OCR confidence was only ${(evidence.ocrConfidence * 100).toFixed(0)}%`;

      return {
        ...check,
        status: "UNVERIFIABLE",
        severity: "UNVERIFIABLE",
        confidence: Math.min(check.confidence, 0.4),
        reason:
          `${check.reason} However, this cannot be substantiated from this scan because ${why}.`,
        evidence: `${check.evidence} [EVIDENCE INSUFFICIENT: ${why}]`,
        suggestedAction:
          check.suggestedAction ??
          "Re-capture the declaration panel at higher resolution under even lighting, or verify physically before issuing notice.",
      };
    }
  }

  return check;
}
