import { StructuredDeclarations } from "../extraction/extraction.schema.js";
import { ClassificationResult } from "../classification/classifier.service.js";
import { IValidator, ValidationCheckResult, EvidenceQuality, gateAbsenceFinding } from "./validators/validator.interface.js";
import { PresenceValidator } from "./validators/presence.validator.js";
import { MRPValidator } from "./validators/mrp.validator.js";
import { QuantityValidator } from "./validators/quantity.validator.js";
import { DateValidator } from "./validators/date.validator.js";
import { VisionQualityValidator } from "./validators/vision.validator.js";
import { PlacementValidator } from "./validators/placement.validator.js";
import { RagLegalService, LegalContextChunk } from "../rag/rag.service.js";

export interface EnrichedViolation extends ValidationCheckResult {
  legalContext?: LegalContextChunk[];
}

export interface ComplianceDecision {
  complianceStatus: "COMPLIANT" | "NON_COMPLIANT" | "REQUIRES_REVIEW";
  complianceScore: number; // 0 - 100
  summary: {
    totalChecks: number;
    passed: number; // For UI mapping to COMPLIANT
    failed: number; // For UI mapping to VIOLATION
    requiresReview: number; // NEEDS_REVIEW
    unverifiable: number;
    notApplicable: number;
  };
  violations: EnrichedViolation[];
  passedChecks: ValidationCheckResult[];
  reviewChecks: ValidationCheckResult[];
  unverifiableChecks: ValidationCheckResult[];
  classification: ClassificationResult;
  retrievedContext: LegalContextChunk[];
  disclaimer: string;
}

export class ComplianceDecisionEngine {
  private static validators: IValidator[] = [
    new PresenceValidator(),
    new MRPValidator(),
    new QuantityValidator(),
    new DateValidator(),
    new VisionQualityValidator(),
    new PlacementValidator(),
  ];

  static async evaluate(
    declarations: StructuredDeclarations,
    classification: ClassificationResult,
    rawOcrText: string,
    evidence?: EvidenceQuality
  ): Promise<ComplianceDecision> {
    const queryParts: string[] = [];
    if (classification.category) queryParts.push(`Category: ${classification.category}`);
    if (classification.commodityType) queryParts.push(`Commodity Type: ${classification.commodityType}`);
    if (declarations.generic_name?.value) queryParts.push(`Commodity: ${declarations.generic_name.value}`);
    if (declarations.net_quantity?.value) queryParts.push(`Net quantity: ${declarations.net_quantity.value}`);
    if (declarations.mrp?.value) queryParts.push(`MRP: ${declarations.mrp.value}`);
    if (declarations.consumer_care?.value) queryParts.push(`Consumer Care: ${declarations.consumer_care.value}`);
    if (declarations.country_of_origin?.value) queryParts.push(`Country of Origin: ${declarations.country_of_origin.value}`);

    const dynamicQuery = queryParts.length > 0
      ? `Packaged commodity statutory compliance requirements for ${queryParts.join(", ")}. Mandatory declarations under Rule 6, MRP, net quantity, consumer care, and origin.`
      : `Mandatory declarations for packaged commodities under Legal Metrology Rules, 2011 Rule 6.`;

    const ragStart = Date.now();
    const retrievedContext = await RagLegalService.retrieveLegalContext(
      dynamicQuery,
      classification.category,
      4
    );

    const compStart = Date.now();
    const allChecks: ValidationCheckResult[] = [];
    for (const validator of this.validators) {
      const results = validator.validate(declarations, classification, rawOcrText, evidence);
      allChecks.push(...results);
    }
    const compTime = Date.now() - compStart;

    const gated = allChecks.map((c) => gateAbsenceFinding(c, evidence));

    const passedChecks = gated.filter((c) => c.status === "COMPLIANT");
    const failedChecks = gated.filter((c) => c.status === "VIOLATION");
    const reviewChecks = gated.filter((c) => c.status === "NEEDS_REVIEW");
    const unverifiableChecks = gated.filter((c) => c.status === "UNVERIFIABLE");
    const naChecks = gated.filter((c) => c.status === "NOT_APPLICABLE");

    const violations: EnrichedViolation[] = failedChecks.map((check) => {
      const checkNumber = check.ruleNumber;
      const checkTitle = (check.title || "").toLowerCase();
      const legalContext = retrievedContext.filter(
        (c) =>
          (checkNumber && c.ruleNumber === checkNumber) ||
          (checkTitle && (c.text || "").toLowerCase().includes(checkTitle)),
      );
      return {
        ...check,
        legalContext: legalContext.slice(0, 2),
      };
    });

    const evaluatedFields = passedChecks.length + failedChecks.length + unverifiableChecks.length + reviewChecks.length;
    let score = 0;
    if (evaluatedFields > 0) {
      // Compliance rate requires verifiable evidence. Unverifiable counts against the score.
      score = Math.round((passedChecks.length / evaluatedFields) * 100);
    } else {
      score = 0;
    }

    let complianceStatus: "COMPLIANT" | "NON_COMPLIANT" | "REQUIRES_REVIEW";
    if (failedChecks.length > 0) {
      complianceStatus = "NON_COMPLIANT";
    } else if (reviewChecks.length > 0 || unverifiableChecks.length > 0) {
      complianceStatus = "REQUIRES_REVIEW";
    } else {
      complianceStatus = "COMPLIANT";
    }

    return {
      complianceStatus,
      complianceScore: score, // Pure % based on actual verified fields
      summary: {
        totalChecks: allChecks.length,
        passed: passedChecks.length,
        failed: failedChecks.length,
        requiresReview: reviewChecks.length,
        unverifiable: unverifiableChecks.length,
        notApplicable: naChecks.length,
      },
      violations,
      passedChecks,
      reviewChecks,
      unverifiableChecks,
      classification,
      retrievedContext,
      disclaimer: "Automated screening assists enforcement officers. Final regulatory determination remains subject to authorized officer review.",
    };
  }
}
