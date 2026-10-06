import { BoundingBox, RawOcrFrameEvidence, RawOcrLineEvidence, RawOcrToken } from "./evidence.model.js";

export class SpatialLocalizer {
  /**
   * Normalizes pixel coordinates to standard 0-1000 scale.
   */
  static normalizePixelBox(
    box: { x1: number; y1: number; x2: number; y2: number },
    imageWidth: number,
    imageHeight: number
  ): BoundingBox {
    const w = Math.max(1, imageWidth);
    const h = Math.max(1, imageHeight);

    const x1 = Math.round(Math.max(0, Math.min(1000, (box.x1 / w) * 1000)));
    const y1 = Math.round(Math.max(0, Math.min(1000, (box.y1 / h) * 1000)));
    const x2 = Math.round(Math.max(0, Math.min(1000, (box.x2 / w) * 1000)));
    const y2 = Math.round(Math.max(0, Math.min(1000, (box.y2 / h) * 1000)));

    return {
      x1: Math.min(x1, x2),
      y1: Math.min(y1, y2),
      x2: Math.max(x1, x2),
      y2: Math.max(y1, y2),
    };
  }

  /**
   * Combines multiple bounding boxes into an enveloping union bounding box.
   */
  static unionBoundingBox(boxes: (BoundingBox | undefined | null)[]): BoundingBox | null {
    const validBoxes = boxes.filter((b): b is BoundingBox => Boolean(b && typeof b.x1 === "number" && typeof b.y1 === "number"));
    if (validBoxes.length === 0) return null;

    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;

    for (const box of validBoxes) {
      x1 = Math.min(x1, box.x1, box.x2);
      y1 = Math.min(y1, box.y1, box.y2);
      x2 = Math.max(x2, box.x1, box.x2);
      y2 = Math.max(y2, box.y1, box.y2);
    }

    // Safety clamp to [0, 1000]
    return {
      x1: Math.max(0, Math.min(1000, Math.round(x1))),
      y1: Math.max(0, Math.min(1000, Math.round(y1))),
      x2: Math.max(0, Math.min(1000, Math.round(x2))),
      y2: Math.max(0, Math.min(1000, Math.round(y2))),
    };
  }

  /**
   * Validates if a bounding box is spatially reasonable on a 0-1000 scale.
   */
  static isSpatiallyValid(box: BoundingBox | null | undefined): boolean {
    if (!box) return false;
    const width = box.x2 - box.x1;
    const height = box.y2 - box.y1;

    // Must have positive dimensions
    if (width <= 2 || height <= 2) return false;

    // Must be within canvas
    if (box.x1 < 0 || box.y1 < 0 || box.x2 > 1000 || box.y2 > 1000) return false;

    // Cannot take 98%+ of the whole image (likely a false full-page box)
    if (width >= 990 && height >= 990) return false;

    return true;
  }

  /**
   * Calculates euclidean distance between two bounding box centers on 0-1000 scale.
   */
  static boxDistance(a: BoundingBox, b: BoundingBox): number {
    const centerA = { x: (a.x1 + a.x2) / 2, y: (a.y1 + a.y2) / 2 };
    const centerB = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
    const dx = centerA.x - centerB.x;
    const dy = centerA.y - centerB.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Searches OCR frame lines and words to locate the exact bounding box for a given target text/value.
   */
  static locateTextInFrame(
    frame: RawOcrFrameEvidence,
    targetText: string,
    anchorKeywords: string[] = []
  ): { bbox: BoundingBox | null; matchingTokens: RawOcrToken[]; confidence: number } {
    if (!targetText || !targetText.trim() || frame.lines.length === 0) {
      return { bbox: null, matchingTokens: [], confidence: 0 };
    }

    const cleanTarget = targetText.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!cleanTarget) {
      return { bbox: null, matchingTokens: [], confidence: 0 };
    }

    // 1. Direct exact or substring line match
    for (const line of frame.lines) {
      const cleanLine = line.text.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (cleanLine.includes(cleanTarget) || cleanTarget.includes(cleanLine)) {
        // If line has word tokens, find the subset of words that match target
        const matchedWords = line.words.filter((w) => {
          const cw = w.text.toLowerCase().replace(/[^a-z0-9]/g, "");
          return cw.length > 0 && (cleanTarget.includes(cw) || cw.includes(cleanTarget));
        });

        if (matchedWords.length > 0) {
          const unionBox = this.unionBoundingBox(matchedWords.map((w) => w.boundingBox));
          if (this.isSpatiallyValid(unionBox)) {
            return {
              bbox: unionBox,
              matchingTokens: matchedWords,
              confidence: line.confidence,
            };
          }
        }

        if (this.isSpatiallyValid(line.boundingBox)) {
          return {
            bbox: line.boundingBox,
            matchingTokens: line.words,
            confidence: line.confidence,
          };
        }
      }
    }

    // 2. Token-level matching across multi-word phrases
    const targetWords = targetText
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z0-9]/g, ""))
      .filter((w) => w.length > 1);

    if (targetWords.length > 0) {
      const matchingTokens: RawOcrToken[] = [];
      let totalConfidence = 0;

      for (const line of frame.lines) {
        for (const token of line.words) {
          const cleanToken = token.text.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (cleanToken && targetWords.some((tw) => cleanToken.includes(tw) || tw.includes(cleanToken))) {
            matchingTokens.push(token);
            totalConfidence += token.confidence;
          }
        }
      }

      if (matchingTokens.length >= Math.ceil(targetWords.length * 0.5)) {
        const unionBox = this.unionBoundingBox(matchingTokens.map((t) => t.boundingBox));
        if (this.isSpatiallyValid(unionBox)) {
          return {
            bbox: unionBox,
            matchingTokens,
            confidence: totalConfidence / matchingTokens.length,
          };
        }
      }
    }

    // 3. Anchor keyword spatial proximity fallback
    // e.g. If target is "₹40", search for line with "MRP" and look at the nearest number box
    if (anchorKeywords.length > 0) {
      for (const keyword of anchorKeywords) {
        const cleanKw = keyword.toLowerCase().replace(/[^a-z0-9]/g, "");
        const anchorLine = frame.lines.find((l) =>
          l.text.toLowerCase().replace(/[^a-z0-9]/g, "").includes(cleanKw)
        );

        if (anchorLine && this.isSpatiallyValid(anchorLine.boundingBox)) {
          // If the anchor line itself has text resembling the target
          return {
            bbox: anchorLine.boundingBox,
            matchingTokens: anchorLine.words,
            confidence: anchorLine.confidence * 0.85, // slight discount for anchor proximity
          };
        }
      }
    }

    return { bbox: null, matchingTokens: [], confidence: 0 };
  }
}
