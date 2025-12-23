import React, { useState, useRef } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";

/**
 * Works with your backend or locally:
 *  • If API prop exists → uploads to server endpoints
 *  • Otherwise → parses .xlsx/.xls/.csv/.json locally
 */
export default function UploadReviewPanel({
  onSaved,
  upsertClaim,
  mapRef,
  authFetch,
  API,
}) {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("idle");
  const [data, setData] = useState(null);
  const [edited, setEdited] = useState({});
  const [error, setError] = useState("");
  const abortRef = useRef(null);

  function resetAll() {
    setFile(null);
    setStatus("idle");
    setData(null);
    setEdited({});
    setError("");
    if (abortRef.current) {
      try {
        abortRef.current.abort();
      } catch {}
      abortRef.current = null;
    }
  }

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    setFile(f);
    setError("");
  };

  // --- Local parsing for Excel/CSV/JSON ---
  async function parseLocally(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet]);
      return { filename: file.name, rows };
    } else if (name.endsWith(".csv")) {
      const text = await file.text();
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      return { filename: file.name, rows: parsed.data };
    } else if (name.endsWith(".json")) {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return { filename: file.name, rows: parsed };
      if (parsed.rows) return { filename: file.name, rows: parsed.rows };
      return { filename: file.name, rows: [parsed] };
    }
    throw new Error("Unsupported file type");
  }

  // --- Main analyze handler ---
  async function handleStart() {
    if (!file) return alert("Choose a file first.");
    const name = file.name.toLowerCase();
    const isExcel = name.endsWith(".csv") || name.endsWith(".xlsx") || name.endsWith(".xls");
    const isJson = name.endsWith(".json");
    const isPdfOrImage =
      name.endsWith(".pdf") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png");

    setStatus("analyzing");
    const ac = new AbortController();
    abortRef.current = ac;

    // Use backend if API provided
    if (API) {
      const form = new FormData();
      form.append("file", file);
      try {
        let res;
        if (isExcel || isJson) {
          res = await fetch(`${API}/claims/parse-excel`, {
            method: "POST",
            body: form,
            signal: ac.signal,
          });
        } else {
          res = await fetch(`${API}/claims/parse-fra`, {
            method: "POST",
            body: form,
            signal: ac.signal,
          });
        }
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        setData(json);
        setStatus(isPdfOrImage ? "review" : "review-excel");
        if (isPdfOrImage) initPdfEdited(json);
      } catch (err) {
        console.error(err);
        setError(err.message);
        setStatus("idle");
      } finally {
        abortRef.current = null;
      }
      return;
    }

    // Otherwise parse locally
    try {
      const parsed = await parseLocally(file);
      setData(parsed);
      setStatus("review-excel");
    } catch (err) {
      setError(err.message);
      setStatus("idle");
    }
  }

  function initPdfEdited(parsed) {
    const e = parsed.entities || {};
    setEdited({
      state: e.state || "",
      district: e.district || "",
      village: e.village || e.villages?.[0] || "",
      patta_holder: e.patta_holder || e.patta_holders?.[0] || "",
      date: e.dates?.[0] || "",
      land_area: e.land_area || e.area || "",
      status: e.status === "Granted" ? "Granted" : "Pending",
      lat: parsed.lat ?? "",
      lon: parsed.lon ?? "",
    });
  }

  async function handleCancel() {
    if (abortRef.current) {
      try {
        abortRef.current.abort();
      } catch {}
      abortRef.current = null;
      setStatus("idle");
      setData(null);
      return;
    }
    resetAll();
  }

  async function handleSavePdf() {
    if (!API) return alert("Saving requires API connection.");
    setStatus("saving");
    try {
      const payload = {
        ...edited,
        lat: edited.lat ? Number(edited.lat) : null,
        lon: edited.lon ? Number(edited.lon) : null,
        source: "ocr",
        raw_ocr: data?.extracted_text || null,
      };
      const res = await authFetch(`${API}/claims`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      const created = await res.json();
      const claim = created.claim || created;
      onSaved?.(claim);
      upsertClaim?.(claim);
      if (claim.lat && claim.lon && mapRef?.current) {
        mapRef.current.flyTo([claim.lat, claim.lon], 14);
      }
      resetAll();
      alert("Claim saved.");
    } catch (err) {
      alert("Save failed: " + err.message);
      setStatus("review");
    }
  }

  async function handleImportRows() {
    if (!data?.rows?.length) return alert("No rows to import.");
    setStatus("saving");
    try {
      if (API) {
        const res = await authFetch(`${API}/claims/import-json`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: data.rows }),
        });
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        const created = json.claims || [];
        created.forEach((c) => upsertClaim?.(c));
        onSaved?.(created[0]);
        alert(`Imported ${created.length} rows.`);
      } else {
        onSaved?.(data.rows);
        alert(`Prepared ${data.rows.length} rows locally.`);
      }
      resetAll();
    } catch (err) {
      alert("Import failed: " + err.message);
      setStatus("review-excel");
    }
  }

  // --- Render ---
  return (
    <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-blue-50 to-green-50 p-6">
      <div className="w-full max-w-6xl bg-white shadow-2xl rounded-2xl p-8">
        <h2 className="text-2xl font-semibold text-center mb-6 text-gray-800">
          Upload & Preview Data
        </h2>

        {/* File controls */}
        <div className="flex flex-wrap gap-4 justify-center mb-6">
          <label className="bg-blue-500 text-white px-6 py-2 rounded-xl shadow-md cursor-pointer hover:bg-blue-600 transition-all">
            {file ? file.name : "Choose File"}
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv,.json"
              className="hidden"
              onChange={handleFileChange}
            />
          </label>

          <button
            onClick={handleStart}
            disabled={!file || status === "analyzing"}
            className="bg-green-500 text-white px-6 py-2 rounded-xl shadow-md hover:bg-green-600 transition-all disabled:opacity-50"
          >
            {status === "analyzing" ? "Analyzing..." : "Analyze"}
          </button>

          <button
            onClick={handleCancel}
            className="bg-gray-300 text-gray-800 px-6 py-2 rounded-xl hover:bg-gray-400 transition-all"
          >
            Cancel
          </button>
        </div>

        {error && <div className="text-center text-red-600 mb-4">{error}</div>}

        {status === "analyzing" && (
          <div className="text-center text-sm text-gray-600 mb-4">
            Analyzing document…
          </div>
        )}

        {/* PDF review */}
        {status === "review" && data && (
          <div className="bg-white border rounded-2xl shadow-md p-6">
            <h3 className="text-xl font-semibold mb-4 text-gray-700">
              Review Extracted Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {["state", "district", "village", "patta_holder", "land_area", "date", "lat", "lon"].map((f) => (
                <label key={f} className="text-sm capitalize">
                  {f.replace("_", " ")}
                  <input
                    className="w-full mt-1 p-2 border rounded"
                    value={edited[f] ?? ""}
                    onChange={(e) => setEdited({ ...edited, [f]: e.target.value })}
                  />
                </label>
              ))}
              <label className="text-sm">
                Status
                <select
                  className="w-full mt-1 p-2 border rounded"
                  value={edited.status || "Pending"}
                  onChange={(e) => setEdited({ ...edited, status: e.target.value })}
                >
                  <option value="Pending">Pending</option>
                  <option value="Granted">Granted</option>
                </select>
              </label>
            </div>

            <div className="flex justify-center gap-4 mt-4">
              <button
                onClick={handleSavePdf}
                className="bg-blue-600 text-white px-6 py-2 rounded-xl hover:bg-blue-700"
              >
                Save to DB
              </button>
              <button
                onClick={handleCancel}
                className="bg-gray-300 text-gray-800 px-4 py-2 rounded-xl hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>

            <hr className="my-4" />
            <div className="text-sm">
              <strong>OCR preview:</strong>
              <pre className="max-h-40 overflow-auto bg-gray-50 p-3 rounded mt-2 whitespace-pre-wrap text-xs">
                {String(data.extracted_text || "").slice(0, 2000)}
              </pre>
            </div>
          </div>
        )}

        {/* Excel/CSV/JSON table preview */}
        {status === "review-excel" && data?.rows?.length > 0 && (
          <div className="bg-white border rounded-2xl shadow-md p-6">
            <h3 className="text-xl font-semibold mb-4 text-gray-700 text-center">
              Preview Rows ({data.rows.length})
            </h3>

            <div className="overflow-x-auto border rounded-lg p-2" style={{ maxHeight: 340 }}>
              <table className="min-w-full border-collapse rounded overflow-hidden">
                <thead className="bg-gradient-to-r from-blue-600 to-blue-400 text-white">
                  <tr>
                    {Object.keys(data.rows[0] || {}).map((key) => (
                      <th
                        key={key}
                        className="px-3 py-2 text-left text-sm font-semibold uppercase tracking-wider"
                      >
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr key={i} className={i % 2 ? "bg-gray-50" : "bg-white"}>
                      {Object.keys(data.rows[0] || {}).map((col, j) => (
                        <td key={j} className="px-2 py-2 text-sm">
                          {col === "status" ? (
                            <select
                              className="w-full p-1 border rounded"
                              value={row[col] ?? ""}
                              onChange={(e) => {
                                const rows = [...data.rows];
                                rows[i][col] = e.target.value;
                                setData({ ...data, rows });
                              }}
                            >
                              <option value="">--</option>
                              <option value="Pending">Pending</option>
                              <option value="Granted">Granted</option>
                            </select>
                          ) : (
                            <input
                              className="w-full p-1 border rounded"
                              value={row[col] ?? ""}
                              onChange={(e) => {
                                const rows = [...data.rows];
                                rows[i][col] = e.target.value;
                                setData({ ...data, rows });
                              }}
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-center gap-4 mt-4">
              <button
                onClick={handleImportRows}
                className="bg-blue-600 text-white px-6 py-2 rounded-xl hover:bg-blue-700"
              >
                Import Rows
              </button>
              <button
                onClick={handleCancel}
                className="bg-gray-300 text-gray-800 px-4 py-2 rounded-xl hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
