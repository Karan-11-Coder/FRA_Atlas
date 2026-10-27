"use client";

import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UploadCloud } from "lucide-react";
import { api } from "@/lib/api";
import type { WorkspaceClaim } from "./types";

type Status = "idle" | "analyzing" | "review-pdf" | "review-rows" | "saving";

interface Props {
  onSaved: (claim: WorkspaceClaim) => void;
  onImported: (claims: WorkspaceClaim[]) => void;
}

export default function UploadPanel({ onSaved, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [tmpFilename, setTmpFilename] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState("");
  const [pdfForm, setPdfForm] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setStatus("idle");
    setError("");
    setTmpFilename(null);
    setExtractedText("");
    setPdfForm({});
    setRows([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleAnalyze() {
    if (!file) return;
    const name = file.name.toLowerCase();
    const isExcel = name.endsWith(".csv") || name.endsWith(".xlsx") || name.endsWith(".xls");
    setStatus("analyzing");
    setError("");
    try {
      if (isExcel) {
        const res = await api.parseExcel(file);
        setTmpFilename(res.filename);
        setRows(res.rows || []);
        setStatus("review-rows");
      } else {
        const res = await api.parseFra(file);
        setTmpFilename(res.filename);
        setExtractedText(res.extracted_text || "");
        const e = res.entities || {};
        setPdfForm({
          state: e.state || "",
          district: e.district || "",
          village: e.village || e.villages?.[0] || "",
          patta_holder: e.patta_holder || e.patta_holders?.[0] || "",
          date: e.dates?.[0] || "",
          land_area: e.land_area || e.area || "",
          status: e.status === "Granted" ? "Granted" : "Pending",
          lat: e.lat ?? "",
          lon: e.lon ?? "",
        });
        setStatus("review-pdf");
      }
    } catch (err: any) {
      setError(err?.message || "Analyze failed");
      setStatus("idle");
    }
  }

  async function handleCancel() {
    if (tmpFilename) {
      try {
        await api.deleteTempFile(tmpFilename);
      } catch {
        // best-effort cleanup
      }
    }
    reset();
  }

  async function handleSavePdf() {
    if (!tmpFilename) return;
    setStatus("saving");
    setError("");
    try {
      const res = await api.commitParsed(tmpFilename);
      onSaved(res.claim);
      reset();
    } catch (err: any) {
      setError(err?.message || "Save failed");
      setStatus("review-pdf");
    }
  }

  async function handleImportRows() {
    if (rows.length === 0) return;
    setStatus("saving");
    setError("");
    try {
      const res = await api.importJson(rows);
      onImported(res.claims || []);
      reset();
    } catch (err: any) {
      setError(err?.message || "Import failed");
      setStatus("review-rows");
    }
  }

  const pdfFields = ["state", "district", "village", "patta_holder", "land_area", "date", "lat", "lon"] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[#0f2a44]">
          <UploadCloud className="w-5 h-5" />
          Upload FRA Document / Bulk Import
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === "idle" && (
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="text-sm"
            />
            <Button onClick={handleAnalyze} disabled={!file}>
              Analyze
            </Button>
          </div>
        )}

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
        {status === "analyzing" && <div className="text-sm text-muted-foreground">Analyzing document…</div>}
        {status === "saving" && <div className="text-sm text-muted-foreground">Saving…</div>}

        {status === "review-pdf" && (
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-700">Review Extracted Information</h3>
            <div className="grid grid-cols-2 gap-3">
              {pdfFields.map((f) => (
                <div key={f}>
                  <label className="text-xs text-muted-foreground capitalize">{f.replace("_", " ")}</label>
                  <Input value={pdfForm[f] ?? ""} onChange={(e) => setPdfForm({ ...pdfForm, [f]: e.target.value })} />
                </div>
              ))}
              <div>
                <label className="text-xs text-muted-foreground">Status</label>
                <Select value={pdfForm.status || "Pending"} onValueChange={(v) => setPdfForm({ ...pdfForm, status: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pending">Pending</SelectItem>
                    <SelectItem value="Granted">Granted</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSavePdf} className="bg-gov-green hover:bg-gov-green/90">
                Save to DB
              </Button>
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
            {extractedText && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">OCR preview</summary>
                <pre className="max-h-40 overflow-auto bg-gray-50 p-3 rounded mt-2 whitespace-pre-wrap">{extractedText.slice(0, 2000)}</pre>
              </details>
            )}
          </div>
        )}

        {status === "review-rows" && rows.length > 0 && (
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-700 text-center">Preview Rows ({rows.length})</h3>
            <div className="max-h-80 overflow-auto border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    {Object.keys(rows[0]).map((key) => (
                      <TableHead key={key} className="text-xs uppercase">
                        {key}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i}>
                      {Object.keys(rows[0]).map((col) => (
                        <TableCell key={col}>
                          <Input
                            className="h-8 text-sm"
                            value={row[col] ?? ""}
                            onChange={(e) => {
                              const next = [...rows];
                              next[i] = { ...next[i], [col]: e.target.value };
                              setRows(next);
                            }}
                          />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleImportRows} className="bg-gov-green hover:bg-gov-green/90">
                Import Rows
              </Button>
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
