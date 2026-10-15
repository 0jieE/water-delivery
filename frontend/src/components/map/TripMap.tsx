import { MapContainer, Marker, Polyline, Popup } from "react-leaflet";
import { DEFAULT_CENTER, type LatLng } from "@/lib/geo";
import { BaseTiles, FitTo, ICONS, stopIcon } from "./mapParts";

export interface TripStop {
  id: number;
  label: string;
  pos: LatLng;
}

/** Numbered stops, the rider's own position, and the road route through them. */
export default function TripMap({
  stops,
  origin,
  path,
  heightClass = "h-80",
}: {
  stops: TripStop[];
  origin: LatLng | null;
  path: LatLng[] | null;
  heightClass?: string;
}) {
  const points = [...stops.map((s) => s.pos), ...(origin ? [origin] : [])];
  const center = points[0] ?? DEFAULT_CENTER;
  return (
    <div className={`isolate overflow-hidden rounded-xl border border-slate-200 ${heightClass}`}>
      <MapContainer center={[center.lat, center.lng]} zoom={14} scrollWheelZoom={false} className="h-full w-full">
        <BaseTiles />
        <FitTo points={points} />
        {path && (
          <Polyline positions={path.map((p) => [p.lat, p.lng] as [number, number])} pathOptions={{ color: "#2576eb", weight: 5, opacity: 0.85 }} />
        )}
        {stops.map((s, i) => (
          <Marker key={s.id} position={[s.pos.lat, s.pos.lng]} icon={stopIcon(i + 1)}>
            <Popup>
              Stop {i + 1}: {s.label}
            </Popup>
          </Marker>
        ))}
        {origin && (
          <Marker position={[origin.lat, origin.lng]} icon={ICONS.rider}>
            <Popup>You are here</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
