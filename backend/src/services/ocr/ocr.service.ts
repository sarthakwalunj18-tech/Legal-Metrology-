import { IOcrProvider, OcrResult } from "./ocr.interface.js";
import { GoogleCloudVisionOcrProvider } from "./google-vision.ocr.js";
import { TesseractOcrProvider } from "./tesseract.ocr.js";
import crypto from "crypto";

export class OcrService {
  private static googleProvider = new GoogleCloudVisionOcrProvider();
  private static tesseractProvider = new TesseractOcrProvider();

  // Phase 28: Image content hash caching (SHA-256 → OCR result cache)
  private static cache = new Map<string, OcrResult>();

  /**
   * Extracts text from packaging images using Google Cloud Vision when credentials
   * exist, falling back to local Tesseract.js. No provider fabricates content: if
   * OCR cannot read a panel it returns the poor text it actually saw, so callers
   * can judge evidence quality rather than trust invented declarations.
   */
  static async extract(imageBuffer: Buffer): Promise<OcrResult> {
    const hash = crypto.createHash("sha256").update(imageBuffer).digest("hex");
    if (this.cache.has(hash)) {
      console.log(`[OCR] Cache hit for image SHA-256: ${hash.substring(0, 8)}...`);
      return this.cache.get(hash)!;
    }

    let result: OcrResult;
    try {
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_VISION_API_KEY) {
        try {
          result = await this.googleProvider.extractText(imageBuffer);
        } catch (err: any) {
          console.warn(
            `[OCR] Google Cloud Vision failed (${err.message}), falling back to local Tesseract.js`
          );
          result = await this.tesseractProvider.extractText(imageBuffer);
        }
      } else {
        // Resilient fallback to Tesseract.js / local OCR
        result = await this.tesseractProvider.extractText(imageBuffer);
      }
    } catch (finalErr: any) {
      console.error(`[OCR] FATAL ERROR across all OCR providers for this image: ${finalErr.message}`);
      // Return bare minimal empty result so pipeline can continue relying entirely purely on Gemini Vision
      result = {
        rawText: "[OCR UNAVAILABLE]",
        averageConfidence: 0,
        lines: [],
        provider: "unknown",
        processingTimeMs: 0
      };
    }

    // Retain up to 100 images in memory to bound footprint
    if (this.cache.size >= 100) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(hash, result);
    return result;
  }
}
