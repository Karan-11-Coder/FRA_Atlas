// src/components/UploadPanel.jsx
import React from "react";

export default function UploadPanel({ file, setFile, uploading, onUpload }) {
  return (
    <div className="space-y-2">
      <h2 className="font-semibold">Upload FRA Document</h2>
      <input
        type="file"
        accept=".pdf,.csv,.xlsx,.xls,.jpg,.jpeg,.png"
        onChange={(e) => setFile(e.target.files[0])}
        className="border p-2 rounded"
      />
      <button onClick={onUpload} className="px-4 py-2 rounded-xl bg-blue-600 text-white">
        {uploading ? "Uploading..." : "Upload & Create Claim"}
      </button>
    </div>
  );
}
