import { MapContainer, Marker, Polyline, Popup } from "react-leaflet";
import { Alert, Spinner } from "@/components/ui";
import { formatDistance, formatDuration, getStation, type LatLng } from "@/lib/geo";
import { useDevicePosition, useGeocode, useRoute } from "@/lib/geoQueries";
import { BaseTiles, FitTo, ICONS } from "./mapParts";

/**
 * Shows where an order is going. Origin of the route:
 *  - rider view (`rider`): the rider's own device position,
 *  - otherwise: the station, but only when VITE_STATION_LAT/LNG are configured.
 */
export default function DeliveryMap({
  address,
  pin = null,
  rider = false,
  heightClass = "h-72",
}: {
  address: string;
  /** The order's saved coordinates. When present they are used as-is; otherwise the address text is geocoded. */
  pin?: LatLng | null;
  rider?: boolean;
  heightClass?: string;
}) {
  // No lookup at all when the order carries its own pin.
  const dest = useGeocode(pin ? undefined : address);
  const device = useDevicePosition(rider);
  const station = rider ? null : getStation();

  const to: LatLng | null = pin ?? (dest.data ? { lat: dest.data.lat, lng: dest.data.lng } : null);
  const from = rider ? device.position : station;
  const route = useRoute(from, to);

  const points = [to, from].filter((p): p is LatLng => !!p);
  const originLabel = rider ? "you" : "our station";

  return (
    <div className="space-y-3">
      {dest.isLoading && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Finding this address on the map…
        </p>
      )}
      {dest.isError && <Alert>Couldn't look up the address right now. It will retry automatically.</Alert>}
      {dest.isSuccess && !dest.data && (
        <Alert kind="info">This address couldn't be found on the map. {rider ? "Call the customer for directions." : ""}</Alert>
      )}
      {dest.data?.approximate && (
        <Alert kind="info">Showing the nearest match for this address (barangay / city level), not the exact house.</Alert>
      )}
      {rider && device.status === "denied" && (
        <Alert kind="info">Location access is blocked, so the route from you can't be drawn. Allow location for this site in your browser settings.</Alert>
      )}
      {rider && device.status === "unavailable" && (
        <Alert kind="info">Your position isn't available (GPS off, or the page isn't served over HTTPS), so only the destination is shown.</Alert>
      )}

      {to && (
        <>
          {route.data && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg bg-water-50 px-3 py-2 text-sm">
              <span>
                <span className="font-semibold text-water-900">{formatDistance(route.data.distanceM)}</span> by road from {originLabel}
              </span>
              <span>
                About <span className="font-semibold text-water-900">{formatDuration(route.data.durationS)}</span>
              </span>
            </div>
          )}
          {route.isFetching && !route.data && from && (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner className="h-4 w-4" /> Calculating route…
            </p>
          )}
          {route.isError && <p className="text-xs text-amber-700">Route unavailable ({route.error.message}). The pin is still shown.</p>}

          {/* `isolate` keeps Leaflet's high z-indexes below our sticky header and modals */}
          <div className={`isolate overflow-hidden rounded-xl border border-slate-200 ${heightClass}`}>
            <MapContainer
              center={[to.lat, to.lng]}
              zoom={15}
              scrollWheelZoom={false}
              className="h-full w-full"
            >
              <BaseTiles />
              <FitTo points={points} />
              {route.data && (
                <Polyline positions={route.data.path.map((p) => [p.lat, p.lng] as [number, number])} pathOptions={{ color: "#2576eb", weight: 5, opacity: 0.85 }} />
              )}
              <Marker position={[to.lat, to.lng]} icon={ICONS.destination}>
                <Popup>Delivery address</Popup>
              </Marker>
              {from && (
                <Marker position={[from.lat, from.lng]} icon={rider ? ICONS.rider : ICONS.station}>
                  <Popup>{rider ? "You are here" : "Deep Water Refilling Station"}</Popup>
                </Marker>
              )}
            </MapContainer>
          </div>
        </>
      )}
    </div>
  );
}
