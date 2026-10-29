"use client";

// Leaflet map of the 7 model districts. Load with next/dynamic({ ssr: false }).
import { useEffect, useMemo, useState } from "react";
import { CircleMarker, GeoJSON, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Claim } from "@/lib/api";
import { DISTRICT_FILES, STATUS_COLOR } from "@/lib/meta";

type Feature = { district: string; geo: any };

const pickIcon = L.divIcon({
  className: "",
  html: '<div style="width:16px;height:16px;border-radius:50%;background:#111827;border:3px solid #fff;box-shadow:0 0 0 2px #111827"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

function ClickCatcher({ onPick }: { onPick?: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onPick?.(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** Zoom to the district polygons once they've loaded. */
function FitToFeatures({ features }: { features: Feature[] }) {
  const map = useMap();
  useEffect(() => {
    if (!features.length) return;
    const bounds = L.geoJSON(features.map((f) => f.geo) as any).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.08));
  }, [features, map]);
  return null;
}

export interface AtlasMapProps {
  height?: number | string;
  /** fill colour per district (e.g. from a scheme score); default neutral */
  fill?: Record<string, string>;
  /** tooltip text per district */
  tooltip?: Record<string, string>;
  selected?: string | null;
  onSelectDistrict?: (d: string) => void;
  claims?: Claim[];
  claimPopup?: (c: Claim) => React.ReactNode;
  onPick?: (lat: number, lon: number) => void;
  picked?: [number, number] | null;
}

export default function AtlasMap({
  height = 460, fill, tooltip, selected, onSelectDistrict, claims = [], claimPopup, onPick, picked,
}: AtlasMapProps) {
  const [features, setFeatures] = useState<Feature[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      Object.entries(DISTRICT_FILES).map(([district, file]) =>
        fetch(`/geojson/districts/${file}`).then((r) => r.json()).then((geo) => ({ district, geo })),
      ),
    ).then((f) => !cancelled && setFeatures(f)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const fillKey = useMemo(() => JSON.stringify(fill ?? {}) + (selected ?? ""), [fill, selected]);

  return (
    <div style={{ height }} className="overflow-hidden rounded-lg border border-slate-200">
      <MapContainer center={[21.5, 82]} zoom={5} minZoom={4} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />
        {features.map(({ district, geo }) => (
          <GeoJSON
            key={`${district}-${fillKey}`}
            data={geo}
            style={() => ({
              color: selected === district ? "#111827" : "#334155",
              weight: selected === district ? 3 : 1.2,
              fillColor: fill?.[district] ?? "#cbd5e1",
              fillOpacity: 0.75,
            })}
            eventHandlers={{
              // Point picking is handled once by ClickCatcher (map clicks bubble up from polygons).
              click: () => onSelectDistrict?.(district),
            }}
          >
            <Tooltip sticky>{tooltip?.[district] ?? district}</Tooltip>
          </GeoJSON>
        ))}
        {claims
          .filter((c) => c.lat != null && c.lon != null)
          .map((c) => (
            <CircleMarker
              key={c.id}
              center={[Number(c.lat), Number(c.lon)]}
              radius={6}
              pathOptions={{ color: "#fff", weight: 1.5, fillColor: STATUS_COLOR[c.status ?? ""] ?? "#64748b", fillOpacity: 1 }}
            >
              <Tooltip>{c.patta_holder || c.village || `Claim #${c.id}`}</Tooltip>
              {claimPopup && <Popup>{claimPopup(c)}</Popup>}
            </CircleMarker>
          ))}
        <FitToFeatures features={features} />
        {picked && <Marker position={picked} icon={pickIcon} />}
        {onPick && <ClickCatcher onPick={onPick} />}
      </MapContainer>
    </div>
  );
}
