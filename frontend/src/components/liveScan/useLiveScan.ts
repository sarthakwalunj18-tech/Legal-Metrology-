import { useState, useCallback, useRef, useEffect } from "react";
import { evaluateFrame, FrameQualityResult } from "./FrameQualityAnalyzer";
import { DuplicateDetector, signatureFromFrame } from "./DuplicateDetector";
import { ProductInformationState, createEmptyState, mergeExtraction } from "./InformationMerger";
import { API_BASE_URL } from "@/lib/api";

export type LiveScanStatus =
  | "READY"
  | "SEARCHING_PRODUCT"
  | "TOO_DARK"
  | "TOO_BRIGHT"
  | "TOO_BLURRY"
  | "MOVING"
  | "PARTIALLY_OUTSIDE"
  | "TOO_SMALL"
  | "DUPLICATE"
  | "GOOD_POSITION"
  | "CAPTURED"
  | "PROCESSING"
  | "ERROR";

export function useLiveScan() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const extractCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const detectorRef = useRef<DuplicateDetector>(new DuplicateDetector());
  const loopRef = useRef<number | null>(null);
  const previousFrameRef = useRef<Uint8ClampedArray | null>(null);
  const captureCooldownRef = useRef(0);

  // V2: Differentiate queues
  const extractQueueRef = useRef<File[]>([]);
  const allSessionFilesRef = useRef<File[]>([]);

  const isUploadingRef = useRef(false);
  const isStartingRef = useRef(false);
  const mountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [status, setStatus] = useState<LiveScanStatus>("READY");
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
    if (videoRef.current) videoRef.current.srcObject = null;
    if (abortControllerRef.current) abortControllerRef.current.abort();
    setCameraOn(false);
    setStatus("READY");
  }, []);

  const queueBackgroundWorker = useCallback(async () => {
    if (isUploadingRef.current || extractQueueRef.current.length === 0) return;

    isUploadingRef.current = true;
    // V2: Process ONE frame rapidly for real-time coverage, instead of creating 10-batch scans
    const file = extractQueueRef.current.shift();
    if (!file) {
      isUploadingRef.current = false;
      return;
    }

    setUploadQueueCount(extractQueueRef.current.length);

    try {
      const token = localStorage.getItem("lm_auth_token") || "dev-inspector";
      const formData = new FormData();
      formData.append("files", file); // Must match part name if single, but in Fastify we handle request.parts()

      abortControllerRef.current = new AbortController();

      const extractRes = await fetch(`${API_BASE_URL}/api/scans/live-extract`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        signal: abortControllerRef.current.signal
      });

      if (extractRes.ok) {
        const { data } = await extractRes.json();
        // Merge seamlessly into UI
        setProductInfo(prev => mergeExtraction(prev, data));
        setTotalProcessed(prev => prev + 1);
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        console.warn("Background extraction failed, trying next", e);
      }
    } finally {
      isUploadingRef.current = false;
      if (extractQueueRef.current.length > 0) {
        setTimeout(queueBackgroundWorker, 100);
      }
    }
  }, []);

  const extractAndQueueFrame = useCallback(() => {
    const video = videoRef.current;
    const captureCanvas = extractCanvasRef.current;
    if (!video || !captureCanvas) return;

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;

    captureCanvas.width = width;
    captureCanvas.height = height;

    const ctx = captureCanvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, width, height);

    captureCanvas.toBlob((blob) => {
      if (!blob) return;

      const file = new File([blob], `live-view-${Date.now()}.jpg`, { type: "image/jpeg" });

      // V2: Push to BOTH real-time extract queue and long-term session array
      extractQueueRef.current.push(file);
      allSessionFilesRef.current.push(file);

      setUploadQueueCount(extractQueueRef.current.length);

      void queueBackgroundWorker();
    }, "image/jpeg", 0.9);
  }, [queueBackgroundWorker]);

  const finishSessionScan = useCallback(async () => {
    if (isFinishing || allSessionFilesRef.current.length === 0) {
      stopCamera();
      return null;
    }

    setIsFinishing(true);
    setStatus("PROCESSING");
    stopCamera();

    try {
      const token = localStorage.getItem("lm_auth_token") || "dev-inspector";
      const formData = new FormData();

      allSessionFilesRef.current.forEach((file) => {
        formData.append("files", file);
      });

      formData.append("productName", "Live Session Product");
      formData.append("scanMode", "LIVE_ROLLING_V2");

      // 1. Single upload with all accepted files
      const uploadRes = await fetch(`${API_BASE_URL}/api/scans/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      if (!uploadRes.ok) throw new Error("Session batch upload failed");
      const { data } = await uploadRes.json();

      // 2. Single analysis call (which runs the final aggregate compliance rule engine)
      await fetch(`${API_BASE_URL}/api/inspections/${data.scanId}/analyze`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });

      return data.scanId;
    } catch (e: any) {
      console.error("Finish scan failed:", e);
      setError(e.message || "Failed to finalize scan session");
      return null;
    } finally {
      setIsFinishing(false);
    }
  }, [isFinishing, stopCamera]);

  const startAnalysisLoop = useCallback(() => {
    if (loopRef.current !== null) return;

    captureCooldownRef.current = 0;

    loopRef.current = window.setInterval(() => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

      if (captureCooldownRef.current > 0) {
        captureCooldownRef.current--;
        return;
      }

      try {
        const targetW = 96;
        const targetH = 72;
        canvas.width = targetW;
        canvas.height = targetH;
        let ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;

        ctx.drawImage(video, 0, 0, targetW, targetH);
        const data = ctx.getImageData(0, 0, targetW, targetH).data;
        const currentFrame = new Uint8ClampedArray(data);

        const evaluation = evaluateFrame(currentFrame, previousFrameRef.current, targetW, targetH, true);

        previousFrameRef.current = currentFrame;

        if (!evaluation.isAcceptable) {
           setStatus(evaluation.status === "NO_PRODUCT" ? "SEARCHING_PRODUCT" : evaluation.status);
           return;
        }

        const signature = signatureFromFrame(currentFrame, targetW, targetH);
        const isDuplicate = detectorRef.current.checkDuplicate(signature);

        if (isDuplicate) {
          setStatus("DUPLICATE");
          return;
        }

        detectorRef.current.addSignature(signature);
        setViewsCaptured(detectorRef.current.getCount());
        setStatus("CAPTURED");

        extractAndQueueFrame();

        // Wait ~ 10 ticks (roughly 2 seconds given 200ms interval) before capturing again
        captureCooldownRef.current = 10;

      } catch (err) {
        console.error(err);
      }

    }, 200);
  }, [extractAndQueueFrame]);

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
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 15, max: 30 } },
          audio: false,
        });
      } catch (initialErr) {
        console.warn("Ideal camera constraints failed, attempting fallback...", initialErr);
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });
      }

      if (!mountedRef.current) {
         stream.getTracks().forEach(t => t.stop());
         return;
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(e => {
            console.error("Video play interrupted:", e);
        });
      }

      setCameraOn(true);
      setStatus("SEARCHING_PRODUCT");
      setViewsCaptured(0);
      setTotalProcessed(0);
      setUploadQueueCount(0);
      extractQueueRef.current = [];
      allSessionFilesRef.current = [];
      detectorRef.current.clearSession();
      previousFrameRef.current = null;

      startAnalysisLoop();
    } catch (e: any) {
      setError(e.message || "Failed to start camera");
      setStatus("ERROR");
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
