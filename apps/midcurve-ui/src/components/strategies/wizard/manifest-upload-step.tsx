"use client";

import { useState, useCallback } from "react";
import {
  Upload,
  FileJson,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Trash2,
} from "lucide-react";
import type { StrategyManifest } from "@midcurve/shared";

interface ManifestUploadStepProps {
  verifiedManifest: StrategyManifest | null;
  onManifestVerified: (manifest: StrategyManifest) => void;
  onManifestCleared: () => void;
  isVerifying: boolean;
  verificationErrors: string[];
  verificationWarnings: string[];
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Manifest upload step with drag-and-drop support and verification feedback
 */
export function ManifestUploadStep({
  verifiedManifest,
  onManifestVerified,
  onManifestCleared,
  isVerifying,
  verificationErrors,
  verificationWarnings,
}: ManifestUploadStepProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  // Process file and send for verification
  const processFile = useCallback(
    async (file: File) => {
      setFileError(null);

      // Validate file type
      if (!file.name.endsWith(".json")) {
        setFileError("Please upload a JSON file (.json)");
        return;
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        setFileError("File size exceeds 5MB limit");
        return;
      }

      setUploadedFileName(file.name);

      try {
        // Read and parse JSON
        const text = await file.text();
        let manifest: unknown;

        try {
          manifest = JSON.parse(text);
        } catch {
          setFileError("Invalid JSON format. Please check the file syntax.");
          return;
        }

        // Send to parent for verification via API
        onManifestVerified(manifest as StrategyManifest);
      } catch (error) {
        setFileError(
          error instanceof Error ? error.message : "Failed to read file"
        );
      }
    },
    [onManifestVerified]
  );

  // Handle file input change
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
    // Reset input so same file can be selected again
    e.target.value = "";
  };

  // Handle drag events
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  // Clear uploaded manifest
  const handleClear = () => {
    setFileError(null);
    setUploadedFileName(null);
    onManifestCleared();
  };

  // Show verified manifest preview
  if (verifiedManifest && verificationErrors.length === 0) {
    return (
      <div className="space-y-6">
        {/* Success State */}
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-green-400 font-medium">
                Manifest verified successfully
              </p>
              <p className="text-slate-300 text-sm mt-1">
                {uploadedFileName}
              </p>
            </div>
            <button
              onClick={handleClear}
              className="p-2 text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
              title="Remove manifest"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Warnings (if any) */}
        {verificationWarnings.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-amber-400 font-medium">Warnings</p>
                <ul className="mt-2 space-y-1">
                  {verificationWarnings.map((warning, i) => (
                    <li key={i} className="text-slate-300 text-sm">
                      • {warning}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Manifest Preview */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg divide-y divide-slate-700/50">
          <div className="p-4">
            <div className="flex justify-between items-start">
              <div>
                <h4 className="text-white font-semibold">
                  {verifiedManifest.name}
                </h4>
                <p className="text-slate-400 text-sm mt-0.5">
                  v{verifiedManifest.version}
                  {verifiedManifest.author && ` • by ${verifiedManifest.author}`}
                </p>
              </div>
              <FileJson className="w-6 h-6 text-blue-400" />
            </div>
            {verifiedManifest.description && (
              <p className="text-slate-300 text-sm mt-3">
                {verifiedManifest.description}
              </p>
            )}
          </div>

          {/* Tags */}
          {verifiedManifest.tags && verifiedManifest.tags.length > 0 && (
            <div className="p-4">
              <p className="text-slate-400 text-xs mb-2">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {verifiedManifest.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 bg-slate-700/50 text-slate-300 rounded text-xs"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Quote Currency */}
          <div className="p-4">
            <p className="text-slate-400 text-xs mb-2">Quote Currency</p>
            <p className="text-slate-300 text-sm">
              {verifiedManifest.quoteToken.type === "basic-currency" ? (
                <span className="font-medium">{verifiedManifest.quoteToken.symbol}</span>
              ) : (
                <span className="font-medium">
                  {verifiedManifest.quoteToken.symbol}{" "}
                  <span className="text-slate-400 text-xs">
                    (Chain {verifiedManifest.quoteToken.chainId})
                  </span>
                </span>
              )}
            </p>
          </div>

          {/* Constructor Params Summary */}
          <div className="p-4">
            <p className="text-slate-400 text-xs mb-2">Constructor Parameters</p>
            <p className="text-slate-300 text-sm">
              {verifiedManifest.constructorParams.length} parameter
              {verifiedManifest.constructorParams.length !== 1 ? "s" : ""}
              {" ("}
              {
                verifiedManifest.constructorParams.filter(
                  (p) => p.source === "user-input"
                ).length
              }{" "}
              configurable)
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Show verification errors
  if (verificationErrors.length > 0) {
    return (
      <div className="space-y-6">
        {/* Error State */}
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-red-400 font-medium">Validation Failed</p>
              <p className="text-slate-300 text-sm mt-1">{uploadedFileName}</p>
              <ul className="mt-3 space-y-1">
                {verificationErrors.map((error, i) => (
                  <li key={i} className="text-red-300 text-sm">
                    • {error}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Try Again */}
        <button
          onClick={handleClear}
          className="w-full py-3 border-2 border-dashed border-slate-600 hover:border-slate-500 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          Upload a different file
        </button>
      </div>
    );
  }

  // Show verifying state
  if (isVerifying) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin mb-4" />
        <p className="text-slate-300">Verifying manifest...</p>
        <p className="text-slate-400 text-sm mt-1">{uploadedFileName}</p>
      </div>
    );
  }

  // Show upload UI
  return (
    <div className="space-y-6">
      <p className="text-slate-300">
        Upload a strategy manifest file (.json) to deploy a custom strategy.
        The manifest should contain the contract ABI, bytecode, and constructor
        parameter definitions.
      </p>

      {/* Drop Zone */}
      <label
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center py-12 px-6 border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
          isDragOver
            ? "border-blue-500 bg-blue-500/10"
            : fileError
            ? "border-red-500/50 bg-red-500/5"
            : "border-slate-600 hover:border-slate-500 bg-slate-800/30"
        }`}
      >
        <input
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />

        <Upload
          className={`w-10 h-10 mb-4 ${
            isDragOver ? "text-blue-400" : "text-slate-400"
          }`}
        />

        <p className="text-slate-300 text-center">
          <span className="text-blue-400 font-medium">Click to upload</span> or
          drag and drop
        </p>
        <p className="text-slate-400 text-sm mt-1">JSON file up to 5MB</p>
      </label>

      {/* File Error */}
      {fileError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-red-300 text-sm">{fileError}</p>
          </div>
        </div>
      )}

      {/* Help Text */}
      <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg p-4">
        <p className="text-slate-400 text-sm">
          <strong className="text-slate-300">Manifest Structure:</strong> The
          manifest file should include <code className="text-blue-400">name</code>,{" "}
          <code className="text-blue-400">version</code>,{" "}
          <code className="text-blue-400">abi</code>,{" "}
          <code className="text-blue-400">bytecode</code>, and{" "}
          <code className="text-blue-400">constructorParams</code> fields.
        </p>
      </div>
    </div>
  );
}
