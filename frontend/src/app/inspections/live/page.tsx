"use client";

import React, { useCallback, useState, useEffect } from "react";
import Link from "next/link";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import {
  AlertCircle,
  Camera,
  CameraOff,
  CheckCircle2,
  RefreshCw,
  Video,
  AlertTriangle,
  ScanLine
} from "lucide-react";
import { useLiveScan, LiveScanStatus } from "@/components/liveScan/useLiveScan";
import { calculateCoverage } from "@/components/liveScan/InformationMerger";

export default function LiveInspectionPage() {
  const {
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
  } = useLiveScan();

  const coverage = calculateCoverage(productInfo);

  const getStatusDisplay = (status: LiveScanStatus) => {
    switch (status) {
      case "READY":
        return "Ready to start scan";
      case "SEARCHING_PRODUCT":
        return "Searching for product in frame...";
      case "PRODUCT_DETECTED":
      case "HOLD_STEADY":
        return "Product detected — hold steady";
      case "CAPTURING":
        return "Capturing view...";
      case "CAPTURED":
        if (viewsCaptured > 0 && coverage.missing.length > 0) {
          return `View ${viewsCaptured} captured! Pivot to reveal ${coverage.missing[0]}`;
        }
        return "View captured! Rotate product";
      case "DUPLICATE":
        if (coverage.missing.length > 0) {
          return `Similar view — pivot to reveal ${coverage.missing[0]}`;
        }
        return "Similar view — rotate product";
      case "TOO_DARK":
        return "Too dark — increase lighting";
      case "TOO_BRIGHT":
        return "Too bright — reduce glare";
      case "TOO_BLURRY":
        return "Image blurry — hold steady";
      case "MOVING":
        return "Product moving — hold steady";
      case "PARTIALLY_OUTSIDE":
        return "Move product slightly away";
      case "TOO_SMALL":
        return "Bring product closer";
      case "PROCESSING":
        return "Processing & validating...";
      case "ERROR":
        return "Error occurred";
      default:
        return status;
    }
  };

  const getStatusColor = (status: LiveScanStatus) => {
    switch (status) {
      case "CAPTURED":
        return "bg-emerald-600";
      case "CAPTURING":
        return "bg-emerald-500";
      case "PRODUCT_DETECTED":
      case "HOLD_STEADY":
        return "bg-blue-600";
      case "DUPLICATE":
        return "bg-amber-600";
      case "SEARCHING_PRODUCT":
        return "bg-slate-700/80 backdrop-blur-sm";
      case "READY":
        return "bg-slate-600";
      default:
        return "bg-red-500";
    }
  };

  const handleFinishScan = useCallback(async () => {
    const finalScanId = await finishSessionScan();
    if (finalScanId) {
      window.location.href = `/inspections/${finalScanId}`;
    } else {
      window.location.href = '/inspections';
    }
  }, [finishSessionScan]);

  // Phase 7-8: Adaptive Stopping based on coverage
  useEffect(() => {
    // Stop early if 100% of mandatory fields are extracted with sufficient confidence
    if (coverage.percent === 100 && !isFinishing && viewsCaptured >= 2) {
      handleFinishScan();
    }
  }, [coverage.percent, isFinishing, viewsCaptured, handleFinishScan]);

  return (
    <div className="flex bg-slate-50 min-h-screen text-slate-800">
      <Sidebar />
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <TopBar />

        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="max-w-7xl mx-auto space-y-6">

            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-indigo-700 flex items-center gap-2">
                  <Video className="w-7 h-7 text-blue-600" />
                  Intelligent Live Camera Scanner
                </h1>
                <p className="text-slate-500 mt-1">
                  Continuously scans product surfaces. Rotate the package to capture unique views.
                </p>
              </div>

              <div className="flex gap-3">
                {!cameraOn ? (
                    <button
                      onClick={startCamera}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center gap-2 transition-all shadow-sm"
                    >
                      <Camera className="w-5 h-5" /> Start Live Scan
                    </button>
                ) : (
                    <button
                      onClick={handleFinishScan}
                      disabled={isFinishing}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-900 focus:outline-none text-white rounded-lg font-medium flex items-center gap-2 transition-all disabled:opacity-50"
                    >
                      {isFinishing ? <RefreshCw className="w-5 h-5 animate-spin" /> : <CameraOff className="w-5 h-5" />}
                      {isFinishing ? "Processing & Validating..." : "Finish Scan"}
                    </button>
                )}
              </div>
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-start gap-3">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium">Camera Error</h4>
                  <p className="text-sm mt-1">{error}</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              <Card className="lg:col-span-2 overflow-hidden shadow-sm border-slate-200">
                <div className="bg-slate-900 aspect-video relative flex items-center justify-center rounded-t-xl overflow-hidden">

                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`w-full h-full object-cover ${!cameraOn ? "hidden" : ""}`}
                  />

                  {!cameraOn && (
                    <div className="text-center absolute inset-0 flex flex-col justify-center items-center bg-slate-900 z-10">
                       <CameraOff className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                       <p className="text-slate-400 font-medium">Camera is inactive</p>
                    </div>
                  )}

                  {/* Overlay Status */}
                  {cameraOn && (
                    <div className="absolute top-4 left-0 right-0 flex justify-center pointer-events-none">
                       <div className={`px-4 py-2 rounded-full text-white font-medium shadow-lg flex items-center gap-2 transition-colors ${getStatusColor(status)}`}>
                         {status === "CAPTURED" ? (
                           <CheckCircle2 className="w-4 h-4" />
                         ) : status === "HOLD_STEADY" || status === "PRODUCT_DETECTED" || status === "CAPTURING" ? (
                           <RefreshCw className="w-4 h-4 animate-spin" />
                         ) : status === "SEARCHING_PRODUCT" ? (
                           <ScanLine className="w-4 h-4" />
                         ) : status === "DUPLICATE" ? (
                           <RefreshCw className="w-4 h-4" />
                         ) : (
                           <AlertTriangle className="w-4 h-4" />
                         )}
                         {getStatusDisplay(status)}
                       </div>
                    </div>
                  )}

                </div>
                <CardBody className="bg-white border-t border-slate-100 p-4">
                  <div className="flex gap-4 justify-around text-sm">
                     <div className="text-center">
                        <div className="text-slate-500 font-medium text-xs uppercase tracking-wider mb-1">Status</div>
                        <div className="font-semibold text-slate-800 flex items-center justify-center gap-1.5">
                           <span className={`w-2 h-2 rounded-full ${cameraOn ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />
                           {cameraOn ? "Live" : "Idle"}
                        </div>
                     </div>
                     <div className="text-center">
                        <div className="text-slate-500 font-medium text-xs uppercase tracking-wider mb-1">Performance</div>
                        <div className="font-semibold text-slate-800">
                           ~5 FPS config
                        </div>
                     </div>
                  </div>
                </CardBody>
              </Card>

              {/* Side Panel for Stats */}
              <div className="space-y-6">
                <Card className="border-slate-200 shadow-sm">
                  <CardHeader className="border-b border-slate-100 bg-slate-50/50">
                    <h3 className="font-semibold text-slate-800">Session Progress</h3>
                  </CardHeader>
                  <CardBody className="p-5 space-y-6">

                     <div>
                       <div className="flex justify-between items-center mb-2">
                         <span className="text-slate-600 text-sm font-medium">Unique Views Captured</span>
                         <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-bold">{viewsCaptured}</span>
                       </div>
                       <p className="text-xs text-slate-500">
                         Rotate your product to expose all faces, ingredients lists, and MRP labels. Duplicates are rejected automatically.
                       </p>
                     </div>

                     <div className="h-px bg-slate-100 w-full" />

                     <div>
                       <div className="flex justify-between items-center mb-2">
                         <span className="text-slate-600 text-sm font-medium flex items-center gap-1.5">
                           <RefreshCw className={`w-3.5 h-3.5 ${uploadQueueCount > 0 ? "animate-spin text-indigo-500" : "text-slate-400"}`} />
                           Information Coverage
                         </span>
                         <span className="font-bold text-sm text-indigo-700">{coverage.percent}%</span>
                       </div>

                       <div className="w-full bg-slate-100 rounded-full h-2.5 mb-4">
                         <div className="bg-indigo-500 h-2.5 rounded-full transition-all" style={{ width: `${coverage.percent}%` }}></div>
                       </div>

                       <div className="space-y-4">
                          {coverage.found.length > 0 && (
                            <div>
                               <div className="text-xs font-semibold text-emerald-600 mb-1">✓ Detected</div>
                               <div className="flex flex-wrap gap-1">
                                 {coverage.found.map(f => (
                                   <span key={f} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-xs">{f}</span>
                                 ))}
                               </div>
                            </div>
                          )}

                          {coverage.missing.length > 0 && (
                            <div>
                               <div className="text-xs font-semibold text-slate-500 mb-1">• Still looking for</div>
                               <div className="flex flex-wrap gap-1">
                                 {coverage.missing.map(f => (
                                   <span key={f} className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">{f}</span>
                                 ))}
                               </div>
                            </div>
                          )}
                       </div>

                       <p className="text-xs text-slate-500 mt-4 border-l-2 border-indigo-200 pl-2">
                         {coverage.percent === 100
                           ? "Excellent coverage. You can finish the scan."
                           : "Continue rotating the product to capture remaining declarations."}
                       </p>
                     </div>

                  </CardBody>
                </Card>
              </div>

            </div>
          </div>
        </main>
      </div>
    </div>
  );
}