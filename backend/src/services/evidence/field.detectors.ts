import { RawOcrFrameEvidence, SemanticFieldCandidate, FieldStatus } from "./evidence.model.js";
import { SpatialLocalizer } from "./spatial.localizer.js";

export class FieldDetectors {
  /**
   * Detects MRP (Maximum Retail Price) with strict pattern validation and unit normalization.
   */
  static detectMrp(frames: RawOcrFrameEvidence[]): SemanticFieldCandidate {
    const mrpPatterns = [
      /(?:MRP|M\.R\.P\.|Max(?:imum)?\s*Retail\s*Price)[\s:.]*(?:Rs\.?|₹|INR)?\s*(\d+(?:\.\d{1,2})?)/i,
      /(?:Rs\.?|₹)\s*(\d+(?:\.\d{1,2})?)[\s:.]*(?:incl|inclusive|incl\.|max|mrp)/i,
      /(?:MRP|M\.R\.P\.)\s*(\d+(?:\.\d{1,2})?)/i,
    ];

    for (let fIdx = 0; fIdx < frames.length; fIdx++) {
      const frame = frames[fIdx];
      for (const line of frame.lines) {
        for (const pattern of mrpPatterns) {
          const match = line.text.match(pattern);
          if (match) {
            const rawAmount = match[1];
            const numVal = parseFloat(rawAmount);

            // Plausibility check: MRP is rarely 0 or > 1000000 for standard retail pack
            if (numVal > 0 && numVal < 1000000) {
              const fullText = line.text;
              const hasTaxes = /(?:incl(?:usive)?\.?\s*(?:of)?\s*(?:all)?\s*taxes)/i.test(frame.rawText);

              const localization = SpatialLocalizer.locateTextInFrame(
                frame,
                `₹${rawAmount}`,
                ["MRP", "M.R.P.", "Rs.", "₹", "Max Retail Price"]
              );

              return {
                field: "mrp",
                value: `₹${rawAmount}`,
                normalizedValue: {
                  numeric_value: numVal,
                  currency: "INR",
                  is_inclusive_of_taxes: hasTaxes,
                },
                sourceText: fullText,
                boundingBox: localization.bbox || line.boundingBox,
                confidence: Math.min(0.98, line.confidence * 0.95),
                evidenceFrame: fIdx,
                extractionMethod: "ocr_pattern_match",
                status: localization.bbox ? "VERIFIED" : "DETECTED_LOCATION_UNCERTAIN",
                matchingTokens: localization.matchingTokens,
              };
            }
          }
        }
      }
    }

    return {
      field: "mrp",
      value: null,
      sourceText: null,
      boundingBox: null,
      confidence: 0,
      evidenceFrame: null,
      extractionMethod: "ocr_pattern_match",
      status: "NOT_DETECTED",
      suggestedAction: "Rotate package to display clear MRP statement on label.",
    };
  }

