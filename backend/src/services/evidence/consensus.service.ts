import {
  RawOcrFrameEvidence,
  SemanticFieldCandidate,
  FieldStatus,
  ConfidenceBreakdown,
} from "./evidence.model.js";
import { FieldDetectors } from "./field.detectors.js";
import { StructuredDeclarations } from "../extraction/extraction.schema.js";
import { SpatialLocalizer } from "./spatial.localizer.js";

export interface ConsensusResult {
  declarations: StructuredDeclarations;
  fieldCandidates: Record<string, SemanticFieldCandidate>;
  conflicts: {
    field: string;
    values: { frameIndex: number; value: string; confidence: number }[];
    resolution: string;
  }[];
  overallConsensusConfidence: number;
}

export class MultiFrameConsensusEngine {
  /**
   * Evaluates and aggregates declaration evidence across all captured package frames.
   */
  static reconcile(
    frames: RawOcrFrameEvidence[],
    geminiDeclarations?: StructuredDeclarations,
    imageQualityScore: number = 0.8
  ): ConsensusResult {
    const conflicts: ConsensusResult["conflicts"] = [];
    const candidates: Record<string, SemanticFieldCandidate> = {};

    // 1. Run deterministic field detectors across all frames
    const deterministicCandidates: Record<string, SemanticFieldCandidate> = {
      generic_name: FieldDetectors.detectGenericName(frames),
      manufacturer: FieldDetectors.detectManufacturer(frames),
      net_quantity: FieldDetectors.detectNetQuantity(frames),
      mrp: FieldDetectors.detectMrp(frames),
      date_of_manufacture: FieldDetectors.detectDate(frames, "manufacture"),
      date_of_expiry: FieldDetectors.detectDate(frames, "expiry"),
      consumer_care: FieldDetectors.detectConsumerCare(frames),
      country_of_origin: FieldDetectors.detectCountryOfOrigin(frames),
    };

    // 2. Check for cross-frame conflicts (e.g. conflicting MRP or net qty across individual frames)
    for (const field of ["mrp", "net_quantity", "date_of_manufacture", "date_of_expiry"] as const) {
      const perFrameValues: { frameIndex: number; value: string; confidence: number }[] = [];

      for (let i = 0; i < frames.length; i++) {
        let singleFrameCand: SemanticFieldCandidate | null = null;
        if (field === "mrp") singleFrameCand = FieldDetectors.detectMrp([frames[i]]);
        else if (field === "net_quantity") singleFrameCand = FieldDetectors.detectNetQuantity([frames[i]]);
        else if (field === "date_of_manufacture") singleFrameCand = FieldDetectors.detectDate([frames[i]], "manufacture");
        else if (field === "date_of_expiry") singleFrameCand = FieldDetectors.detectDate([frames[i]], "expiry");

        if (singleFrameCand && singleFrameCand.value) {
          perFrameValues.push({
            frameIndex: i,
            value: singleFrameCand.value,
            confidence: singleFrameCand.confidence,
          });
        }
      }

      // Check if distinct values exist
      const uniqueVals = Array.from(new Set(perFrameValues.map((v) => v.value.toLowerCase().replace(/\s+/g, ""))));
      if (uniqueVals.length > 1) {
        conflicts.push({
          field,
          values: perFrameValues,
          resolution: "Marked for physical officer verification due to mismatched values across captured package angles.",
        });

        // Flag candidate status as conflicting
        if (deterministicCandidates[field]) {
          deterministicCandidates[field].status = "CONFLICTING_EVIDENCE";
          deterministicCandidates[field].confidence = Math.min(0.5, deterministicCandidates[field].confidence * 0.6);
          deterministicCandidates[field].suggestedAction = `Resolve conflicting ${field} declarations across angles.`;
        }
      }
    }

    // 3. Merge Gemini Vision Extractions with Deterministic Localizations
    const fields = [
      "generic_name",
      "manufacturer",
      "net_quantity",
      "mrp",
      "date_of_manufacture",
      "date_of_expiry",
      "consumer_care",
      "country_of_origin",
    ] as const;

    for (const field of fields) {
      const det = deterministicCandidates[field];
      const gem = geminiDeclarations ? (geminiDeclarations as any)[field] : null;

      // Determine winning candidate:
      // If deterministic detector found a value with verified bbox, prefer its exact ground-truth location.
      // If Gemini found a value, check if we can localize it in the OCR frames.
      let finalVal: string | null = null;
      let finalSource: string | null = null;
      let finalBbox = det?.boundingBox || null;
      let frameIdx: number | null = det?.evidenceFrame ?? null;
      let matchingTokens = det?.matchingTokens || [];
      let extractionMethod: SemanticFieldCandidate["extractionMethod"] = "ocr_pattern_match";
      let status: FieldStatus = det?.status || "NOT_DETECTED";
      let rawConfidence = det?.confidence || 0;

      if (det && det.value && det.status === "VERIFIED") {
        finalVal = det.value;
        finalSource = det.sourceText;
        finalBbox = det.boundingBox;
        rawConfidence = det.confidence;
        extractionMethod = "ocr_pattern_match";
        status = "VERIFIED";
      } else if (gem && gem.value) {
        finalVal = String(gem.value);
        finalSource = gem.source_text || finalVal;
        rawConfidence = Math.max(0.85, Number(gem.confidence) || 0.9);
        extractionMethod = "gemini_vision";

        // Attempt spatial localization of Gemini's extracted value against OCR frames
        let bestLoc = { bbox: null as any, matchingTokens: [] as any, confidence: 0, frameIdx: 0 };
        for (let fi = 0; fi < frames.length; fi++) {
          const loc = SpatialLocalizer.locateTextInFrame(frames[fi], finalSource || finalVal);
          if (loc.bbox && loc.confidence > bestLoc.confidence) {
            bestLoc = { ...loc, frameIdx: fi };
          }
        }

        if (bestLoc.bbox) {
          finalBbox = bestLoc.bbox;
          frameIdx = bestLoc.frameIdx;
          matchingTokens = bestLoc.matchingTokens;
          status = "VERIFIED";
        } else if (gem.bbox && SpatialLocalizer.isSpatiallyValid(gem.bbox)) {
          finalBbox = gem.bbox;
          status = "DETECTED";
        } else {
          status = "DETECTED_LOCATION_UNCERTAIN";
        }
      } else if (det && det.value) {
        finalVal = det.value;
        finalSource = det.sourceText;
        finalBbox = det.boundingBox;
        rawConfidence = det.confidence;
        status = det.status;
      }

      // Calculate Calibrated Multi-Factor Confidence Breakdown:
      // Confidence = OCR * Semantic * Spatial * Agreement * Quality
      const ocrFactor = frames.length > 0
        ? frames.reduce((acc, f) => acc + f.averageConfidence, 0) / frames.length
        : 0.85;
      const semanticFactor = finalVal ? 0.96 : 0.0;
      const spatialFactor = finalBbox ? 0.98 : 0.75;
      const agreementFactor = conflicts.some((c) => c.field === field) ? 0.45 : 1.0;
      const qualityFactor = Math.max(0.4, imageQualityScore);

      const finalScore = finalVal
        ? Math.min(
            0.99,
            Math.max(
              0.1,
              rawConfidence * 0.4 +
                ocrFactor * 0.2 +
                spatialFactor * 0.15 +
                agreementFactor * 0.15 +
                qualityFactor * 0.1
            )
          )
        : 0;

      const breakdown: ConfidenceBreakdown = {
        ocr: Math.round(ocrFactor * 100) / 100,
        semantic: Math.round(semanticFactor * 100) / 100,
        spatial: Math.round(spatialFactor * 100) / 100,
        imageQuality: Math.round(qualityFactor * 100) / 100,
        crossFrameAgreement: Math.round(agreementFactor * 100) / 100,
        final: Math.round(finalScore * 100) / 100,
      };

      candidates[field] = {
        field,
        value: finalVal,
        normalizedValue: det?.normalizedValue || (gem as any)?.normalizedValue,
        sourceText: finalSource,
        boundingBox: finalBbox,
        confidence: finalScore,
        confidenceBreakdown: breakdown,
        evidenceFrame: frameIdx,
        extractionMethod,
        status,
        matchingTokens,
        suggestedAction: det?.suggestedAction,
      };
    }

    // 4. Construct unified StructuredDeclarations
    const declarations: StructuredDeclarations = {
      generic_name: {
        value: candidates.generic_name.value,
        source_text: candidates.generic_name.sourceText,
        confidence: candidates.generic_name.confidence,
        bbox: candidates.generic_name.boundingBox,
      },
      manufacturer: {
        value: candidates.manufacturer.value,
        source_text: candidates.manufacturer.sourceText,
        confidence: candidates.manufacturer.confidence,
        bbox: candidates.manufacturer.boundingBox,
      },
      packer: {
        value: (geminiDeclarations as any)?.packer?.value || null,
        source_text: (geminiDeclarations as any)?.packer?.source_text || null,
        confidence: (geminiDeclarations as any)?.packer?.confidence || 0,
        bbox: (geminiDeclarations as any)?.packer?.bbox || null,
      },
      importer: {
        value: (geminiDeclarations as any)?.importer?.value || null,
        source_text: (geminiDeclarations as any)?.importer?.source_text || null,
        confidence: (geminiDeclarations as any)?.importer?.confidence || 0,
        bbox: (geminiDeclarations as any)?.importer?.bbox || null,
      },
      net_quantity: {
        value: candidates.net_quantity.value,
        source_text: candidates.net_quantity.sourceText,
        confidence: candidates.net_quantity.confidence,
        bbox: candidates.net_quantity.boundingBox,
        numeric_value: candidates.net_quantity.normalizedValue?.numeric_value ?? null,
        unit: candidates.net_quantity.normalizedValue?.unit ?? null,
      },
      mrp: {
        value: candidates.mrp.value,
        source_text: candidates.mrp.sourceText,
        confidence: candidates.mrp.confidence,
        bbox: candidates.mrp.boundingBox,
        numeric_value: candidates.mrp.normalizedValue?.numeric_value ?? null,
        currency: candidates.mrp.normalizedValue?.currency ?? "INR",
        is_inclusive_of_taxes: candidates.mrp.normalizedValue?.is_inclusive_of_taxes ?? true,
        unit_sale_price: null,
      },
      date_of_manufacture: {
        value: candidates.date_of_manufacture.value,
        source_text: candidates.date_of_manufacture.sourceText,
        confidence: candidates.date_of_manufacture.confidence,
        bbox: candidates.date_of_manufacture.boundingBox,
        month: null,
        year: null,
        raw_format: candidates.date_of_manufacture.sourceText,
      },
      date_of_expiry: {
        value: candidates.date_of_expiry.value,
        source_text: candidates.date_of_expiry.sourceText,
        confidence: candidates.date_of_expiry.confidence,
        bbox: candidates.date_of_expiry.boundingBox,
        month: null,
        year: null,
        raw_format: candidates.date_of_expiry.sourceText,
      },
      consumer_care: {
        value: candidates.consumer_care.value,
        source_text: candidates.consumer_care.sourceText,
        confidence: candidates.consumer_care.confidence,
        bbox: candidates.consumer_care.boundingBox,
        phone: candidates.consumer_care.normalizedValue?.phone ?? null,
        email: candidates.consumer_care.normalizedValue?.email ?? null,
        address: candidates.consumer_care.normalizedValue?.address ?? null,
      },
      country_of_origin: {
        value: candidates.country_of_origin.value,
        source_text: candidates.country_of_origin.sourceText,
        confidence: candidates.country_of_origin.confidence,
        bbox: candidates.country_of_origin.boundingBox,
      },
      other_declarations: geminiDeclarations?.other_declarations || [],
    };

    const overallConsensusConfidence =
      Object.values(candidates).reduce((acc, c) => acc + c.confidence, 0) /
      Math.max(1, Object.keys(candidates).length);

    return {
      declarations,
      fieldCandidates: candidates,
      conflicts,
      overallConsensusConfidence,
    };
  }
}
