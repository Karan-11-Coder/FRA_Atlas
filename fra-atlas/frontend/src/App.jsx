/* src/App.jsx */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "./config";
import useClaims from "./hooks/useClaims";
import HeaderToolbar from "./components/HeaderToolbar";
import MapPanel from "./components/MapPanel";
import UploadPanel from "./components/UploadPanel";
import UploadReviewPanel from "./components/UploadReviewPanel";
import ClaimsPanelWrapper from "./components/ClaimsPanelWrapper";
import NewClaimForm from "./components/NewClaimForm";
import DiagnosticsPanel from "./components/DiagnosticsPanel";

// ✅ auth-aware API helpers
import { authFetch, fetchCurrentUser, removeToken } from "./libs/apiClient";

/**
 * Normalize a string for dedupe key (trim, collapse whitespace, lowercase)
 * Return { key, display } where display is original trimmed value (or TitleCase if you prefer)
 */
// add this helper inside your App component (near other helpers)
function normalizeClaimForFrontend(raw) {
  if (!raw) return null;
  const c = { ...(raw.claim || raw) }; // accept wrapped {claim:...} or raw
  // id fallback
  c.id = c.id ?? c.claim_id ?? c.ifr_number ?? c.ifrNo ?? null;
  // canonical string fields
  c.state = (c.state ?? c.state_name ?? c.stateName ?? "").toString();
  c.district = (c.district ?? c.dist ?? "").toString();
  c.village = (c.village ?? c.village_name ?? c.villageName ?? "").toString();
  c.patta_holder = (c.patta_holder ?? c.pattaHolder ?? c.name ?? "").toString();
  c.land_area = (c.land_area ?? c.area ?? null);
  c.status = (c.status ?? c.claim_status ?? "Pending").toString();
  // numeric coords (coerce safely)
  const latRaw = c.lat ?? c.latitude ?? c.lat_deg ?? null;
  const lonRaw = c.lon ?? c.longitude ?? c.lon_deg ?? null;
  c.lat = (latRaw != null && latRaw !== "") ? Number(latRaw) : null;
  c.lon = (lonRaw != null && lonRaw !== "") ? Number(lonRaw) : null;
  // created_at fallback keep as-is if present
  // keep all other fields too
  return c;
}


/**
 * Build deduped, normalized options from rows (villages or claims)
 * `rows` - array of objects that contain the text field (like district or village)
 * `filterState` - optional state string to restrict results
 * `field` - name of field to extract ('district' or 'village')
 */

// --- add this helper ONCE (place above buildOptionsFromRows) ---
function normalizeForKey(raw) {
  if (raw == null) return { key: "", display: "" };
  const s = String(raw).trim();
  if (!s) return { key: "", display: "" };

  // stable key: lowercase, collapse whitespace
  const key = s.replace(/\s+/g, " ").toLowerCase();

  // nice display: Title Case
  const display = s
    .replace(/\s+/g, " ")
    .toLowerCase()
    .split(" ")
    .map(word => word.length ? (word[0].toUpperCase() + word.slice(1)) : "")
    .join(" ");

  return { key, display };
}

