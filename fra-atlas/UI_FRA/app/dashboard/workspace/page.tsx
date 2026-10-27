"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Map as LeafletMap } from "leaflet";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import ProtectedRoute from "@/components/protected-route";
import { api } from "@/lib/api";
import WorkspaceToolbar from "@/components/workspace/WorkspaceToolbar";
import ClaimFormDialog from "@/components/workspace/ClaimFormDialog";
import ClaimsTable from "@/components/workspace/ClaimsTable";
import UploadPanel from "@/components/workspace/UploadPanel";
import DiagnosticsPanel from "@/components/workspace/DiagnosticsPanel";
import { buildOptionsFromRows, type WorkspaceClaim, type WorkspaceVillage } from "@/components/workspace/types";

// Leaflet touches `window` at import time, so the map must never render on the server.
const WorkspaceMap = dynamic(() => import("@/components/workspace/WorkspaceMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full flex items-center justify-center text-muted-foreground">Loading map…</div>,
});

export default function WorkspacePage() {
  const mapRef = useRef<LeafletMap | null>(null);

  const [claims, setClaims] = useState<WorkspaceClaim[]>([]);
  const [villages, setVillages] = useState<WorkspaceVillage[]>([]);
  const [loadError, setLoadError] = useState("");

  const [stateSel, setStateSel] = useState("");
  const [districtSel, setDistrictSel] = useState("");
  const [villageSel, setVillageSel] = useState("");
  const [districtOptions, setDistrictOptions] = useState<string[]>([]);
  const [villageOptions, setVillageOptions] = useState<string[]>([]);

  const [showGranted, setShowGranted] = useState(true);
  const [showPending, setShowPending] = useState(true);
  const [resetTick, setResetTick] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editingClaim, setEditingClaim] = useState<WorkspaceClaim | null>(null);
  const [pickOnMap, setPickOnMap] = useState(false);
  const [pickedCoords, setPickedCoords] = useState<{ lat: number; lon: number } | null>(null);

  const [diagnosticsClaim, setDiagnosticsClaim] = useState<WorkspaceClaim | null>(null);

  async function reloadClaims() {
    try {
      const rows = await api.getClaims();
      setClaims(rows.map((c) => ({ ...c, lat: c.lat != null ? Number(c.lat) : null, lon: c.lon != null ? Number(c.lon) : null })));
      setLoadError("");
    } catch (err: any) {
      setLoadError(err?.message || "Failed to load claims");
    }
  }

  async function reloadVillages() {
    try {
      const rows = await api.getVillages();
      setVillages(rows.map((v: any) => ({ ...v, lat: v.lat != null ? Number(v.lat) : null, lon: v.lon != null ? Number(v.lon) : null })));
    } catch (err) {
      console.warn("Failed to load villages", err);
    }
  }

  useEffect(() => {
    reloadClaims();
    reloadVillages();
  }, []);

  // Cascading filters: state -> district options
  useEffect(() => {
    if (!stateSel) {
      setDistrictOptions([]);
      setDistrictSel("");
      setVillageOptions([]);
      setVillageSel("");
      return;
    }
    const fromVillages = villages.filter((v) => (v.state || "").toLowerCase() === stateSel.toLowerCase());
    const fromClaims = claims.filter((c) => (c.state || "").toLowerCase() === stateSel.toLowerCase());
    setDistrictOptions(buildOptionsFromRows([...fromVillages, ...fromClaims], stateSel, "district"));
    setDistrictSel("");
    setVillageOptions([]);
    setVillageSel("");
  }, [stateSel, villages, claims]);

  // district -> village options
  useEffect(() => {
    if (!stateSel || !districtSel) {
      setVillageOptions([]);
      setVillageSel("");
      return;
    }
    const fromVillages = villages.filter(
      (v) => (v.state || "").toLowerCase() === stateSel.toLowerCase() && (v.district || "").toLowerCase() === districtSel.toLowerCase()
    );
    const fromClaims = claims.filter(
      (c) => (c.state || "").toLowerCase() === stateSel.toLowerCase() && (c.district || "").toLowerCase() === districtSel.toLowerCase()
    );
    setVillageOptions(buildOptionsFromRows([...fromVillages, ...fromClaims], stateSel, "village"));
    setVillageSel("");
  }, [stateSel, districtSel, villages, claims]);

  const filteredClaims = useMemo(() => {
    return claims.filter((c) => {
      if (stateSel && (c.state || "").toLowerCase() !== stateSel.toLowerCase()) return false;
      if (districtSel && (c.district || "").toLowerCase() !== districtSel.toLowerCase()) return false;
      if (villageSel && (c.village || "").toLowerCase() !== villageSel.toLowerCase()) return false;
      const status = (c.status || "").toLowerCase();
      if (status === "granted" && !showGranted) return false;
      if (status === "pending" && !showPending) return false;
      return true;
    });
  }, [claims, stateSel, districtSel, villageSel, showGranted, showPending]);

  function flyTo(lat?: number | null, lon?: number | null, zoom = 14) {
    if (lat == null || lon == null || !mapRef.current) return;
    mapRef.current.flyTo([lat, lon], zoom, { duration: 0.7 });
  }

  function handleClaimSaved(claim: WorkspaceClaim) {
    setClaims((prev) => {
      const idx = prev.findIndex((c) => c.id === claim.id);
      if (idx === -1) return [claim, ...prev];
      const copy = [...prev];
      copy[idx] = { ...copy[idx], ...claim };
      return copy;
    });
    flyTo(claim.lat, claim.lon, 16);
  }

  function handleClaimsImported(imported: WorkspaceClaim[]) {
    if (imported.length === 0) return;
    setClaims((prev) => [...imported, ...prev]);
    const first = imported.find((c) => c.lat != null && c.lon != null);
    if (first) flyTo(first.lat, first.lon, 14);
  }

  function handleClaimsDeleted(ids: Array<number | string>) {
    setClaims((prev) => prev.filter((c) => !ids.includes(c.id)));
  }

  function handleReset() {
    setResetTick((t) => t + 1);
    setStateSel("");
    setDistrictSel("");
    setVillageSel("");
  }

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold text-[#0f2a44]">Claims Workspace</h1>
            <a href={api.exportCsv()} target="_blank" rel="noreferrer">
              <Button variant="outline">
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            </a>
          </div>

          {loadError && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{loadError}</div>}

          <WorkspaceToolbar
            onNewClaim={() => {
              setEditingClaim(null);
              setPickedCoords(null);
              setFormOpen(true);
            }}
            onReset={handleReset}
            showGranted={showGranted}
            onToggleGranted={() => setShowGranted((v) => !v)}
            showPending={showPending}
            onTogglePending={() => setShowPending((v) => !v)}
            stateSel={stateSel}
            onChangeState={setStateSel}
            districtOptions={districtOptions}
            districtSel={districtSel}
            onChangeDistrict={setDistrictSel}
            villageOptions={villageOptions}
            villageSel={villageSel}
            onChangeVillage={setVillageSel}
          />

          <div className="h-[60vh] rounded-lg overflow-hidden border shadow-sm">
            <WorkspaceMap
              claims={filteredClaims}
              selectedState={stateSel}
              selectedDistrict={districtSel}
              showGranted={showGranted}
              showPending={showPending}
              pickOnMap={pickOnMap}
              resetTick={resetTick}
              onMapReady={(map) => {
                mapRef.current = map;
              }}
              onMapClick={([lat, lon]) => {
                if (!pickOnMap) return;
                setPickedCoords({ lat, lon });
                setPickOnMap(false);
                setFormOpen(true);
              }}
              onStateSelected={(name) => setStateSel(name)}
              onRunDiagnostics={(claim) => setDiagnosticsClaim(claim)}
            />
          </div>

          <UploadPanel onSaved={handleClaimSaved} onImported={handleClaimsImported} />

          <div className="bg-white rounded-lg shadow-sm p-4">
            <h2 className="font-semibold text-[#0f2a44] mb-3">Claims</h2>
            <ClaimsTable
              claims={filteredClaims}
              onZoom={(c) => flyTo(c.lat, c.lon, 15)}
              onEdit={(c) => {
                setEditingClaim(c);
                setPickedCoords(null);
                setFormOpen(true);
              }}
              onDeleted={handleClaimsDeleted}
            />
          </div>
        </div>

        <ClaimFormDialog
          open={formOpen}
          editClaim={editingClaim}
          prefillCoords={pickedCoords}
          pickOnMap={pickOnMap}
          onTogglePick={(v) => {
            setPickOnMap(v);
            if (v) {
              // Close the dialog so the map underneath is clickable — Radix's
              // modal Dialog otherwise blocks pointer events on the page.
              setFormOpen(false);
            } else {
              setPickedCoords(null);
            }
          }}
          onClose={() => {
            setFormOpen(false);
            setPickOnMap(false);
            setPickedCoords(null);
            setEditingClaim(null);
          }}
          onSaved={handleClaimSaved}
        />

        {diagnosticsClaim && <DiagnosticsPanel claim={diagnosticsClaim} onClose={() => setDiagnosticsClaim(null)} />}

        {pickOnMap && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[10000] bg-white shadow-lg rounded-lg border px-4 py-2 flex items-center gap-3">
            <span className="text-sm text-emerald-800 font-medium">Click the map to pick coordinates</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setPickOnMap(false);
                setFormOpen(true);
              }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
