import { SpatialLocalizer } from "../services/evidence/spatial.localizer.js";
import { FieldDetectors } from "../services/evidence/field.detectors.js";
import { MultiFrameConsensusEngine } from "../services/evidence/consensus.service.js";
import { ImageQualityAssessor } from "../services/evidence/quality.assessor.js";
import { RawOcrFrameEvidence, RawOcrLineEvidence, RawOcrToken } from "../services/evidence/evidence.model.js";

async function runEvidenceTests() {
  console.log("====================================================");
  console.log("   LEGAL METROLOGY OCR & EVIDENCE HARDENING SUITE   ");
  console.log("====================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${testName} ${detail ? `(${detail})` : ""}`);
      failed++;
    }
  }

  // --- TEST 1: Spatial Localizer Normalization & Union Bounding Boxes ---
  console.log("\n[TEST 1] Spatial Localizer Coordinate Normalization & Box Union");
  const pixelBox = { x1: 100, y1: 200, x2: 300, y2: 400 };
  const normalized = SpatialLocalizer.normalizePixelBox(pixelBox, 1000, 2000);
  assert(
    normalized.x1 === 100 && normalized.y1 === 100 && normalized.x2 === 300 && normalized.y2 === 200,
    "Normalize pixel box to 0-1000 standard",
    JSON.stringify(normalized)
  );

  const union = SpatialLocalizer.unionBoundingBox([
    { x1: 100, y1: 100, x2: 200, y2: 200 },
    { x1: 150, y1: 150, x2: 350, y2: 250 },
  ]);
  assert(
    union?.x1 === 100 && union?.y1 === 100 && union?.x2 === 350 && union?.y2 === 250,
    "Union bounding box correctly envelops multiple word boxes",
    JSON.stringify(union)
  );

  // --- TEST 2: Field-Specific Detectors ---
  console.log("\n[TEST 2] Deterministic Field-Specific Detectors");

  const sampleFrame1: RawOcrFrameEvidence = {
    imageIndex: 0,
    imageWidth: 1000,
    imageHeight: 1000,
    rawText: "BALAJI WAFERS PVT LTD\nMRP Rs. 20.00 (Incl. of all taxes)\nNet Qty: 50 g\nMFD: 10/2026\nEXP: 04/2027\nConsumer Care: 1800-233-1234\nMade in India",
    lines: [
      {
        text: "BALAJI WAFERS PVT LTD",
        normalizedText: "balaji wafers pvt ltd",
        confidence: 0.95,
        boundingBox: { x1: 100, y1: 100, x2: 900, y2: 150 },
        words: [
          { text: "BALAJI", normalizedText: "balaji", confidence: 0.95, boundingBox: { x1: 100, y1: 100, x2: 300, y2: 150 } },
          { text: "WAFERS", normalizedText: "wafers", confidence: 0.95, boundingBox: { x1: 320, y1: 100, x2: 550, y2: 150 } },
        ],
        imageIndex: 0,
      },
      {
        text: "MRP Rs. 20.00 (Incl. of all taxes)",
        normalizedText: "mrp rs. 20.00 (incl. of all taxes)",
        confidence: 0.96,
        boundingBox: { x1: 100, y1: 200, x2: 800, y2: 250 },
        words: [
          { text: "MRP", normalizedText: "mrp", confidence: 0.96, boundingBox: { x1: 100, y1: 200, x2: 200, y2: 250 } },
          { text: "Rs.", normalizedText: "rs.", confidence: 0.96, boundingBox: { x1: 220, y1: 200, x2: 280, y2: 250 } },
          { text: "20.00", normalizedText: "20.00", confidence: 0.96, boundingBox: { x1: 300, y1: 200, x2: 450, y2: 250 } },
        ],
        imageIndex: 0,
      },
      {
        text: "Net Qty: 50 g",
        normalizedText: "net qty: 50 g",
        confidence: 0.94,
        boundingBox: { x1: 100, y1: 300, x2: 500, y2: 350 },
        words: [
          { text: "Net", normalizedText: "net", confidence: 0.94, boundingBox: { x1: 100, y1: 300, x2: 180, y2: 350 } },
          { text: "Qty:", normalizedText: "qty:", confidence: 0.94, boundingBox: { x1: 200, y1: 300, x2: 300, y2: 350 } },
          { text: "50", normalizedText: "50", confidence: 0.94, boundingBox: { x1: 320, y1: 300, x2: 400, y2: 350 } },
          { text: "g", normalizedText: "g", confidence: 0.94, boundingBox: { x1: 420, y1: 300, x2: 460, y2: 350 } },
        ],
        imageIndex: 0,
      },
      {
        text: "MFD: 10/2026",
        normalizedText: "mfd: 10/2026",
        confidence: 0.93,
        boundingBox: { x1: 100, y1: 400, x2: 400, y2: 450 },
        words: [],
        imageIndex: 0,
      },
      {
        text: "Consumer Care: 1800-233-1234",
        normalizedText: "consumer care: 1800-233-1234",
        confidence: 0.95,
        boundingBox: { x1: 100, y1: 500, x2: 700, y2: 550 },
        words: [],
        imageIndex: 0,
      },
      {
        text: "Made in India",
        normalizedText: "made in india",
        confidence: 0.97,
        boundingBox: { x1: 100, y1: 600, x2: 450, y2: 650 },
        words: [],
        imageIndex: 0,
      },
    ],
    averageConfidence: 0.95,
    provider: "tesseract",
    timestamp: Date.now(),
  };

  const mrpCandidate = FieldDetectors.detectMrp([sampleFrame1]);
  assert(mrpCandidate.value === "₹20.00", "MRP extracted & formatted", mrpCandidate.value || "null");
  assert(mrpCandidate.normalizedValue?.numeric_value === 20, "MRP numeric value normalized", String(mrpCandidate.normalizedValue?.numeric_value));
  assert(mrpCandidate.normalizedValue?.is_inclusive_of_taxes === true, "MRP tax inclusion detected", String(mrpCandidate.normalizedValue?.is_inclusive_of_taxes));

  const qtyCandidate = FieldDetectors.detectNetQuantity([sampleFrame1]);
  assert(qtyCandidate.value === "50 g", "Net Quantity detected", qtyCandidate.value || "null");
  assert(qtyCandidate.normalizedValue?.unit === "g", "Unit standardized to Rule 11 symbols (g)", qtyCandidate.normalizedValue?.unit);

  const mfgCandidate = FieldDetectors.detectDate([sampleFrame1], "manufacture");
  assert(mfgCandidate.value === "10/2026", "MFD date detected", mfgCandidate.value || "null");

  const ccCandidate = FieldDetectors.detectConsumerCare([sampleFrame1]);
  assert(ccCandidate.value?.includes("1800-233-1234") === true, "Consumer Care toll-free detected", ccCandidate.value || "null");

  const originCandidate = FieldDetectors.detectCountryOfOrigin([sampleFrame1]);
  assert(originCandidate.value?.toLowerCase() === "india", "Country of Origin detected", originCandidate.value || "null");

  // --- TEST 3: Multi-Frame Consensus & Conflict Detection ---
  console.log("\n[TEST 3] Multi-Frame Consensus & Cross-Frame Conflict Detection");

  const sampleFrame2Conflicting: RawOcrFrameEvidence = {
    imageIndex: 1,
    imageWidth: 1000,
    imageHeight: 1000,
    rawText: "MRP Rs. 35.00\nNet Qty: 50 g",
    lines: [
      {
        text: "MRP Rs. 35.00",
        normalizedText: "mrp rs. 35.00",
        confidence: 0.94,
        boundingBox: { x1: 100, y1: 200, x2: 500, y2: 250 },
        words: [],
        imageIndex: 1,
      },
      {
        text: "Net Qty: 50 g",
        normalizedText: "net qty: 50 g",
        confidence: 0.95,
        boundingBox: { x1: 100, y1: 300, x2: 400, y2: 350 },
        words: [],
        imageIndex: 1,
      },
    ],
    averageConfidence: 0.94,
    provider: "tesseract",
    timestamp: Date.now(),
  };

  const consensusConflict = MultiFrameConsensusEngine.reconcile([sampleFrame1, sampleFrame2Conflicting]);
  assert(
    consensusConflict.conflicts.length > 0 && consensusConflict.conflicts[0].field === "mrp",
    "Conflicting MRP detected across frame 0 (₹20.00) vs frame 1 (₹35.00)",
    JSON.stringify(consensusConflict.conflicts)
  );
  assert(
    consensusConflict.fieldCandidates.mrp.status === "CONFLICTING_EVIDENCE",
    "Candidate flagged as CONFLICTING_EVIDENCE",
    consensusConflict.fieldCandidates.mrp.status
  );

  // --- TEST 4: Non-Conflicting Frame Consensus ---
  const sampleFrame2Agreeing: RawOcrFrameEvidence = {
    imageIndex: 1,
    imageWidth: 1000,
    imageHeight: 1000,
    rawText: "MRP Rs. 20.00\nNet Qty: 50 g",
    lines: [
      {
        text: "MRP Rs. 20.00",
        normalizedText: "mrp rs. 20.00",
        confidence: 0.96,
        boundingBox: { x1: 100, y1: 200, x2: 500, y2: 250 },
        words: [],
        imageIndex: 1,
      },
    ],
    averageConfidence: 0.96,
    provider: "tesseract",
    timestamp: Date.now(),
  };

  const consensusAgreement = MultiFrameConsensusEngine.reconcile([sampleFrame1, sampleFrame2Agreeing]);
  assert(consensusAgreement.conflicts.length === 0, "No conflicts when frames agree", "Conflicts: " + consensusAgreement.conflicts.length);
  assert(
    consensusAgreement.fieldCandidates.mrp.confidenceBreakdown?.crossFrameAgreement === 1.0,
    "Cross-frame agreement confidence factor set to 1.0",
    String(consensusAgreement.fieldCandidates.mrp.confidenceBreakdown?.crossFrameAgreement)
  );

  console.log("\n====================================================");
  console.log(`TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("====================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runEvidenceTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
