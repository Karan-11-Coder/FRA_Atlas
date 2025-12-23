import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  Tooltip,
  Popup,
  Marker,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { API_BASE } from "../config";
import { authFetch } from "../libs/apiClient";

// Resolve API base
const API = (() => {
  const b = String(API_BASE || "").replace(/\/$/, "");
  if (!b) return "/api";
  if (b.endsWith("/api")) return b;
  if (b.includes("/api/")) return b.replace(/\/$/, "");
  return b + "/api";
})();

// Helpers
function getLayerBounds(layer) {
  return layer && typeof layer.getBounds === "function" ? layer.getBounds() : null;
}
function asFC(data) {
  if (!data) return null;
  if (data.type === "FeatureCollection") return data;
  if (data.type === "Feature") return { type: "FeatureCollection", features: [data] };
  return null;
}
function tagStateName(fc, name) {
  if (!fc || !fc.features) return fc;
  return {
    ...fc,
    features: fc.features.map(f => ({
      ...f,
      properties: { ...(f.properties || {}), state: name },
    })),
  };
}
function getStateName(p = {}) {
  return p.state || p.State || p.STATE || p.ST_NM || p.NAME_1 || p.name || "";
}
function getDistrictName(p = {}) {
  return p.district || p.DISTRICT || p.DIST_NAME || p.NAME_2 || p.name || "";
}