  /**
   * Detects Net Quantity and normalizes standard Legal Metrology units.
   */
  static detectNetQuantity(frames: RawOcrFrameEvidence[]): SemanticFieldCandidate {
    const qtyPatterns = [
      /(?:Net\s*(?:Qty|Quantity|Wt|Weight|Volume|Mass|Content))[\s:.]*(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|ml|l|ltr|litre|liter|N|units?|tablets?|capsules?|packs?)\b/i,
      /\b(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|ml|l|ltr|litre|liter|N)\s*(?:when\s*packed|net)/i,
      /\b(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/i,
    ];

    for (let fIdx = 0; fIdx < frames.length; fIdx++) {
      const frame = frames[fIdx];
      for (const line of frame.lines) {
        for (const pattern of qtyPatterns) {
          const match = line.text.match(pattern);
          if (match) {
            const rawNum = match[1];
            let rawUnit = (match[2] || "").toLowerCase();

            // Normalize unit to standard SI / Rule 11 symbols
            if (rawUnit === "gm" || rawUnit === "gms") rawUnit = "g";
            if (rawUnit === "ltr" || rawUnit === "litre" || rawUnit === "liter") rawUnit = "L";
            if (rawUnit === "ml") rawUnit = "ml";
            if (rawUnit === "kg") rawUnit = "kg";
            if (rawUnit === "g") rawUnit = "g";

            const numVal = parseFloat(rawNum);
            if (numVal > 0) {
              const formattedVal = `${numVal} ${rawUnit}`;
              const localization = SpatialLocalizer.locateTextInFrame(
                frame,
                formattedVal,
                ["Net Quantity", "Net Qty", "Net Wt", "Net Weight", "Net Volume", rawUnit]
              );

              return {
                field: "net_quantity",
                value: formattedVal,
                normalizedValue: {
                  numeric_value: numVal,
                  unit: rawUnit,
                },
                sourceText: line.text,
                boundingBox: localization.bbox || line.boundingBox,
                confidence: Math.min(0.98, line.confidence * 0.96),
                evidenceFrame: fIdx,
                extractionMethod: "ocr_pattern_match",
                status: localization.bbox ? "VERIFIED" : "DETECTED_LOCATION_UNCERTAIN",
                matchingTokens: localization.matchingTokens,
              };
            }
          }
        }
      }
    }

    return {
      field: "net_quantity",
      value: null,
      sourceText: null,
      boundingBox: null,
      confidence: 0,
      evidenceFrame: null,
      extractionMethod: "ocr_pattern_match",
      status: "NOT_DETECTED",
      suggestedAction: "Ensure Net Quantity is displayed conspicuously on the Principal Display Panel.",
    };
  }

  /**
   * Detects Manufacturing and Expiry Dates with strict format validation.
   */
  static detectDate(frames: RawOcrFrameEvidence[], type: "manufacture" | "expiry"): SemanticFieldCandidate {
    const fieldName = type === "manufacture" ? "date_of_manufacture" : "date_of_expiry";

    const mfgPatterns = [
      /(?:Mfg\.?\s*(?:Date|Dt)?|Date\s*of\s*Mfg|Packed\s*(?:Date|Dt)?|Month\s*&\s*Year|PKD|MFD)[\s:.]*([0-3]?\d[\/-][0-1]?\d[\/-]20\d{2}|[0-1]?\d[\/-]20\d{2}|[0-1]?\d[\/-]\d{2}|[a-zA-Z]{3,9}\s*20\d{2})/i,
      /(?:MFG|MFD|PKD)[\s:.]*([0-1]?\d[\/-]\d{2,4})/i,
    ];

    const expPatterns = [
      /(?:Exp(?:iry)?\s*(?:Date|Dt)?|Use\s*By|Best\s*Before|Best-before|Best\s*Before\s*Date|EXP)[\s:.]*([0-3]?\d[\/-][0-1]?\d[\/-]20\d{2}|[0-1]?\d[\/-]20\d{2}|[0-1]?\d[\/-]\d{2}|[a-zA-Z]{3,9}\s*20\d{2}|(?:6|12|18|24)\s*months\s*(?:from|after)?)/i,
      /(?:BEST\s*BEFORE)[\s:.]*(\d+\s*MONTHS(?:\s*FROM\s*(?:MFG|MANUFACTURE|PACKAGING))?)/i,
    ];

    const patterns = type === "manufacture" ? mfgPatterns : expPatterns;
    const anchorKeywords = type === "manufacture" ? ["MFG", "MFD", "PKD", "Date of Mfg", "Manufactured"] : ["EXP", "EXPIRY", "USE BY", "BEST BEFORE"];

    for (let fIdx = 0; fIdx < frames.length; fIdx++) {
      const frame = frames[fIdx];
      for (const line of frame.lines) {
        for (const pattern of patterns) {
          const match = line.text.match(pattern);
          if (match) {
            const rawDate = match[1].trim();

            const localization = SpatialLocalizer.locateTextInFrame(
              frame,
              rawDate,
              anchorKeywords
            );

            return {
              field: fieldName,
              value: rawDate,
              normalizedValue: {
                raw_format: rawDate,
              },
              sourceText: line.text,
              boundingBox: localization.bbox || line.boundingBox,
              confidence: Math.min(0.95, line.confidence * 0.92),
              evidenceFrame: fIdx,
              extractionMethod: "ocr_pattern_match",
              status: localization.bbox ? "VERIFIED" : "DETECTED_LOCATION_UNCERTAIN",
              matchingTokens: localization.matchingTokens,
            };
          }
        }
      }
    }

    return {
      field: fieldName,
      value: null,
      sourceText: null,
      boundingBox: null,
      confidence: 0,
      evidenceFrame: null,
      extractionMethod: "ocr_pattern_match",
      status: "NOT_DETECTED",
      suggestedAction: `Ensure ${type === "manufacture" ? "Date of Manufacture" : "Expiry / Best Before Date"} is legibly stamped.`,
    };
  }

  /**
   * Detects Manufacturer / Packer Details.
   */
  static detectManufacturer(frames: RawOcrFrameEvidence[]): SemanticFieldCandidate {
    const mfgPatterns = [
      /(?:Mfd\.?\s*by|Manufactured\s*(?:&|and)?\s*(?:Marketed|Packed)?\s*by|Packed\s*by|Mfg\s*by)[:\s]*([^\n]{5,100})/i,
      /(?:Marketed\s*by|Imported\s*by)[:\s]*([^\n]{5,100})/i,
    ];

    for (let fIdx = 0; fIdx < frames.length; fIdx++) {
      const frame = frames[fIdx];
      for (const line of frame.lines) {
        for (const pattern of mfgPatterns) {
          const match = line.text.match(pattern);
          if (match) {
            const mfgName = match[1].trim();
            if (mfgName.length >= 3) {
              const localization = SpatialLocalizer.locateTextInFrame(
                frame,
                mfgName,
                ["Manufactured by", "Mfd by", "Packed by", "Marketed by"]
              );

              return {
                field: "manufacturer",
                value: mfgName,
                sourceText: line.text,
                boundingBox: localization.bbox || line.boundingBox,
                confidence: Math.min(0.96, line.confidence * 0.94),
                evidenceFrame: fIdx,
                extractionMethod: "ocr_pattern_match",
                status: localization.bbox ? "VERIFIED" : "DETECTED_LOCATION_UNCERTAIN",
                matchingTokens: localization.matchingTokens,
              };
            }
          }
        }
      }
    }

    return {
      field: "manufacturer",
      value: null,
      sourceText: null,
      boundingBox: null,
      confidence: 0,
      evidenceFrame: null,
      extractionMethod: "ocr_pattern_match",
      status: "NOT_DETECTED",
      suggestedAction: "Rotate package to display complete name and physical address of manufacturer/packer.",
    };
  }

  /**
   * Detects Consumer Care Grievance details (Phone, Email, Address).
   */
  static detectConsumerCare(frames: RawOcrFrameEvidence[]): SemanticFieldCandidate {
    const phonePattern = /(?:Consumer\s*Care|Customer\s*Care|Helpline|Toll\s*Free|Grievance|Call|Ph|Tel)[:\s\-•]*(1800[-\s]?[0-9]{3,4}[-\s]?[0-9]{3,4}|\+91[-\s]?[0-9]{10}|[1-9][0-9]{3,4}[-\s]?[0-9]{3,7})/i;
    const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;

    let phone: string | null = null;
    let email: string | null = null;
    let matchingFrameIdx: number | null = null;
    let matchedLine: any = null;

    for (let fIdx = 0; fIdx < frames.length; fIdx++) {
      const frame = frames[fIdx];
      for (const line of frame.lines) {
        if (!phone) {
          const pm = line.text.match(phonePattern);
          if (pm) {
            phone = pm[1].trim();
            matchingFrameIdx = fIdx;
            matchedLine = line;
          }
        }
        if (!email) {
          const em = line.text.match(emailPattern);
          if (em) {
            email = em[1].trim();
            matchingFrameIdx = fIdx;
            matchedLine = line;
          }
        }
      }
    }

    if (phone || email) {
      const value = [phone ? `Phone: ${phone}` : "", email ? `Email: ${email}` : ""].filter(Boolean).join(", ");
      const frame = frames[matchingFrameIdx || 0];
      const localization = frame
        ? SpatialLocalizer.locateTextInFrame(frame, phone || email || "", ["Consumer Care", "Customer Care", "Helpline", "Email"])
        : { bbox: null, matchingTokens: [], confidence: 0 };

      return {
        field: "consumer_care",
        value,
        normalizedValue: { phone, email, address: null },
        sourceText: matchedLine?.text || value,
        boundingBox: localization.bbox || matchedLine?.boundingBox || null,
        confidence: 0.94,
        evidenceFrame: matchingFrameIdx,
        extractionMethod: "ocr_pattern_match",
        status: localization.bbox ? "VERIFIED" : "DETECTED_LOCATION_UNCERTAIN",
        matchingTokens: localization.matchingTokens,
      };
    }

    return {
      field: "consumer_care",
      value: null,
      sourceText: null,
      boundingBox: null,
      confidence: 0,
      evidenceFrame: null,
      extractionMethod: "ocr_pattern_match",
      status: "NOT_DETECTED",
      suggestedAction: "Provide consumer grievance officer contact info under Rule 6(1)(f).",
    };
  }

  /**
   * Detects Country of Origin.
   */
  static detectCountryOfOrigin(frames: RawOcrFrameEvidence[]): SemanticFieldCandidate {
    const originPattern = /(?:Country\s*of\s*Origin|Made\s*in|Product\s*of|Manufactured\s*in)[:\s]*([a-zA-Z\s]{3,20})/i;

    for (let fIdx = 0; fIdx < frames.length; fIdx++) {
      const frame = frames[fIdx];
      for (const line of frame.lines) {
        const match = line.text.match(originPattern);
        if (match) {
          const country = match[1].trim();
          if (country.length >= 3 && !/^(the|this|all|our)$/i.test(country)) {
            const localization = SpatialLocalizer.locateTextInFrame(
              frame,
              country,
              ["Country of Origin", "Made in", "Product of"]
            );

            return {
              field: "country_of_origin",
              value: country,
              sourceText: line.text,
              boundingBox: localization.bbox || line.boundingBox,
              confidence: Math.min(0.97, line.confidence * 0.95),
              evidenceFrame: fIdx,
              extractionMethod: "ocr_pattern_match",
              status: localization.bbox ? "VERIFIED" : "DETECTED_LOCATION_UNCERTAIN",
              matchingTokens: localization.matchingTokens,
            };
          }
        }
      }
    }

    return {
      field: "country_of_origin",
      value: null,
      sourceText: null,
      boundingBox: null,
      confidence: 0,
      evidenceFrame: null,
      extractionMethod: "ocr_pattern_match",
      status: "NOT_DETECTED",
      suggestedAction: "Mandatory Country of Origin declaration required under 2017 Amendment.",
    };
  }

  /**
   * Detects Generic / Common Commodity Name.
   */
  static detectGenericName(frames: RawOcrFrameEvidence[]): SemanticFieldCandidate {
    const genericPatterns = [
      /(?:Product|Item|Commodity|Generic\s*Name)[:\s]*([A-Z0-9\s-]{3,50})/i,
      /\b([A-Z\s]{4,30}(?:CHIPS|WATER|DRINK|OIL|RICE|ATTA|FLOUR|BISCUITS|SOAP|TEA|COFFEE|HONEY|JUICE|SNACKS|NAMKEEN))\b/i,
    ];

    for (let fIdx = 0; fIdx < frames.length; fIdx++) {
      const frame = frames[fIdx];
      for (const line of frame.lines) {
        for (const pattern of genericPatterns) {
          const match = line.text.match(pattern);
          if (match) {
            const name = match[1].trim();
            if (name.length >= 3) {
              const localization = SpatialLocalizer.locateTextInFrame(
                frame,
                name,
                ["Generic Name", "Commodity", "Product"]
              );

              return {
                field: "generic_name",
                value: name,
                sourceText: line.text,
                boundingBox: localization.bbox || line.boundingBox,
                confidence: Math.min(0.95, line.confidence * 0.92),
                evidenceFrame: fIdx,
                extractionMethod: "ocr_pattern_match",
                status: localization.bbox ? "VERIFIED" : "DETECTED_LOCATION_UNCERTAIN",
                matchingTokens: localization.matchingTokens,
              };
            }
          }
        }
      }
    }

    // Fallback: pick the first prominent line from frame 0
    if (frames.length > 0 && frames[0].lines.length > 0) {
      const firstProminent = frames[0].lines.find((l) => l.text.length >= 4 && l.text.length <= 40);
      if (firstProminent) {
        return {
          field: "generic_name",
          value: firstProminent.text,
          sourceText: firstProminent.text,
          boundingBox: firstProminent.boundingBox,
          confidence: 0.85,
          evidenceFrame: 0,
          extractionMethod: "ocr_pattern_match",
          status: "DETECTED",
          matchingTokens: firstProminent.words,
        };
      }
    }

    return {
      field: "generic_name",
      value: null,
      sourceText: null,
      boundingBox: null,
      confidence: 0,
      evidenceFrame: null,
      extractionMethod: "ocr_pattern_match",
      status: "NOT_DETECTED",
      suggestedAction: "Generic name of commodity must be placed prominently on Principal Display Panel.",
    };
  }
}