// --- single canonical implementation of buildOptionsFromRows ---
function buildOptionsFromRows(rows = [], filterState = "", field = "district") {
  const seen = new Map(); // key -> display
  for (const r of rows || []) {
    if (!r) continue;

    // If a state filter is provided, only include rows matching that state
    if (filterState && ((r.state || "").toLowerCase() !== filterState.toLowerCase())) {
      continue;
    }

    const raw = (r[field] || "");
    if (!raw) continue;

    const { key, display } = normalizeForKey(raw);
    if (!key) {
      // helpful debug log in dev
      if (process.env.NODE_ENV !== "production") {
        console.warn("buildOptionsFromRows skipped empty key for raw:", raw, "row:", r);
      }
      continue;
    }

    if (!seen.has(key)) {
      seen.set(key, display);
    }
  }

  // return array of display strings (or change to objects if you want value/display)
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

// -------------------------
// API normalizer
// -------------------------
const API = (() => {
  const b = String(API_BASE || "").replace(/\/$/, "");
  if (!b) return "/api";
  if (b.endsWith("/api")) return b;
  if (b.includes("/api/")) return b.replace(/\/$/, "");
  return b + "/api";
})();

// fixed list of 4 states to show in the State filter
const STATE_OPTIONS = ["Madhya Pradesh", "Odisha", "Telangana", "Tripura"];

export default function App() {

  // 🔑 TOKEN SYNC FROM UI_FRA → FRONTEND (ADD THIS)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (token) {
      localStorage.setItem("fra_atlas_token", token);

      // clean URL (remove ?token=...)
      window.history.replaceState(
        {},
        document.title,
        window.location.pathname
      );
    }
  }, []);
  
  // -------------------------
  // Legacy app state (unchanged where possible)
  // -------------------------
  const [viewMode, setViewMode] = useState("state");
  const [selectedStateFeature, setSelectedStateFeature] = useState(null);
  const [selectedDistrictFeature, setSelectedDistrictFeature] = useState(null);
  const [selectedVillage, setSelectedVillage] = useState(null);
  const [selectedStateBounds, setSelectedStateBounds] = useState(null);

  // layer/claim toggles (UI checkboxes for layers will be hidden in HeaderToolbar; we still keep the booleans)
  const [showStates, setShowStates] = useState(true);
  const [showDistricts, setShowDistricts] = useState(true);
  const [showVillages, setShowVillages] = useState(true);
  const [showGranted, setShowGranted] = useState(true);
  const [showPending, setShowPending] = useState(true);

  // map ref + defaults
  const mapRef = useRef(null);
  const defaultCenter = [21.15, 79.09];
  const defaultZoom = 5;
  const [resetTick, setResetTick] = useState(0);

  // UI + data
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [dbClaims, setDbClaims] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [pickOnMap, setPickOnMap] = useState(false);
  const [pickCoords, setPickCoords] = useState(null);
  const [editingClaim, setEditingClaim] = useState(null);
  const [villages, setVillages] = useState([]);

  // NEW: current user
  const [currentUser, setCurrentUser] = useState(null);

  // claims drawer + cache via hook
  const [showClaimsVisible, setShowClaimsVisible] = useState(false);
  const [claimsDrawerVillage, setClaimsDrawerVillage] = useState(null);
  const { getClaimsForVillage, cacheRef: claimsCacheRef, upsertClaim } = useClaims();

  // diagnostics
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [selectedClaimForDiagnostics, setSelectedClaimForDiagnostics] = useState(null);

  // -------------------------
  // NEW: Cascading filters (State → District → Village)
  // -------------------------
  const [stateSel, setStateSel] = useState(""); // selected state (one of 4)
  const [districtSel, setDistrictSel] = useState(""); // selected district
  const [villageSel, setVillageSel] = useState(""); // selected village
  const [districtOptions, setDistrictOptions] = useState([]); // string[]
  const [villageOptions, setVillageOptions] = useState([]); // string[]

  // ---------------- when State changes → load districtOptions (from villages ∪ claims) ----------------
  useEffect(() => {
    if (!stateSel) {
      setDistrictOptions([]);
      setDistrictSel("");
      setVillageOptions([]);
      setVillageSel("");
      return;
    }

    // Option A: if you have an API endpoint for districts (authFetch) you can keep that.
    // But as robust fallback we build from local villages + dbClaims.
    (async () => {
      try {
        // fetch remote districts list if you rely on endpoint (optional)
        // const res = await authFetch(`${API}/districts?state=${encodeURIComponent(stateSel)}`);
        // const listRemote = await res.json().catch(() => []);
        // build from server list if it returns simple strings
        // if (Array.isArray(listRemote) && listRemote.length) { setDistrictOptions(listRemote); setDistrictSel(""); setVillageOptions([]); setVillageSel(""); return; }

        // Build union from villages (preferred) and dbClaims (so new claims immediately add options)
        const fromVillages = (villages || []).filter(v => (v.state || "").toLowerCase() === stateSel.toLowerCase());
        const fromClaims = (dbClaims || []).filter(c => (c.state || "").toLowerCase() === stateSel.toLowerCase());

        const districts = buildOptionsFromRows([...fromVillages, ...fromClaims], stateSel, "district");
        setDistrictOptions(districts);
        setDistrictSel(""); // reset district selection
        setVillageOptions([]); // clear villages
        setVillageSel("");
      } catch (err) {
        console.warn("Failed to build districtOptions:", err);
        setDistrictOptions([]);
        setDistrictSel("");
        setVillageOptions([]);
        setVillageSel("");
      }
    })();
  }, [stateSel, villages, dbClaims]); // include villages + dbClaims so UI updates when they change
  // -----------------------------------------------------------------------------------------------

  // ---------------- when District changes → load villageOptions (from villages ∪ claims) ----------------
  useEffect(() => {
    if (!stateSel || !districtSel) {
      setVillageOptions([]);
      setVillageSel("");
      return;
    }

    (async () => {
      try {
        // Prefer server call if you have one:
        // const res = await authFetch(`${API}/villages?state=${encodeURIComponent(stateSel)}&district=${encodeURIComponent(districtSel)}`);
        // const listRemote = await res.json().catch(() => []);
        // if (Array.isArray(listRemote) && listRemote.length) { setVillageOptions(listRemote); setVillageSel(""); return; }

        const fromVillages = (villages || []).filter(v =>
          (v.state || "").toLowerCase() === stateSel.toLowerCase() &&
          (v.district || "").toLowerCase() === districtSel.toLowerCase()
        );
        const fromClaims = (dbClaims || []).filter(c =>
          (c.state || "").toLowerCase() === stateSel.toLowerCase() &&
          (c.district || "").toLowerCase() === districtSel.toLowerCase()
        );

        const villagesList = buildOptionsFromRows([...fromVillages, ...fromClaims], stateSel, "village");
        setVillageOptions(villagesList);
        setVillageSel("");
      } catch (err) {
        console.warn("Failed to build villageOptions:", err);
        setVillageOptions([]);
        setVillageSel("");
      }
    })();
  }, [stateSel, districtSel, villages, dbClaims]);
  // -----------------------------------------------------------------------------------------------

  // -------------------------
  // Handlers
  // -------------------------
  function handleRunDiagnostics(claim) {
    if (!claim) return;
    setSelectedClaimForDiagnostics(claim);
    setDiagnosticsOpen(true);
  }

  async function handleUpload() {
    if (!file) return alert("Select a file first");
    const formData = new FormData();
    formData.append("file", file);

    // decide endpoint by extension
    const name = (file.name || "").toLowerCase();
    const isExcel = name.endsWith(".csv") || name.endsWith(".xlsx") || name.endsWith(".xls");
    const url = isExcel ? `${API}/claims/import-excel` : `${API}/upload-fra`;

    try {
      setUploading(true);

      const res = await authFetch(url, { method: "POST", body: formData });

      if (!res.ok) {
        // try to read JSON error if available
        let errText = `${res.status} ${res.statusText}`;
        try { const errJson = await res.json(); errText = errJson.detail || JSON.stringify(errJson); } catch {}
        throw new Error(`Upload failed: ${errText}`);
      }

      const data = await res.json();

      // --- Handle Excel/CSV bulk import response ---
      if (isExcel) {
        // expected shape: { success: true, count: N, claims: [...], errors: [...] }
        const count = data?.count ?? 0;
        const claims = data?.claims ?? [];
        const errors = data?.errors ?? [];

        // upsert all imports into frontend state
        if (Array.isArray(claims) && claims.length) {
          for (const c of claims) {
            try { upsertClaim?.(c); } catch {}
          }
          // call single callback to notify UI - you can adapt to show list instead
          handleClaimSaved?.(claims[0]);
          // fly to first claim with coords (if present)
          const firstWithCoords = claims.find(c => c?.lat != null && c?.lon != null);
          if (firstWithCoords && mapRef.current) {
            try { mapRef.current.flyTo([Number(firstWithCoords.lat), Number(firstWithCoords.lon)], 14); } catch {}
          }
        }

        // give user feedback
        alert(`Imported ${count} claims. ${errors?.length ? `${errors.length} rows failed.` : ""}`);
        setFile(null);
        return;
      }

      // --- Handle single-upload (/upload-fra) response ---
      const createdClaim = data?.claim || data?.result || null;
      if (createdClaim) {
        handleClaimSaved(createdClaim);
        try { upsertClaim?.(createdClaim); } catch {}
        if (createdClaim?.lat != null && createdClaim?.lon != null && mapRef.current) {
          try { mapRef.current.flyTo([Number(createdClaim.lat), Number(createdClaim.lon)], 14); } catch {}
        }
        setFile(null);
        return;
      }

      // --- fallback: create from entities if upload returned entities but no claim ---
      const entities = data?.entities || {};
      const claimPayload = {
        state: entities.state || "",
        district: entities.district || "",
        village: (entities.villages && entities.villages[0]) || entities.village || "",
        patta_holder: (entities.patta_holders && entities.patta_holders[0]) || entities.patta_holder || "",
        date: (entities.dates && entities.dates[0]) || data.date || "",
        land_area: entities.area || entities.land_area || null,
        status: entities.claim_status || "Pending",
        lat: data?.lat ?? null,
        lon: data?.lon ?? null,
        source_filename: data?.filename || null,
        extracted_text: data?.extracted_text || null,
      };

      const createRes = await authFetch(`${API}/claims`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(claimPayload),
      });

      if (!createRes.ok) {
        const txt = await createRes.text().catch(() => null);
        throw new Error(`Create claim failed: ${createRes.status} ${txt || ""}`);
      }

      const created = await createRes.json();
      const normalizedFallback = created?.claim || created;

      handleClaimSaved(normalizedFallback);
      try { upsertClaim?.(normalizedFallback); } catch {}

      if (normalizedFallback?.lat != null && normalizedFallback?.lon != null && mapRef.current) {
        try { mapRef.current.flyTo([Number(normalizedFallback.lat), Number(normalizedFallback.lon)], 16, { duration: 0.8 }); } catch {}
      }
      setFile(null);

    } catch (err) {
      console.error("handleUpload error", err);
      alert("Upload/create failed: " + (err?.message || err));
    } finally {
      setUploading(false);
    }
  }

  async function loadDbClaims() {
    try {
      const res = await authFetch(`${API}/claims`);
      const json = await res.json();
      const raw = Array.isArray(json) ? json : json?.claims || [];
      const normalized = raw.map((c) => ({
        ...c,
        lat: c.lat != null ? Number(c.lat) : null,
        lon: c.lon != null ? Number(c.lon) : null
      }));
      setDbClaims(normalized);
    } catch (err) {
      console.error("Failed to load claims", err);
      setDbClaims([]);
    }
  }
  async function reloadDbClaims() {
    try {
      const res = await authFetch(`${API}/claims`);
      if (!res.ok) throw new Error(`reload claims failed: ${res.status}`);
      const json = await res.json();
      const arr = Array.isArray(json) ? json : json?.claims || [];
      const normalized = arr.map((c) => ({
        ...c,
        lat: c.lat != null ? Number(c.lat) : null,
        lon: c.lon != null ? Number(c.lon) : null
      }));
      setDbClaims(normalized);
    } catch (e) {
      console.error("reloadDbClaims error", e);
    }
  }
  useEffect(() => { loadDbClaims(); }, []);

  // ✅ Listen for import completion (fra-data-changed) and reload villages + claims