// Custom Icons
const pendingIcon = L.divIcon({
  className: "custom-icon",
  html: `
    <div style="
      width: 22px; height: 22px;
      background: #dc2626;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      color: white; font-size: 14px; font-weight: bold;">
      🔒
    </div>
  `,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

const grantedIcon = L.divIcon({
  className: "custom-icon",
  html: `
    <div style="
      width: 22px; height: 22px;
      background: #22c55e;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      color: white; font-size: 14px; font-weight: bold;">
      ✓
    </div>
  `,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

// Small helper that uses the real map instance from React-Leaflet v4
function ZoomToLandButton({ position, zoom = 15, children = "Zoom to land" }) {
  const map = useMap();
  return (
    <button
      onClick={() => map && map.flyTo(position, zoom, { animate: true })}
      style={{
        width: "100%",
        marginTop: 6,
        padding: "6px 10px",
        borderRadius: 6,
        border: "1px solid #ddd",
        background: "#e0f2fe",
        cursor: "pointer",
        fontSize: 13,
      }}
    >
      {children}
    </button>
  );
}

export default function MapPanel({
  defaultCenter = [21.15, 79.09],
  defaultZoom = 5,
  resetTick = 0,
  onMapCreated,
  onMapClick,
  onStateSelected,
  onDistrictSelected,
  onRunDiagnostics,

  // layer toggles + chips
  showStates = true,
  showDistricts = true,
  showGranted = true,
  showPending = true,

  // NEW: cascading selections from header
  selectedState: selectedStateProp = "",
  selectedDistrict: selectedDistrictProp = "",
  selectedVillage: selectedVillageProp = "",
}) {
  const mapRef = useRef(null);

  const [statesFC, setStatesFC] = useState(null);
  const [districtsFC] = useState(null); // placeholder
  // Internal selection (click-driven) — kept as-is
  const [selectedStateInternal, setSelectedStateInternal] = useState(null);
  const [selectedDistrictInternal, setSelectedDistrictInternal] = useState(null);

  const [claims, setClaims] = useState([]);
  const [basemap, setBasemap] = useState("osm");

  // === DERIVED (sync dropdowns with map selection without changing click logic) ===
  const selectedState = (selectedStateProp || "").trim() || selectedStateInternal || "";
  const selectedDistrict = (selectedDistrictProp || "").trim() || selectedDistrictInternal || "";
  const selectedVillage = (selectedVillageProp || "").trim() || "";

  // Load 4 states (served from /public/geojson/*.json)
  useEffect(() => {
    let cancel = false;
    (async () => {
      const sources = [
        { url: "/geojson/mp.json",        label: "Madhya Pradesh" },
        { url: "/geojson/odisha.json",    label: "Odisha" },
        { url: "/geojson/telangana.json", label: "Telangana" },
        { url: "/geojson/tripura.json",   label: "Tripura" },
      ];
      const results = await Promise.allSettled(
        sources.map(s =>
          fetch(s.url)
            .then(r => {
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              return r.json();
            })
            .then(j => ({ label: s.label, data: j }))
        )
      );
      const fcs = results.flatMap((res, i) => {
        if (res.status !== "fulfilled") return [];
        const fc = tagStateName(asFC(res.value.data), sources[i].label);
        return fc?.features?.length ? [fc] : [];
      });
      const merged = fcs.length
        ? { type: "FeatureCollection", features: fcs.flatMap(fc => fc.features) }
        : null;
      if (!cancel) setStatesFC(merged);
    })();
    return () => { cancel = true; };
  }, []);

  // --- Sync map view when header selection changes (fit to state bounds) ---
  useEffect(() => {
    if (!mapRef.current || !statesFC) return;

    // When dropdown sets state, update internal to keep both sources aligned
    if (selectedStateProp) {
      setSelectedStateInternal(selectedStateProp);
      // Fit to that state's polygon
      const match = statesFC.features.find(
        f => getStateName(f.properties).toLowerCase() === selectedStateProp.toLowerCase()
      );
      if (match) {
        const b = L.geoJSON(match).getBounds();
        if (b && b.isValid()) mapRef.current.fitBounds(b.pad(0.05), { animate: true });
      }
    } else {
      // No state selected → show all states extent
      fitToAllStates();
      setSelectedStateInternal(null);
    }

    // If header cleared the district, clear internal too
    if (!selectedDistrictProp) setSelectedDistrictInternal(null);
    else setSelectedDistrictInternal(selectedDistrictProp);
  }, [selectedStateProp, selectedDistrictProp, statesFC]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch claims — when selection changes (state/district/village)
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        if (!selectedState && !selectedDistrict) {
          if (!cancel) setClaims([]);
          return;
        }
        const qs = new URLSearchParams();
        if (selectedState) qs.set("state", selectedState);
        if (selectedDistrict) qs.set("district", selectedDistrict);
        if (selectedVillage) qs.set("village", selectedVillage);
        const url = `${API}/claims?${qs.toString()}`;
        const res = await authFetch(url);
        const json = await res.json();
        const arr = Array.isArray(json) ? json : json?.claims || [];
        const normalized = arr
          .map(c => {
            let { lat, lon } = c;
            if ((lat == null || lon == null) && Array.isArray(c.coordinates)) {
              lon = Number(c.coordinates[0]);
              lat = Number(c.coordinates[1]);
            }
            return { ...c, lat: Number(lat), lon: Number(lon) };
          })
          .filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lon));
        if (!cancel) setClaims(normalized);
      } catch (e) {
        if (!cancel) setClaims([]);
        console.warn("Failed to fetch claims:", e);
      }
    })();
    return () => { cancel = true; };
  }, [selectedState, selectedDistrict, selectedVillage]);

  // Fit to all 4 states (used by Reset)
  const fitToAllStates = () => {
    if (!mapRef.current || !statesFC) {
      if (mapRef.current) mapRef.current.setView(defaultCenter, defaultZoom, { animate: true });
      return;
    }
    const tmp = L.geoJSON(statesFC);
    const b = tmp.getBounds();
    if (b && b.isValid()) {
      mapRef.current.fitBounds(b.pad(0.05), { animate: true });
    } else {
      mapRef.current.setView(defaultCenter, defaultZoom, { animate: true });
    }
  };

  // Reset when parent bumps resetTick
  useEffect(() => {
    setSelectedStateInternal(null);
    setSelectedDistrictInternal(null);
    setClaims([]); // explicitly hide claims after reset
    fitToAllStates();
  }, [resetTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Styles
  const stateStyle = feature => {
    const sName = getStateName(feature.properties);
    const active = !selectedState || selectedState === sName;
    return {
      color: active ? "#0057B7" : "#cfcfcf",
      weight: active ? 2 : 1,
      fillColor: active ? "#7FB3FF" : "#efefef",
      fillOpacity: active ? 0.35 : 0.05,
      opacity: active ? 1 : 0.6,
    };
  };
  const districtStyle = () => ({
    color: "#888",
    weight: 1,
    fillColor: "#ddd",
    fillOpacity: 0.12,
    opacity: 1,
  });

  // Click handlers (UNCHANGED logic)
  const onEachState = (feature, layer) => {
    layer.on("click", () => {
      const name = getStateName(feature.properties);
      setSelectedStateInternal(name);          // keep internal selection (map click)
      setSelectedDistrictInternal(null);
      const b = getLayerBounds(layer);
      if (b && mapRef.current) mapRef.current.fitBounds(b.pad(0.05), { animate: true });
      onStateSelected && onStateSelected(feature);
    });
    layer.on("mouseover", () => layer.setStyle({ weight: 3 }));
    layer.on("mouseout", () => layer.setStyle({ weight: 2 }));
  };
  const onEachDistrict = (feature, layer) => {
    layer.on("click", () => {
      const dName = getDistrictName(feature.properties);
      setSelectedDistrictInternal(dName);      // keep internal selection (map click)
      const b = getLayerBounds(layer);
      if (b && mapRef.current) mapRef.current.fitBounds(b.pad(0.06), { animate: true });
      onDistrictSelected && onDistrictSelected(feature);
    });
  };

  // === Filtered states FC: when a state is selected, only render that state's polygon ===
  const filteredStatesFC = useMemo(() => {
    if (!statesFC) return null;
    if (!selectedState) return statesFC; // show all when nothing selected
    const feats = statesFC.features.filter(
      f => getStateName(f.properties).toLowerCase() === selectedState.toLowerCase()
    );
    return { type: "FeatureCollection", features: feats };
  }, [statesFC, selectedState]);

  // Claims visibility after selection
  const visibleClaims = useMemo(() => {
    return claims.filter(c => {
      if (c.status === "Granted" && !showGranted) return false;
      if (c.status === "Pending" && !showPending) return false;

      if (selectedVillage) {
        return (c.village || "").toLowerCase() === selectedVillage.toLowerCase();
      }
      if (selectedDistrict) {
        return (c.district || "").toLowerCase() === selectedDistrict.toLowerCase();
      }
      if (selectedState) {
        return (c.state || "").toLowerCase() === selectedState.toLowerCase();
      }
      return false;
    });
  }, [claims, showGranted, showPending, selectedState, selectedDistrict, selectedVillage]);

  // Basemap
  const tile =
    basemap === "sat"
      ? {
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          attr: "Tiles © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
        }
      : {
          url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          attr: "© OpenStreetMap",
        };

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      {/* Overlay controls */}
      <div
        style={{
          position: "absolute",
          zIndex: 1000,
          top: 12,
          right: 12,
          background: "rgba(255,255,255,0.95)",
          borderRadius: 8,
          boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
          padding: 8,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={basemap === "sat"}
            onChange={(e) => setBasemap(e.target.checked ? "sat" : "osm")}
          />
          Satellite
        </label>

        <button
          onClick={() => {
            // UI reset: clear INTERNAL selection (header may also clear via resetTick)
            setSelectedStateInternal(null);
            setSelectedDistrictInternal(null);
            setClaims([]);
            const wantsAll = !selectedStateProp; // if header hasn't forced a state, show all
            wantsAll ? fitToAllStates() : null;
          }}
          style={{
            fontSize: 13,
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #ddd",
            background: "#f6f6f6",
            cursor: "pointer",
          }}
        >
          Reset
        </button>
      </div>

      <MapContainer
        center={defaultCenter}
        zoom={defaultZoom}
        style={{ height: "100%", width: "100%" }}
        whenCreated={(mapInstance) => {
          mapRef.current = mapInstance;
          onMapCreated && onMapCreated(mapInstance);
          mapInstance.on("click", e => onMapClick && onMapClick([e.latlng.lat, e.latlng.lng]));
        }}
      >
        <TileLayer url={tile.url} attribution={tile.attr} />

        {/* STATES */}
        {showStates && filteredStatesFC && (
          <GeoJSON
            key={`states-${selectedState || "all"}`}
            data={filteredStatesFC}
            style={stateStyle}
            onEachFeature={onEachState}
          />
        )}

        {/* DISTRICTS (placeholder if you add per-state districts later) */}
        {showDistricts && districtsFC && (
          <GeoJSON
            key={`districts-${selectedState || "all"}-${selectedDistrict || "all"}`}
            data={districtsFC}
            style={districtStyle}
            onEachFeature={onEachDistrict}
          />
        )}

        {/* CLAIM MARKERS */}
        {visibleClaims.map((c, idx) => {
          const icon = c.status === "Granted" ? grantedIcon : pendingIcon;
          const pos = [c.lat, c.lon];
          return (
            <Marker key={idx} position={pos} icon={icon}>
              <Tooltip>
                <div>
                  <strong>{c.patta_holder || "Claim"}</strong>
                  <br />{[c.village, c.district, c.state].filter(Boolean).join(", ")}
                </div>
              </Tooltip>
              <Popup>
                <div style={{ minWidth: 220, fontSize: 13 }}>
                  <div><strong>Name:</strong> {c.patta_holder || "-"}</div>
                  <div><strong>State:</strong> {c.state || "-"}</div>
                  <div><strong>District:</strong> {c.district || "-"}</div>
                  <div><strong>Village:</strong> {c.village || "-"}</div>
                  <div><strong>Status:</strong> {c.status || c.claim_status || "-"}</div>
                  {c.land_area && <div><strong>Area:</strong> {c.land_area}</div>}
                  {c.date && <div><strong>Date:</strong> {c.date}</div>}

                  <button
                    onClick={() => onRunDiagnostics && onRunDiagnostics(c)}
                    style={{
                      width: "100%",
                      marginTop: 8,
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "1px solid #ddd",
                      background: "#f6f6f6",
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                  >
                    Run diagnostics
                  </button>

                  <ZoomToLandButton position={pos} zoom={15}>
                    Zoom to land
                  </ZoomToLandButton>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
