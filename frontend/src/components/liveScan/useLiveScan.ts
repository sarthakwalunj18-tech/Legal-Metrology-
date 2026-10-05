import { useState, useCallback, useRef, useEffect } from "react";
import { evaluateFrame, FrameQualityResult } from "./FrameQualityAnalyzer";
import { DuplicateDetector, signatureFromFrame } from "./DuplicateDetector";
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

  const queueRef = useRef<File[]>([]);
  const isUploadingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [status, setStatus] = useState<LiveScanStatus>("READY");
  const [viewsCaptured, setViewsCaptured] = useState(0);
  const [totalProcessed, setTotalProcessed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploadQueueCount, setUploadQueueCount] = useState(0);

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
    if (isUploadingRef.current || queueRef.current.length === 0) return;

    isUploadingRef.current = true;
    const batch = queueRef.current.splice(0, 10);
    setUploadQueueCount(queueRef.current.length);

    try {
      const token = localStorage.getItem("lm_auth_token") || "dev-inspector";
      const formData = new FormData();

      batch.forEach((file) => {
        formData.append("files", file);
      });

      formData.append("productName", "Live Rolling Product");
      formData.append("scanMode", "LIVE_ROLLING");

      abortControllerRef.current = new AbortController();

      const uploadRes = await fetch(`${API_BASE_URL}/api/scans/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        signal: abortControllerRef.current.signal
      });

      if (!uploadRes.ok) throw new Error("Batch upload failed");
      const { data } = await uploadRes.json();

      await fetch(`${API_BASE_URL}/api/inspections/${data.scanId}/analyze`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: abortControllerRef.current.signal
      });

      setTotalProcessed(prev => prev + batch.length);
    } catch (e: any) {
      if (e.name !== "AbortError") {
        console.error("Background Upload Error: ", e);
      }
    } finally {
      isUploadingRef.current = false;
      if (queueRef.current.length > 0) {
        setTimeout(queueBackgroundWorker, 1000);
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
      queueRef.current.push(file);
      setUploadQueueCount(queueRef.current.length);

      void queueBackgroundWorker();
    }, "image/jpeg", 0.9);
  }, [queueBackgroundWorker]);

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
    try {
      setError(null);

      if (!canvasRef.current) {
        canvasRef.current = document.createElement("canvas");
      }
      if (!extractCanvasRef.current) {
        extractCanvasRef.current = document.createElement("canvas");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
        audio: false,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraOn(true);
      setStatus("SEARCHING_PRODUCT");
      setViewsCaptured(0);
      setTotalProcessed(0);
      setUploadQueueCount(0);
      queueRef.current = [];
      detectorRef.current.clearSession();
      previousFrameRef.current = null;

      startAnalysisLoop();
    } catch (e: any) {
      setError(e.message || "Failed to start camera");
      setStatus("ERROR");
      setCameraOn(false);
    }
  };

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  return {
    videoRef,
    cameraOn,
    status,
    startCamera,
    stopCamera,
    viewsCaptured,
    totalProcessed,
    error,
    uploadQueueCount
  };
}