useEffect(() => {
  function onDataChanged() {
    reloadDbClaims();
    // refresh villages list from backend
    (async () => {
      try {
        const res = await authFetch(`${API}/villages`);
        const json = await res.json();
        let arr = Array.isArray(json) ? json : (Array.isArray(json.villages) ? json.villages : []);
        const normalized = arr.map(v => ({
          ...v,
          lat: v.lat != null ? Number(v.lat) : null,
          lon: v.lon != null ? Number(v.lon) : null
        }));
        setVillages(normalized);
      } catch (e) {
        console.warn("Failed to refresh villages:", e);
      }
    })();
  }

  window.addEventListener("fra-data-changed", onDataChanged);
  return () => window.removeEventListener("fra-data-changed", onDataChanged);
}, []);


  useEffect(() => {
    async function loadVillagesAll() {
      try {
        const res = await authFetch(`${API}/villages`);
        const json = await res.json();
        let arr = [];
        if (Array.isArray(json)) arr = json;
        else if (Array.isArray(json.villages)) arr = json.villages;
        const normalized = arr.map((v) => ({
          ...v,
          lat: v.lat != null ? Number(v.lat) : null,
          lon: v.lon != null ? Number(v.lon) : null
        }));
        setVillages(normalized);
      } catch (err) {
        console.error("Failed to load villages", err);
        setVillages([]);
      }
    }
    loadVillagesAll();
  }, []);

  // current user
  useEffect(() => {
    let mounted = true;
    async function loadUser() {
      try {
        const u = await fetchCurrentUser();
        if (mounted) setCurrentUser(u);
      } catch (err) {
        console.warn("Could not fetch current user:", err);
        if (err && (err.status === 401 || err.statusCode === 401 || err.message === "Unauthorized")) {
          try { removeToken(); } catch {}
          window.location.href = import.meta.env.VITE_LOGIN_URL || "http://localhost:3000/login";
        }
      }
    }
    loadUser();
    return () => { mounted = false; };
  }, []);

  function handleMapClick(coords) {
    if (pickOnMap) {
      setPickCoords(coords);
      setPickOnMap(false);
      setShowForm(true);
    }
  }

  function handleClaimSaved(createdOrUpdated) {
    if (!createdOrUpdated) return;
    if (createdOrUpdated.lat != null) createdOrUpdated.lat = Number(createdOrUpdated.lat);
    if (createdOrUpdated.lon != null) createdOrUpdated.lon = Number(createdOrUpdated.lon);

    setDbClaims((prev) => {
      const idx = prev.findIndex((c) => c.id === createdOrUpdated.id);
      if (idx !== -1) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...createdOrUpdated };
        return copy;
      } else {
        return [createdOrUpdated, ...prev];
      }
    });

    try { upsertClaim?.(createdOrUpdated); } catch {}
    setEditingClaim(null);

    try {
      if (mapRef?.current && createdOrUpdated.lat != null && createdOrUpdated.lon != null) {
        mapRef.current.flyTo([Number(createdOrUpdated.lat), Number(createdOrUpdated.lon)], 16, { duration: 0.8 });
      } else {
        window.dispatchEvent(new CustomEvent("fra-focus", { detail: { lat: createdOrUpdated.lat, lon: createdOrUpdated.lon } }));
      }
    } catch (err) { console.warn("flyTo failed:", err); }
  }

  function handleEditClaim(claim) {
    if (!claim) return;
    setEditingClaim(claim);
    setShowForm(true);
    if (mapRef.current && claim.lat != null && claim.lon != null) {
      try { mapRef.current.flyTo([Number(claim.lat), Number(claim.lon)], 14); } catch {}
    }
  }

  async function zoomToVillageAndShowClaims(villageObj) {
    if (!villageObj) return;
    const villageName = villageObj.village;
    if (!villageName) return;

    setSelectedVillage(villageName);
    setClaimsDrawerVillage(villageName);

    let fetched = null;
    try { fetched = await getClaimsForVillage(villageName); } catch (err) { console.warn("getClaimsForVillage threw", err); }

    const cachedEntry = claimsCacheRef?.current && claimsCacheRef.current[villageName];
    let claims = Array.isArray(fetched) ? fetched : (cachedEntry && Array.isArray(cachedEntry.claims) ? cachedEntry.claims.slice() : []);

    if ((!claims || claims.length === 0) && claimsCacheRef?.current) {
      const lowerKey = Object.keys(claimsCacheRef.current).find((k) => k && k.toLowerCase() === villageName.toLowerCase());
      if (lowerKey && claimsCacheRef.current[lowerKey] && Array.isArray(claimsCacheRef.current[lowerKey].claims)) {
        claims = claimsCacheRef.current[lowerKey].claims.slice();
      }
    }

    if (Array.isArray(claims) && claims.length > 1) {
      const pts = claims.filter((c) => c && c.lat != null && c.lon != null).map((c) => [Number(c.lat), Number(c.lon)]);
      if (pts.length > 0 && mapRef.current) {
        try {
          const bounds = L.latLngBounds(pts);
          mapRef.current.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
        } catch (e) {
          if (villageObj.lat != null && villageObj.lon != null && mapRef.current) mapRef.current.flyTo([villageObj.lat, villageObj.lon], 16);
        }
      } else {
        if (villageObj.lat != null && villageObj.lon != null && mapRef.current) mapRef.current.flyTo([villageObj.lat, villageObj.lon], 16);
      }
    } else if (Array.isArray(claims) && claims.length === 1) {
      const c = claims[0];
      if (c.lat != null && c.lon != null && mapRef.current) {
        try { mapRef.current.flyTo([Number(c.lat), Number(c.lon)], 16); return; } catch (e) {
          if (villageObj.lat != null && villageObj.lon != null && mapRef.current) { mapRef.current.flyTo([villageObj.lat, villageObj.lon], 16); }
        }
      } else if (villageObj.lat != null && villageObj.lon != null && mapRef.current) {
        mapRef.current.flyTo([villageObj.lat, villageObj.lon], 16);
      }
    } else {
      if (villageObj.lat != null && villageObj.lon != null && mapRef.current) mapRef.current.flyTo([villageObj.lat, villageObj.lon], 16);
    }

    setShowClaimsVisible(true);

    if ((!claims || claims.length === 0) && Array.isArray(fetched) && fetched.length > 0) {
      try {
        claimsCacheRef.current = claimsCacheRef.current || {};
        claimsCacheRef.current[villageName] = { claims: fetched.slice(), count: fetched.length };
      } catch {}
    }
  }

  function handleClaimsDeleted(deletedIds) {
    if (!Array.isArray(deletedIds) || deletedIds.length === 0) return;
    setDbClaims((prev) => prev.filter((c) => !deletedIds.includes(c.id)));
  }

  function handleClaimUpdated(updated) {
    if (!updated || !updated.id) return;
    if (updated.lat != null) updated.lat = Number(updated.lat);
    if (updated.lon != null) updated.lon = Number(updated.lon);

    setDbClaims((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));

    try {
      const name = updated.village;
      if (name && claimsCacheRef?.current && claimsCacheRef.current[name]) {
        const entry = claimsCacheRef.current[name];
        entry.claims = entry.claims.map((c) => (c.id === updated.id ? { ...c, ...updated } : c));
        claimsCacheRef.current[name] = entry;
      }
    } catch {}

    if (claimsDrawerVillage && updated.village && claimsDrawerVillage.toLowerCase() === updated.village.toLowerCase()) {
      setShowClaimsVisible(false);
      setTimeout(() => setShowClaimsVisible(true), 50);
    }
  }

  const [geoCache, setGeoCache] = useState({});
  async function geocodeVillage(village) {
    if (!village) return null;
    if (geoCache[village]) return geoCache[village];
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(village)}, India`);
      const data = await res.json();
      if (data && data[0]) {
        const coords = [parseFloat(data[0].lat), parseFloat(data[0].lon)];
        setGeoCache((prev) => ({ ...prev, [village]: coords }));
        return coords;
      }
    } catch (e) {
      console.error("Geocoding failed:", e);
    }
    return null;
  }

  useEffect(() => {
    dbClaims.forEach((c) => {
      if (c.village && !geoCache[c.village]) geocodeVillage(c.village);
    });
  }, [dbClaims]);

  const baseLayers = useMemo(() => [
    { key: "OSM", name: "OpenStreetMap", url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "&copy; OpenStreetMap contributors" },
    { key: "Carto", name: "Carto Positron", url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; OpenStreetMap' },
    { key: "Esri", name: "Esri World Imagery", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attribution: "Tiles &copy; Esri" },
  ], []);

  const districtLayers = useMemo(() => [
    // kept in MapPanel file (no need to duplicate here)
  ], []);

  // map created callback (MapPanel calls this)
  function handleMapCreated(map) {
    mapRef.current = map;
    try {
      window.__MAP__ = map;
      window.__APP__ = window.__APP__ || {};
      window.__APP__.mapCreatedAt = new Date().toISOString();
    } catch {}
  }

  function handleZoomToClaim(claim) {
    if (!mapRef.current) {
      if (claim?.lat != null && claim?.lon != null) {
        window.dispatchEvent(new CustomEvent("fra-focus", { detail: { lat: Number(claim.lat), lon: Number(claim.lon), zoom: 13 } }));
        return;
      }
      alert("Map not ready yet.");
      return;
    }
    if (claim?.lat != null && claim?.lon != null) {
      try { mapRef.current.flyTo([Number(claim.lat), Number(claim.lon)], 15, { duration: 0.7 }); return; } catch {}
    }
    if (claim?.village && geoCache[claim.village]) {
      try { const [lat, lon] = geoCache[claim.village]; mapRef.current.flyTo([lat, lon], 13, { duration: 0.7 }); return; } catch {}
    }
    alert("No coordinates available for this claim or village.");
  }

  // Reset view (also clears new filters)
  function handleReset() {
    if (mapRef.current) mapRef.current.setView(defaultCenter, defaultZoom);
    setResetTick((t) => t + 1);
    setViewMode("state");
    setSelectedDistrictFeature(null);
    setSelectedVillage(null);
    setSelectedStateBounds(null);
    setShowClaimsVisible(false);
    setClaimsDrawerVillage(null);

    // clear cascading filters
    setStateSel("");
    setDistrictSel("");
    setVillageSel("");
    setDistrictOptions([]);
    setVillageOptions([]);
  }

  function handleBackToState() {
    if (selectedStateBounds && mapRef.current) {
      try { mapRef.current.fitBounds(selectedStateBounds, { padding: [20, 20] }); } catch (e) { handleReset(); }
    } else handleReset();
    setViewMode("state");
    setSelectedDistrictFeature(null);
    setSelectedVillage(null);
    setShowClaimsVisible(false);
    setClaimsDrawerVillage(null);
  }

  /* visibleVillages (legacy — still used by MapPanel’s district view) */
  const visibleVillages = useMemo(() => {
    if (viewMode !== "district" || !selectedDistrictFeature) return [];
    const sd =
      (selectedDistrictFeature.properties?.DISTRICT ||
        selectedDistrictFeature.properties?.district ||
        selectedDistrictFeature.properties?.name ||
        "")
        .toString()
        .trim()
        .toLowerCase();
    if (!sd) return [];
    return villages.filter((v) => ((v.district || "").toString().trim().toLowerCase()) === sd);
  }, [villages, viewMode, selectedDistrictFeature]);

  /* filtered DB claims — now ALSO filtered by the cascading dropdowns */
  const filteredDbClaims = useMemo(() => {
    return dbClaims.filter((c) => {
      if (!c) return false;

      // priority: header dropdowns
      if (stateSel && (c.state || "").toLowerCase() !== stateSel.toLowerCase()) return false;
      if (districtSel && (c.district || "").toLowerCase() !== districtSel.toLowerCase()) return false;
      if (villageSel && (c.village || "").toLowerCase() !== villageSel.toLowerCase()) return false;

      // legacy district view filter (kept)
      if (viewMode === "district" && selectedDistrictFeature) {
        const sd = ((selectedDistrictFeature.properties?.DISTRICT || selectedDistrictFeature.properties?.name) || "").toLowerCase();
        if ((c.district || "").toLowerCase() !== sd) return false;
      }

      // safe, case-insensitive status checks
      const status = (c.status || "").toString().trim().toLowerCase();
      if (status === "granted" && !showGranted) return false;
      if (status === "pending" && !showPending) return false;

      return true;
    });
  }, [dbClaims, stateSel, districtSel, villageSel, viewMode, selectedDistrictFeature, showGranted, showPending]);

  function handleLogout() {
    try {
      removeToken();
      setDbClaims([]);
      setVillages([]);
      setCurrentUser(null);
      setEditingClaim(null);
      setShowForm(false);
      const loginUrl = import.meta.env.VITE_LOGIN_URL || "http://localhost:3000/login";
      window.location.href = loginUrl;
    } catch (e) {
      console.error("Logout failed:", e);
      window.location.href = import.meta.env.VITE_LOGIN_URL || "http://localhost:3000/login";
    }
  }

  // -------------------------
  // Render legacy dashboard
  // -------------------------
  return (
    <div className="min-h-screen flex flex-col">
      <HeaderToolbar
        onNewClaim={() => { setShowForm(true); setPickOnMap(false); setPickCoords(null); }}
        onReset={handleReset}

        /* Old layer toggles (HeaderToolbar should hide their UI now, but props kept for compatibility) */
        showStates={showStates} setShowStates={setShowStates}
        showDistricts={showDistricts} setShowDistricts={setShowDistricts}
        showVillages={showVillages} setShowVillages={setShowVillages}

        /* Granted/Pending chips (unchanged) */
        showGranted={showGranted} setShowGranted={setShowGranted}
        showPending={showPending} setShowPending={setShowPending}

        /* View / breadcrumb */
        viewMode={viewMode}
        selectedStateFeature={selectedStateFeature}
        selectedDistrictFeature={selectedDistrictFeature}
        onBackToState={handleBackToState}
        onBackToDistrict={handleBackToState}

        /* NEW: Cascading filters props for the toolbar */
        stateOptions={STATE_OPTIONS}
        selectedStateValue={stateSel}
        onChangeState={setStateSel}
        districtOptions={districtOptions}
        selectedDistrictValue={districtSel}
        onChangeDistrict={setDistrictSel}
        villageOptions={villageOptions}
        selectedVillageValue={villageSel}
        onChangeVillage={setVillageSel}

        /* user & logout */
        currentUser={currentUser}
        onLogout={handleLogout}
      />

      <main className="flex-1 p-4 space-y-6">
        <div className="h-[62vh] relative">
          <MapPanel
            defaultCenter={defaultCenter}
            defaultZoom={defaultZoom}
            resetTick={resetTick}
            onMapCreated={handleMapCreated}
            onMapClick={handleMapClick}

            onStateSelected={(f) => {
              setSelectedStateFeature(f);
              setSelectedDistrictFeature(null);
              setSelectedVillage(null);
              setViewMode("state");
              setShowClaimsVisible(false);
              setClaimsDrawerVillage(null);
            }}
            onDistrictSelected={(f) => {
              setSelectedDistrictFeature(f);
              setViewMode("district");
              setSelectedVillage(null);
              setShowClaimsVisible(false);
              setClaimsDrawerVillage(null);
            }}
            onVillageClick={(v) => {
              setSelectedVillage(v.village);
              if (v.lat != null && v.lon != null && mapRef.current) mapRef.current.flyTo([v.lat, v.lon], 13);
            }}

            /* NEW: pass cascading selections so MapPanel can filter polygons/markers */
            selectedState={stateSel}
            selectedDistrict={districtSel}
            selectedVillage={villageSel}

            /* layer toggles + claim chips */
            showStates={showStates}
            showDistricts={showDistricts}
            showVillages={showVillages}
            showGranted={showGranted}
            showPending={showPending}

            /* claims drawer helpers */
            showClaimsVisible={showClaimsVisible}
            claimsDrawerVillage={claimsDrawerVillage}
            claimsCacheRef={claimsCacheRef}

            onRunDiagnostics={handleRunDiagnostics}
            onZoomToClaim={handleZoomToClaim}
            zoomToVillageAndShowClaims={zoomToVillageAndShowClaims}
            visibleVillages={visibleVillages}
          />
        </div>

        {/* UploadReviewPanel - integrated (normalizes returned claim shape) */}
<UploadReviewPanel
  onSaved={(rawClaim) => {
    const claim = normalizeClaimForFrontend(rawClaim);
    if (!claim) return;
    try { handleClaimSaved?.(claim); } catch (e) { console.warn("handleClaimSaved failed", e); }
    try { upsertClaim?.(claim); } catch (e) { console.warn("upsertClaim failed", e); }
  }}
  upsertClaim={(c) => {
    const claim = normalizeClaimForFrontend(c);
    if (!claim) return;
    try { upsertClaim?.(claim); } catch (e) { console.warn("upsertClaim wrapper failed", e); }
  }}
  mapRef={mapRef}
  authFetch={authFetch}
  API={API}
/>

        <ClaimsPanelWrapper
          dbClaims={filteredDbClaims}
          onRowClick={(c) => {
            if (c.lat != null && c.lon != null) {
              if (mapRef.current) {
                try { mapRef.current.flyTo([Number(c.lat), Number(c.lon)], 13); return; } catch (err) { console.warn("mapRef.flyTo failed", err); }
              }
              window.dispatchEvent(new CustomEvent("fra-focus", { detail: { lat: Number(c.lat), lon: Number(c.lon), zoom: 13 } }));
              return;
            }
            if (c.village && geoCache[c.village]) {
              if (mapRef.current) {
                try { mapRef.current.flyTo(geoCache[c.village], 13); return; } catch (err) { console.warn("mapRef.flyTo(geoCache) failed", err); }
              }
              window.dispatchEvent(new CustomEvent("fra-focus", { detail: { lat: geoCache[c.village][0], lon: geoCache[c.village][1], zoom: 13 } }));
              return;
            }
            console.warn("no coords available for claim", c?.id);
          }}
          onDeleteSuccess={handleClaimsDeleted}
          onZoom={handleZoomToClaim}
          onEdit={handleEditClaim}
          onUpdateSuccess={handleClaimUpdated}
          onUpdate={reloadDbClaims}
        />
      </main>

      <NewClaimForm
        open={showForm}
        editClaim={editingClaim}
        prefillCoords={pickCoords}
        pickOnMap={pickOnMap}
        onTogglePick={(b) => { setPickOnMap(b); if (!b) setPickCoords(null); }}
        onClose={() => { setShowForm(false); setPickOnMap(false); setPickCoords(null); setEditingClaim(null); }}
        onSaved={(createdOrUpdated) => { handleClaimSaved(createdOrUpdated); setShowForm(false); }}
        onUpdate={reloadDbClaims}
      />

      {diagnosticsOpen && (
        <DiagnosticsPanel
          claim={selectedClaimForDiagnostics}
          onClose={() => { setDiagnosticsOpen(false); setSelectedClaimForDiagnostics(null); }}
        />
      )}
    </div>
  );
}