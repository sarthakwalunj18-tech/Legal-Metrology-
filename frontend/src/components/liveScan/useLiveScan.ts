import { useState, useCallback, useRef, useEffect } from "react";
import { evaluateFrame, FrameQualityResult } from "./FrameQualityAnalyzer";
import { DuplicateDetector, signatureFromFrame } from "./DuplicateDetector";
import { ProductInformationState, createEmptyState, mergeExtraction } from "./InformationMerger";
import { API_BASE_URL } from "@/lib/api";

export type LiveScanStatus =
  | "READY"
  | "SEARCHING_PRODUCT"
  | "PRODUCT_DETECTED"
  | "HOLD_STEADY"
  | "GOOD_POSITION"
  | "TOO_DARK"
  | "TOO_BRIGHT"
  | "BAD_COLOR_CAST"
  | "TOO_BLURRY"
  | "MOVING"
  | "PARTIALLY_OUTSIDE"
  | "TOO_SMALL"
  | "HUMAN_FACE_REJECTED"
  | "DUPLICATE"
  | "CAPTURING"
  | "CAPTURED"
  | "PROCESSING"
  | "ERROR";

// Configurable Constants for Camera Optimization
const FRAME_ANALYSIS_INTERVAL_MS = 250;
const CAPTURE_COOLDOWN_MS = 800; // Time user has to rotate product
const MAX_CAPTURED_IMAGES = 6;
const STATUS_DEBOUNCE_MS = 400;

