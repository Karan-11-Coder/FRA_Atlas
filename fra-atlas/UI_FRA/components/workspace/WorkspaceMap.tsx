"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, Tooltip, Popup, Marker, useMap } from "react-leaflet";
import L, { type Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { WorkspaceClaim } from "./types";

const pendingIcon = L.divIcon({
  className: "custom-icon",
  html: `<div style="width:22px;height:22px;background:#dc2626;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;">P</div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

const grantedIcon = L.divIcon({
  className: "custom-icon",
  html: `<div style="width:22px;height:22px;background:#22c55e;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:bold;">✓</div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function asFC(data: any) {
  if (!data) return null;
  if (data.type === "FeatureCollection") return data;
  if (data.type === "Feature") return { type: "FeatureCollection", features: [data] };
  return null;
}
function tagStateName(fc: any, name: string) {
  if (!fc?.features) return fc;
  return {
    ...fc,
    features: fc.features.map((f: any) => ({ ...f, properties: { ...(f.properties || {}), state: name } })),
  };
}
function getStateName(p: any = {}) {
  return p.state || p.State || p.STATE || p.ST_NM || p.NAME_1 || p.name || "";
}

function ZoomToLandButton({ position, zoom = 15 }: { position: [number, number]; zoom?: number }) {
  const map = useMap();
  return (
    <button
      onClick={() => map.flyTo(position, zoom, { animate: true })}
      style={{ width: "100%", marginTop: 6, padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", background: "#e0f2fe", cursor: "pointer", fontSize: 13 }}
    >
      Zoom to land
    </button>
  );
}

interface Props {
  claims: WorkspaceClaim[];
  selectedState: string;
  selectedDistrict: string;
  showGranted: boolean;
  showPending: boolean;
  pickOnMap: boolean;
  resetTick: number;
  onMapReady: (map: LeafletMap) => void;
  onMapClick: (coords: [number, number]) => void;
  onStateSelected: (name: string) => void;
  onRunDiagnostics: (claim: WorkspaceClaim) => void;
}

const defaultCenter: [number, number] = [21.15, 79.09];
const defaultZoom = 5;

export default function WorkspaceMap({
  claims,
  selectedState,
  selectedDistrict,
  showGranted,
  showPending,
  pickOnMap,
  resetTick,
  onMapReady,
  onMapClick,
  onStateSelected,
  onRunDiagnostics,
}: Props) {
  const mapRef = useRef<LeafletMap | null>(null);
  const [statesFC, setStatesFC] = useState<any>(null);
  const [basemap, setBasemap] = useState<"osm" | "sat">("osm");

  useEffect(() => {
    let cancelled = false;
    const sources = [
      { url: "/geojson/mp.json", label: "Madhya Pradesh" },
      { url: "/geojson/odisha.json", label: "Odisha" },
      { url: "/geojson/telangana.json", label: "Telangana" },
      { url: "/geojson/tripura.json", label: "Tripura" },
    ];
    Promise.allSettled(
      sources.map((s) => fetch(s.url).then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then((j) => ({ label: s.label, data: j })))
    ).then((results) => {
      const fcs = results.flatMap((res, i) => {
        if (res.status !== "fulfilled") return [];
        const fc = tagStateName(asFC(res.value.data), sources[i].label);
        return fc?.features?.length ? [fc] : [];
      });
      const merged = fcs.length ? { type: "FeatureCollection", features: fcs.flatMap((fc: any) => fc.features) } : null;
      if (!cancelled) setStatesFC(merged);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const fitToAllStates = () => {
    if (!mapRef.current) return;
    if (!statesFC) {
      mapRef.current.setView(defaultCenter, defaultZoom, { animate: true });
      return;
    }
    const b = L.geoJSON(statesFC).getBounds();
    if (b.isValid()) mapRef.current.fitBounds(b.pad(0.05), { animate: true });
    else mapRef.current.setView(defaultCenter, defaultZoom, { animate: true });
  };

  useEffect(() => {
    if (!mapRef.current || !statesFC) return;
    if (selectedState) {
      const match = statesFC.features.find((f: any) => getStateName(f.properties).toLowerCase() === selectedState.toLowerCase());
      if (match) {
        const b = L.geoJSON(match).getBounds();
        if (b.isValid()) mapRef.current.fitBounds(b.pad(0.05), { animate: true });
      }
    } else {
      fitToAllStates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedState, statesFC]);

  useEffect(() => {
    fitToAllStates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetTick]);

  const filteredStatesFC = useMemo(() => {
    if (!statesFC) return null;
    if (!selectedState) return statesFC;
    const feats = statesFC.features.filter((f: any) => getStateName(f.properties).toLowerCase() === selectedState.toLowerCase());
    return { type: "FeatureCollection", features: feats };
  }, [statesFC, selectedState]);

  const visibleClaims = useMemo(() => {
    return claims.filter((c) => {
      if (c.status === "Granted" && !showGranted) return false;
      if (c.status === "Pending" && !showPending) return false;
      if (selectedDistrict) return (c.district || "").toLowerCase() === selectedDistrict.toLowerCase();
      if (selectedState) return (c.state || "").toLowerCase() === selectedState.toLowerCase();
      return false;
    });
  }, [claims, showGranted, showPending, selectedState, selectedDistrict]);

  const stateStyle = (feature: any) => {
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

  const onEachState = (feature: any, layer: L.Layer) => {
    layer.on("click", () => {
      const name = getStateName(feature.properties);
      onStateSelected(name);
      const b = (layer as any).getBounds?.();
      if (b && mapRef.current) mapRef.current.fitBounds(b.pad(0.05), { animate: true });
    });
    (layer as any).on("mouseover", () => (layer as any).setStyle({ weight: 3 }));
    (layer as any).on("mouseout", () => (layer as any).setStyle({ weight: 2 }));
  };

  const tile =
    basemap === "sat"
      ? {
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          attr: "Tiles © Esri, Maxar, Earthstar Geographics",
        }
      : { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attr: "© OpenStreetMap contributors" };

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
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
          <input type="checkbox" checked={basemap === "sat"} onChange={(e) => setBasemap(e.target.checked ? "sat" : "osm")} />
          Satellite
        </label>
        {pickOnMap && <span style={{ fontSize: 12, color: "#065f46", fontWeight: 600 }}>Click map to pick a point</span>}
      </div>

      <MapContainer
        center={defaultCenter}
        zoom={defaultZoom}
        style={{ height: "100%", width: "100%" }}
        ref={(instance) => {
          if (instance && instance !== mapRef.current) {
            mapRef.current = instance;
            onMapReady(instance);
            instance.on("click", (e) => onMapClick([e.latlng.lat, e.latlng.lng]));
          }
        }}
      >
        <TileLayer url={tile.url} attribution={tile.attr} />

        {filteredStatesFC && (
          <GeoJSON key={`states-${selectedState || "all"}`} data={filteredStatesFC} style={stateStyle} onEachFeature={onEachState} />
        )}

        {visibleClaims.map((c) => {
          if (c.lat == null || c.lon == null) return null;
          const icon = c.status === "Granted" ? grantedIcon : pendingIcon;
          const pos: [number, number] = [Number(c.lat), Number(c.lon)];
          return (
            <Marker key={c.id} position={pos} icon={icon}>
              <Tooltip>
                <div>
                  <strong>{c.patta_holder || "Claim"}</strong>
                  <br />
                  {[c.village, c.district, c.state].filter(Boolean).join(", ")}
                </div>
              </Tooltip>
              <Popup>
                <div style={{ minWidth: 220, fontSize: 13 }}>
                  <div><strong>Name:</strong> {c.patta_holder || "-"}</div>
                  <div><strong>State:</strong> {c.state || "-"}</div>
                  <div><strong>District:</strong> {c.district || "-"}</div>
                  <div><strong>Village:</strong> {c.village || "-"}</div>
                  <div><strong>Status:</strong> {c.status || "-"}</div>
                  {c.land_area != null && <div><strong>Area:</strong> {c.land_area} ha</div>}
                  {c.date && <div><strong>Date:</strong> {c.date}</div>}
                  <button
                    onClick={() => onRunDiagnostics(c)}
                    style={{ width: "100%", marginTop: 8, padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", background: "#f6f6f6", cursor: "pointer", fontSize: 13 }}
                  >
                    Run diagnostics
                  </button>
                  <ZoomToLandButton position={pos} />
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
