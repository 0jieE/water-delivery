// Geocoding (Nominatim) and routing (OSRM) are THIRD-PARTY services, not our API. They are called
// with plain `fetch`, never the axios client, so the JWT can never be sent to them.
// Both base URLs can be pointed at a self-hosted instance via .env.

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeoResult extends LatLng {
  label: string;
  /** True when the full address was not found and a broader part of it (barangay / city) was used. */
  approximate: boolean;
}

export interface RouteResult {
  distanceM: number;
  durationS: number;
  path: LatLng[];
  /** One entry per hop between consecutive waypoints (distance/time of each stop-to-stop leg). */
  legs: { distanceM: number; durationS: number }[];
}

const GEOCODER = (import.meta.env.VITE_GEOCODER_URL as string | undefined) ?? "https://nominatim.openstreetmap.org";
const ROUTER = (import.meta.env.VITE_ROUTING_URL as string | undefined) ?? "https://router.project-osrm.org";

/** Build a pin from the API's nullable pair; null unless BOTH values are present. */
export function toPin(lat: number | null | undefined, lng: number | null | undefined): LatLng | null {
  return typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;
}

/** The API accepts up to 6 decimals (it rounds extras), so send tidy numbers. */
export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Fallback map centre (Kidapawan City) when there is nothing else to show. */
export const DEFAULT_CENTER: LatLng = { lat: 7.0083, lng: 125.0894 };

/** The refilling station, only if configured. We don't guess where the business is. */
export function getStation(): LatLng | null {
  const lat = Number(import.meta.env.VITE_STATION_LAT);
  const lng = Number(import.meta.env.VITE_STATION_LNG);
  return import.meta.env.VITE_STATION_LAT && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Nominatim allows about 1 request per second. Several stops can ask for a lookup at the same time
 * (a multi-stop trip), so every call reserves the next free 1.1 s slot and waits for it.
 */
let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + 1100;
  if (wait) await sleep(wait);
}

interface SearchHit {
  lat: number;
  lng: number;
  label: string;
  /** True for a specific building / road / business, false for an area (barangay, city, boundary). */
  precise: boolean;
}

async function searchOnce(query: string, signal?: AbortSignal): Promise<SearchHit | null> {
  await throttle();
  const url = `${GEOCODER}/search?format=jsonv2&limit=1&countrycodes=ph&accept-language=en&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Address lookup failed (${res.status}).`);
  const data = (await res.json()) as { lat: string; lon: string; display_name: string; category?: string; type?: string }[];
  if (!data.length) return null;
  const { category, type } = data[0];
  // Nominatim is lenient: it may ignore the part it can't find and return just the barangay centre.
  const area = category === "boundary" || (category === "place" && type !== "house");
  return { lat: Number(data[0].lat), lng: Number(data[0].lon), label: data[0].display_name, precise: !area };
}

/**
 * Turn a free-text Philippine address into coordinates. Street-level addresses ("Purok 3, Brgy. X,
 * Kidapawan City") often aren't in OpenStreetMap, so on a miss we drop the most specific part and
 * retry, flagging the result as approximate. Nominatim asks for at most 1 request/second.
 */
export async function geocodeAddress(address: string, signal?: AbortSignal): Promise<GeoResult | null> {
  // OpenStreetMap names barangays without the prefix ("Lanao", not "Barangay Lanao"), so drop it.
  const parts = address
    .replace(/\b(?:Brgy|Bgy|Barangay)\.?\s*/gi, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return null;

  const minParts = Math.min(2, parts.length);
  for (let drop = 0; parts.length - drop >= minParts; drop++) {
    const hit = await searchOnce(parts.slice(drop).join(", "), signal);
    if (hit) return { lat: hit.lat, lng: hit.lng, label: hit.label, approximate: drop > 0 || !hit.precise };
  }
  return null;
}

export async function reverseGeocode(p: LatLng, signal?: AbortSignal): Promise<string | null> {
  await throttle();
  const url = `${GEOCODER}/reverse?format=jsonv2&zoom=18&accept-language=en&lat=${p.lat}&lon=${p.lng}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Address lookup failed (${res.status}).`);
  const data = (await res.json()) as { display_name?: string };
  return data.display_name ?? null;
}

/** Driving route through two or more waypoints, in the order given (OSRM). */
export async function getMultiRoute(points: LatLng[], signal?: AbortSignal): Promise<RouteResult> {
  if (points.length < 2) throw new Error("A route needs at least two points.");
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `${ROUTER}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Routing failed (${res.status}).`);
  const data = (await res.json()) as {
    code: string;
    routes?: {
      distance: number;
      duration: number;
      geometry: { coordinates: [number, number][] };
      legs: { distance: number; duration: number }[];
    }[];
  };
  const route = data.routes?.[0];
  if (data.code !== "Ok" || !route) throw new Error("No driving route found to this address.");
  return {
    distanceM: route.distance,
    durationS: route.duration,
    path: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
    legs: route.legs.map((l) => ({ distanceM: l.distance, durationS: l.duration })),
  };
}

/** Driving route between two points (OSRM). */
export const getRoute = (from: LatLng, to: LatLng, signal?: AbortSignal) => getMultiRoute([from, to], signal);

/** Straight-line distance in metres (good enough for ordering nearby stops). */
export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Suggested visiting order: always go to the nearest remaining stop (simple "nearest neighbour").
 * It is a sensible default for a handful of drops, not an optimal route.
 */
export function nearestNeighbourOrder<T extends { pos: LatLng }>(start: LatLng | null, stops: T[]): T[] {
  const left = [...stops];
  const out: T[] = [];
  let here = start ?? left[0]?.pos ?? null;
  if (!start && left.length) out.push(left.shift() as T);
  while (left.length && here) {
    let best = 0;
    for (let i = 1; i < left.length; i++) if (haversineM(here, left[i].pos) < haversineM(here, left[best].pos)) best = i;
    const next = left.splice(best, 1)[0];
    out.push(next);
    here = next.pos;
  }
  return out;
}
export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

export function formatDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