export function useLiveScan() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const extractCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const detectorRef = useRef<DuplicateDetector>(new DuplicateDetector());
  const loopRef = useRef<number | null>(null);
  const previousFrameRef = useRef<Uint8ClampedArray | null>(null);
  const captureCooldownRef = useRef(0);
  const stableTicksRef = useRef(0);

  // Dual queue architecture
  const extractQueueRef = useRef<{ file: File, bbox?: any }[]>([])
  const allSessionFilesRef = useRef<{ file: File, bbox?: any }[]>([])

  const isUploadingRef = useRef(false);
  const isStartingRef = useRef(false);
  const mountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [internalStatus, setInternalStatus] = useState<LiveScanStatus>("READY");
  const [status, setStatus] = useState<LiveScanStatus>("READY");
  const statusRef = useRef<LiveScanStatus>("READY");
  const debouncedStatusTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const updateStatus = useCallback((newInternalStatus: LiveScanStatus, force = false) => {
    setInternalStatus(newInternalStatus);

    // Some statuses should be immediate (e.g. CAPTURED, ERROR, READY)
    const immediateStatuses = ["CAPTURED", "ERROR", "READY", "PROCESSING", "SEARCHING_PRODUCT", "HOLD_STEADY", "DUPLICATE"];

    if (force || immediateStatuses.includes(newInternalStatus)) {
      if (debouncedStatusTimeoutRef.current) clearTimeout(debouncedStatusTimeoutRef.current);
      statusRef.current = newInternalStatus;
      setStatus(newInternalStatus);
    } else {
      // Debounce flickering statuses (e.g. TOO_BLURRY, MOVING, TOO_DARK)
      if (statusRef.current === newInternalStatus) return; // Already current
      if (debouncedStatusTimeoutRef.current) clearTimeout(debouncedStatusTimeoutRef.current);
      debouncedStatusTimeoutRef.current = setTimeout(() => {
        statusRef.current = newInternalStatus;
        setStatus(newInternalStatus);
      }, STATUS_DEBOUNCE_MS);
    }
  }, []);
  const [viewsCaptured, setViewsCaptured] = useState(0);
  const [totalProcessed, setTotalProcessed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploadQueueCount, setUploadQueueCount] = useState(0);

  const [productInfo, setProductInfo] = useState<ProductInformationState>(createEmptyState());
  const [isFinishing, setIsFinishing] = useState(false);

  const stopCamera = useCallback(() => {
    if (loopRef.current !== null) {
      window.clearInterval(loopRef.current);
      loopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setCameraOn(false);
    updateStatus("READY", true);
    stableTicksRef.current = 0;
    captureCooldownRef.current = 0;
  }, [updateStatus]);

  const queueBackgroundWorker = useCallback(async () => {
    if (isUploadingRef.current || extractQueueRef.current.length === 0) return;

    isUploadingRef.current = true;
    const item = extractQueueRef.current.shift();
    if (!item) {
      isUploadingRef.current = false;
      return;
    }
    const { file, bbox } = item;
    if (!file) {
      isUploadingRef.current = false;
      return;
    }

    setUploadQueueCount(extractQueueRef.current.length);

    try {
      const token = localStorage.getItem("lm_auth_token") || "dev-inspector";
      const formData = new FormData();
      formData.append("files", file);
      if (bbox) {
        formData.append("cropBox", JSON.stringify(bbox));
      }

      abortControllerRef.current = new AbortController();

      const extractRes = await fetch(`${API_BASE_URL}/api/scans/live-extract`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        signal: abortControllerRef.current.signal
      });

      if (extractRes.ok) {
        const { data } = await extractRes.json();
        setProductInfo((prev) => mergeExtraction(prev, data));
        setTotalProcessed((prev) => prev + 1);
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        console.warn("Background live extraction failed:", e);
      }
    } finally {
      isUploadingRef.current = false;
      if (extractQueueRef.current.length > 0) {
        setTimeout(queueBackgroundWorker, 80);
      }
    }
  }, []);

  const extractAndQueueFrame = useCallback((boundingBox?: { x: number; y: number; width: number; height: number }, targetW = 96, targetH = 72) => {
    const video = videoRef.current;
    const captureCanvas = extractCanvasRef.current;
    if (!video || !captureCanvas) return;

    let width = video.videoWidth || 1280;
    let height = video.videoHeight || 720;

    // We capture the FULL frame for audit but attach crop coordinates
    captureCanvas.width = width;
    captureCanvas.height = height;

    const ctx = captureCanvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, width, height);

    let mappedBbox: any = null;
    if (boundingBox) {
      mappedBbox = {
        x: Math.max(0, Math.floor((boundingBox.x / targetW) * width)),
        y: Math.max(0, Math.floor((boundingBox.y / targetH) * height)),
        width: Math.floor((boundingBox.width / targetW) * width),
        height: Math.floor((boundingBox.height / targetH) * height)
      };
    }

    captureCanvas.toBlob(
      (blob) => {
        if (!blob) return;

        const file = new File([blob], `live-view-${Date.now()}.jpg`, {
          type: "image/jpeg"
        });

        extractQueueRef.current.push({ file, bbox: mappedBbox });
        allSessionFilesRef.current.push({ file, bbox: mappedBbox });

        setUploadQueueCount(extractQueueRef.current.length);
        void queueBackgroundWorker();
      },
      "image/jpeg",
      0.92
    );
  }, [queueBackgroundWorker]);

  const finishSessionScan = useCallback(async () => {
    if (isFinishing || allSessionFilesRef.current.length === 0) {
      stopCamera();
      return null;
    }

    setIsFinishing(true);
    updateStatus("PROCESSING", true);
    stopCamera();

    try {
      const token = localStorage.getItem("lm_auth_token") || "dev-inspector";
      const formData = new FormData();

      const bboxes: any[] = [];
      allSessionFilesRef.current.forEach((item) => {
        formData.append("files", item.file);
        bboxes.push(item.bbox || null);
      });
      formData.append("bboxes", JSON.stringify(bboxes));

      formData.append("productName", "Live Inspection Session");
      formData.append("scanMode", "LIVE_ROLLING_V2");

      const uploadRes = await fetch(`${API_BASE_URL}/api/scans/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      if (!uploadRes.ok) throw new Error("Consolidated session upload failed");
      const { data } = await uploadRes.json();

      // Trigger analysis asynchronously (fire and forget) to ensure instant navigation
      fetch(`${API_BASE_URL}/api/inspections/${data.scanId}/analyze`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      }).catch(err => console.error("Async analysis trigger failed:", err));

      return data.scanId;
    } catch (e: any) {
      console.error("Finish scan failed:", e);
      setError(e.message || "Failed to finalize session scan");
      return null;
    } finally {
      setIsFinishing(false);
    }
  }, [isFinishing, stopCamera, updateStatus]);

  const startAnalysisLoop = useCallback(() => {
    if (loopRef.current !== null) return;

    captureCooldownRef.current = 0;
    stableTicksRef.current = 0;

    // Run evaluation tick at defined interval
    loopRef.current = window.setInterval(() => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

      // Check max limit
      if (detectorRef.current.getCount() >= MAX_CAPTURED_IMAGES) return;

      // Handle capture cooldown (allow user time to rotate product)
      const ticksToWait = Math.ceil(CAPTURE_COOLDOWN_MS / FRAME_ANALYSIS_INTERVAL_MS);
      if (captureCooldownRef.current > 0) {
        captureCooldownRef.current--;
        return;
      }

      try {
        const targetW = 96;
        const targetH = 72;
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;

        ctx.drawImage(video, 0, 0, targetW, targetH);
        const imgData = ctx.getImageData(0, 0, targetW, targetH).data;
        const currentFrame = new Uint8ClampedArray(imgData);

        const evaluation = evaluateFrame(
          currentFrame,
          previousFrameRef.current,
          targetW,
          targetH,
          true
        );

        previousFrameRef.current = currentFrame;

        // If frame is unacceptable (empty, moving, blurry, dark, etc.)
        if (!evaluation.isAcceptable) {
          stableTicksRef.current = 0;
          updateStatus(
            evaluation.status === "NO_PRODUCT"
              ? "SEARCHING_PRODUCT"
              : evaluation.status
          );
          return;
        }

        // Frame passed individual gates & composite score.
        // Require 2 consecutive stable ticks (~360 - 500ms temporal stability window)
        // to prevent capturing motion blur mid-swivel.
        if (stableTicksRef.current < 1) {
          stableTicksRef.current++;
          updateStatus("HOLD_STEADY");
          return;
        }

        // Check if this angle has already been captured
        const signature = signatureFromFrame(currentFrame, targetW, targetH);
        const isDuplicate = detectorRef.current.checkDuplicate(signature);

        if (isDuplicate) {
          updateStatus("DUPLICATE", true);
          stableTicksRef.current = 0;
          return;
        }

        // Fresh unique view confirmed! Capture and queue
        detectorRef.current.addSignature(signature);
        const currentCount = detectorRef.current.getCount();
        setViewsCaptured(currentCount);
        updateStatus("CAPTURED", true);

        extractAndQueueFrame(evaluation.boundingBox, targetW, targetH);

        stableTicksRef.current = 0;
        captureCooldownRef.current = ticksToWait;
      } catch (err) {
        console.error("Frame evaluation error:", err);
      }
    }, FRAME_ANALYSIS_INTERVAL_MS);
  }, [extractAndQueueFrame, updateStatus]);

  const startCamera = async () => {
    if (isStartingRef.current || cameraOn) return;
    try {
      isStartingRef.current = true;
      setError(null);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera API is not supported in this browser or requires HTTPS.");
      }

      if (!canvasRef.current) {
        canvasRef.current = document.createElement("canvas");
      }
      if (!extractCanvasRef.current) {
        extractCanvasRef.current = document.createElement("canvas");
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 15, max: 30 }
          },
          audio: false
        });
      } catch (initialErr) {
        console.warn("Ideal camera constraints failed, attempting fallback...", initialErr);
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });
      }

      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch((e) => {
          console.error("Video play interrupted:", e);
        });
      }

      setCameraOn(true);
      updateStatus("SEARCHING_PRODUCT", true);
      setViewsCaptured(0);
      setTotalProcessed(0);
      setUploadQueueCount(0);
      extractQueueRef.current = [];
      allSessionFilesRef.current = [];
      detectorRef.current.clearSession();
      previousFrameRef.current = null;
      stableTicksRef.current = 0;
      captureCooldownRef.current = 0;

      startAnalysisLoop();
    } catch (e: any) {
      setError(e.message || "Failed to start camera");
      updateStatus("ERROR", true);
      setCameraOn(false);
    } finally {
      isStartingRef.current = false;
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopCamera();
      if (debouncedStatusTimeoutRef.current) {
        clearTimeout(debouncedStatusTimeoutRef.current);
      }
    };
  }, [stopCamera]);

  return {
    videoRef,
    cameraOn,
    status,
    startCamera,
    stopCamera,
    finishSessionScan,
    viewsCaptured,
    totalProcessed,
    error,
    uploadQueueCount,
    productInfo,
    isFinishing
  };
}
