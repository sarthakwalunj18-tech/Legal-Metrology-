"use client";

import React, { useCallback, useState } from "react";
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

export default function LiveInspectionPage() {
  const {
    videoRef,
    cameraOn,
    status,
    startCamera,
    stopCamera,
    viewsCaptured,
    totalProcessed,
    error,
    uploadQueueCount
  } = useLiveScan();

  const getStatusDisplay = (status: LiveScanStatus) => {
    switch(status) {
      case "READY": return "Ready to start scan";
      case "SEARCHING_PRODUCT": return "Searching for product in frame...";
      case "TOO_DARK": return "Too dark - increase lighting";
      case "TOO_BRIGHT": return "Too bright - reduce glare";
      case "TOO_BLURRY": return "Hold steady - image is blurry";
      case "MOVING": return "Hold steady - product is moving";
      case "PARTIALLY_OUTSIDE": return "Move product further away - cut off edges";
      case "TOO_SMALL": return "Move product closer - too small";
      case "DUPLICATE": return "Similar view - skipped (rotate product)";
      case "GOOD_POSITION": return "Processing frame...";
      case "CAPTURED": return "New view captured!";
      case "PROCESSING": return "Processing captures...";
      case "ERROR": return "Error occurred";
      default: return status;
    }
  };

  const getStatusColor = (status: LiveScanStatus) => {
    switch(status) {
      case "CAPTURED": return "bg-green-500";
      case "GOOD_POSITION": return "bg-blue-500";
      case "DUPLICATE": return "bg-amber-500";
      case "SEARCHING_PRODUCT": return "bg-slate-400";
      case "READY": return "bg-slate-400";
      default: return "bg-red-500";
    }
  };

  const finishScan = useCallback(() => {
    stopCamera();
    // In a real app we'd wait for uploads to finish and redirect
    // Since we're demonstrating the capture layer, we'll just stop
    window.location.href = '/inspections';
  }, [stopCamera]);

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
                      onClick={finishScan}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-medium flex items-center gap-2 transition-all"
                    >
                      <CameraOff className="w-5 h-5" /> Finish Scan
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

                  {cameraOn ? (
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center">
                       <CameraOff className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                       <p className="text-slate-400 font-medium">Camera is inactive</p>
                    </div>
                  )}

                  {/* Overlay Status */}
                  {cameraOn && (
                    <div className="absolute top-4 left-0 right-0 flex justify-center pointer-events-none">
                       <div className={`px-4 py-2 rounded-full text-white font-medium shadow-lg flex items-center gap-2 transition-colors ${getStatusColor(status)}`}>
                         {status === "CAPTURED" ? <CheckCircle2 className="w-4 h-4" /> :
                          status === "SEARCHING_PRODUCT" ? <ScanLine className="w-4 h-4" /> :
                          <AlertTriangle className="w-4 h-4"/> }
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
                           Backend Processing
                         </span>
                       </div>
                       <div className="flex items-center gap-4 text-sm mt-3">
                          <div className="flex-1 bg-slate-50 p-2 rounded-lg border border-slate-100 text-center">
                            <div className="text-slate-400 text-xs font-medium">Queued</div>
                            <div className="font-semibold text-slate-700 text-lg mt-0.5">{uploadQueueCount}</div>
                          </div>
                          <div className="flex-1 bg-slate-50 p-2 rounded-lg border border-slate-100 text-center">
                            <div className="text-slate-400 text-xs font-medium">Processed</div>
                            <div className="font-semibold text-emerald-600 text-lg mt-0.5">{totalProcessed}</div>
                          </div>
                       </div>
                       <p className="text-xs text-slate-500 mt-3 border-l-2 border-indigo-200 pl-2">
                         Valid frames are uploaded to the OCR validation queue in the background. The camera never freezes.
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