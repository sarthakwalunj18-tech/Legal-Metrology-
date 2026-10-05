export interface HashProfile {
  signature: number[];
  timestamp: number;
}

export function signatureFromFrame(data: Uint8ClampedArray, width: number, height: number): number[] {
  const columns = 24;
  const rows = 32;
  const signature: number[] = [];
  
  if (!data?.length) return signature;
  
  for (let y = 0; y < rows; y += 1) {
    const sy = Math.min(height - 1, Math.floor((y / rows) * height));
    for (let x = 0; x < columns; x += 1) {
      const sx = Math.min(width - 1, Math.floor((x / columns) * width));
      const idx = (sy * width + sx) * 4;
      const gray = Math.round(data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114);
      signature.push(gray);
    }
  }
  return signature;
}

export function visualSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i]);
  // Normalize difference. Max difference per pixel is 255.
  return 1 - total / (a.length * 255);
}

export class DuplicateDetector {
  private history: HashProfile[] = [];
  private similarityThreshold: number;

  constructor(similarityThreshold = 0.82) {
    this.similarityThreshold = similarityThreshold;
  }

  public checkDuplicate(signature: number[]): boolean {
    for (const profile of this.history) {
      const similarity = visualSimilarity(signature, profile.signature);
      if (similarity >= this.similarityThreshold) {
        return true; 
      }
    }
    return false;
  }

  public addSignature(signature: number[]) {
    this.history.push({
      signature,
      timestamp: Date.now()
    });
    
    // Keep bounded
    if (this.history.length > 50) {
      this.history.shift();
    }
  }

  public clearSession() {
    this.history = [];
  }
  
  public getCount() {
    return this.history.length;
  }
}
