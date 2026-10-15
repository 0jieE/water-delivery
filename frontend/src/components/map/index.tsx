import { lazy, Suspense, type ComponentProps } from "react";
import { LoadingState } from "@/components/ui";

// Leaflet is ~150 KB; load it only on screens that actually show a map.
const DeliveryMapLazy = lazy(() => import("./DeliveryMap"));
const LocationPickerLazy = lazy(() => import("./LocationPicker"));
const TripMapLazy = lazy(() => import("./TripMap"));

export type { TripStop } from "./TripMap";

export function TripMap(props: ComponentProps<typeof TripMapLazy>) {
  return (
    <Suspense fallback={<LoadingState label="Loading map…" compact />}>
      <TripMapLazy {...props} />
    </Suspense>
  );
}

export function DeliveryMap(props: ComponentProps<typeof DeliveryMapLazy>) {
  return (
    <Suspense fallback={<LoadingState label="Loading map…" />}>
      <DeliveryMapLazy {...props} />
    </Suspense>
  );
}

export function LocationPicker(props: ComponentProps<typeof LocationPickerLazy>) {
  return (
    <Suspense fallback={<LoadingState label="Loading map…" />}>
      <LocationPickerLazy {...props} />
    </Suspense>
  );
}
