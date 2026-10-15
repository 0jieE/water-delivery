import { useEffect } from "react";
import L from "leaflet";
import { TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { LatLng } from "@/lib/geo";

/** Inline-SVG pins: avoids Leaflet's default marker images, which bundlers can't resolve. */
export function pinIcon(color: string) {
  return L.divIcon({
    className: "",
    iconSize: [30, 40],
    iconAnchor: [15, 40],
    popupAnchor: [0, -36],
    html: `<svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 1C7.8 1 2 6.7 2 13.8 2 23.6 15 39 15 39s13-15.4 13-25.2C28 6.7 22.2 1 15 1Z" fill="${color}" stroke="#fff" stroke-width="2"/>
      <circle cx="15" cy="14" r="5" fill="#fff"/></svg>`,
  });
}

/** Round numbered marker for the n-th stop of a trip. */
export function stopIcon(n: number, done = false) {
  return L.divIcon({
    className: "",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -16],
    html: `<div style="width:34px;height:34px;border-radius:9999px;background:${done ? "#059669" : "#dc2626"};color:#fff;
      border:3px solid #fff;box-shadow:0 2px 8px rgba(15,23,42,.35);display:flex;align-items:center;justify-content:center;
      font:700 14px/1 Inter,system-ui,sans-serif">${n}</div>`,
  });
}

export const ICONS = {
  destination: pinIcon("#dc2626"),
  rider: pinIcon("#2576eb"),
  station: pinIcon("#059669"),
};

export function BaseTiles() {
  return (
    <TileLayer
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      maxZoom={19}
    />
  );
}

/** Re-frames the map whenever the set of points changes. */
export function FitTo({ points }: { points: LatLng[] }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join("|");
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) map.setView([points[0].lat, points[0].lng], 16);
    else map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}
