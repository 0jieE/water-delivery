import { useEffect, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { geocodeAddress, getMultiRoute, getRoute, type LatLng } from "./geo";

/** Addresses rarely change, so a lookup is cached for the whole session. */
export function useGeocode(address: string | undefined) {
  const clean = address?.trim() ?? "";
  return useQuery({
    queryKey: ["geocode", clean],
    queryFn: ({ signal }) => geocodeAddress(clean, signal),
    enabled: clean.length > 0,
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });
}

/** Coordinates are rounded (~110 m) so small GPS jitter doesn't trigger a new routing request. */
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function useRoute(from: LatLng | null, to: LatLng | null) {
  return useQuery({
    queryKey: ["route", from && [r3(from.lat), r3(from.lng)], to && [to.lat, to.lng]],
    queryFn: ({ signal }) => getRoute(from as LatLng, to as LatLng, signal),
    enabled: !!from && !!to,
    staleTime: 60_000,
    retry: 1,
  });
}

/** Route through several waypoints in the order given (rider position first, then each stop). */
export function useTripRoute(points: LatLng[]) {
  return useQuery({
    queryKey: ["trip-route", points.map((p) => [r3(p.lat), r3(p.lng)])],
    queryFn: ({ signal }) => getMultiRoute(points, signal),
    enabled: points.length >= 2,
    staleTime: 60_000,
    retry: 1,
  });
}

export interface StopInput {
  id: number;
  address: string;
  pin: LatLng | null;
}

export interface StopPosition {
  id: number;
  pos: LatLng | null;
  loading: boolean;
  /** Found by address lookup at barangay/city level rather than an exact pin. */
  approximate: boolean;
}

/**
 * Where each stop is: the order's saved pin when it has one, otherwise a cached address lookup.
 * Lookups share the cache key of `useGeocode` and are spaced out by the geocoder throttle.
 */
export function useStopPositions(stops: StopInput[]): StopPosition[] {
  const lookups = useQueries({
    queries: stops.map((s) => ({
      queryKey: ["geocode", s.address.trim()],
      queryFn: ({ signal }: { signal: AbortSignal }) => geocodeAddress(s.address.trim(), signal),
      enabled: !s.pin && s.address.trim().length > 0,
      staleTime: Infinity,
      gcTime: 60 * 60 * 1000,
      retry: 1,
    })),
  });
  return stops.map((s, i) => {
    if (s.pin) return { id: s.id, pos: s.pin, loading: false, approximate: false };
    const q = lookups[i];
    const hit = q.data ?? null;
    return {
      id: s.id,
      pos: hit ? { lat: hit.lat, lng: hit.lng } : null,
      loading: q.isLoading,
      approximate: !!hit?.approximate,
    };
  });
}

export type GeoStatus ="pending" | "ready" | "denied" | "unavailable";

/** Live position of THIS device. It is never sent to the backend (the API has no endpoint for it). */
export function useDevicePosition(enabled: boolean) {
  const [position, setPosition] = useState<LatLng | null>(null);
  const [status, setStatus] = useState<GeoStatus>("pending");

  useEffect(() => {
    if (!enabled) return;
    if (!("geolocation" in navigator)) {
      setStatus("unavailable");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPosition({ lat: p.coords.latitude, lng: p.coords.longitude });
        setStatus("ready");
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  return { position, status };
}
