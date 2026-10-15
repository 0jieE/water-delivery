import { useCallback, useState } from "react";
import type { Marker as LeafletMarker } from "leaflet";
import { MapContainer, Marker, useMapEvents } from "react-leaflet";
import { Alert, Spinner } from "@/components/ui";
import { DEFAULT_CENTER, geocodeAddress, reverseGeocode, round6, type LatLng } from "@/lib/geo";
import { BaseTiles, FitTo, ICONS } from "./mapParts";

function ClickToPlace({ onPlace }: { onPlace: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPlace({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

/**
 * Drop or drag a pin. The pin is owned by the parent (`pin` / `onPin`) so it can be sent to the API
 * as latitude/longitude. The address field is filled in from the pin for convenience.
 */
export default function LocationPicker({
  pin,
  onPin,
  address,
  onAddress,
}: {
  pin: LatLng | null;
  onPin: (pin: LatLng | null) => void;
  address: string;
  onAddress: (address: string) => void;
}) {
  const [busy, setBusy] = useState<"find" | "locate" | "reverse" | null>(null);
  const [message, setMessage] = useState("");

  const place = useCallback(
    async (raw: LatLng) => {
      const p = { lat: round6(raw.lat), lng: round6(raw.lng) };
      onPin(p);
      setMessage("");
      setBusy("reverse");
      try {
        const found = await reverseGeocode(p);
        if (found) onAddress(found);
        else setMessage("No address found at that spot. Type it in manually.");
      } catch {
        setMessage("Couldn't look up an address for that spot. Type it in manually.");
      } finally {
        setBusy(null);
      }
    },
    [onPin, onAddress]
  );

  async function findAddress() {
    if (!address.trim()) {
      setMessage("Type an address first, then find it on the map.");
      return;
    }
    setBusy("find");
    setMessage("");
    try {
      const hit = await geocodeAddress(address);
      if (!hit) setMessage("That address wasn't found. Click the map to place the pin yourself.");
      else {
        onPin({ lat: round6(hit.lat), lng: round6(hit.lng) });
        if (hit.approximate) setMessage("Showing the nearest match. Drag the pin to your exact spot.");
      }
    } catch {
      setMessage("Address lookup is unavailable right now. Click the map to place the pin.");
    } finally {
      setBusy(null);
    }
  }

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setMessage("Your browser can't share its location.");
      return;
    }
    setBusy("locate");
    setMessage("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(null);
        void place({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        setBusy(null);
        setMessage(err.code === err.PERMISSION_DENIED ? "Location access was blocked for this site." : "Couldn't get your location.");
      },
      { enableHighAccuracy: true, timeout: 15_000 }
    );
  }

  const center = pin ?? DEFAULT_CENTER;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={findAddress} disabled={busy !== null}>
          {busy === "find" && <Spinner className="h-3 w-3" />} Find my address on the map
        </button>
        <button type="button" className="btn-secondary btn-sm" onClick={useMyLocation} disabled={busy !== null}>
          {busy === "locate" && <Spinner className="h-3 w-3" />} Use my current location
        </button>
        {pin && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => onPin(null)} disabled={busy !== null}>
            Remove pin
          </button>
        )}
        {busy === "reverse" && (
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <Spinner className="h-3 w-3" /> Looking up address…
          </span>
        )}
      </div>
      {message && <Alert kind="info">{message}</Alert>}

      <div className="isolate h-64 overflow-hidden rounded-xl border border-slate-200">
        <MapContainer center={[center.lat, center.lng]} zoom={pin ? 16 : 13} scrollWheelZoom={false} className="h-full w-full">
          <BaseTiles />
          <ClickToPlace onPlace={place} />
          {pin && (
            <>
              <FitTo points={[pin]} />
              <Marker
                position={[pin.lat, pin.lng]}
                icon={ICONS.destination}
                draggable
                eventHandlers={{
                  dragend: (e) => {
                    const ll = (e.target as LeafletMarker).getLatLng();
                    void place({ lat: ll.lat, lng: ll.lng });
                  },
                }}
              />
            </>
          )}
        </MapContainer>
      </div>
      <p className="text-xs text-slate-500">
        {pin ? "Pin set. " : "No pin yet. "}
        Click the map or drag the pin. The address above is filled in for you; add details like purok or house number.
      </p>
    </div>
  );
}
