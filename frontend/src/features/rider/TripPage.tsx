import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "@/components/Icon";
import { TripMap, type TripStop } from "@/components/map";
import { Alert, BackLink, EmptyState, ErrorState, LoadingState, OrderStatusBadge, PageHeader, Spinner } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { money } from "@/lib/format";
import { formatDistance, formatDuration, nearestNeighbourOrder, toPin } from "@/lib/geo";
import { useDevicePosition, useStopPositions, useTripRoute } from "@/lib/geoQueries";
import type { Delivery } from "@/lib/types";
import { useDeliveries } from "./api";
import { ActionDialogs, type Dialog } from "./DeliveryDetailPage";

interface Stop extends TripStop {
  delivery: Delivery;
  approximate: boolean;
}

/** Everything the rider has on the road right now: one map, a suggested order, per-stop actions. */
export default function TripPage() {
  const list = useDeliveries("active");
  const device = useDevicePosition(true);
  const [active, setActive] = useState<{ d: Delivery; dialog: Dialog } | null>(null);

  const onRoad = useMemo(
    () => (list.data?.results ?? []).filter((d) => d.order_status === "out_for_delivery"),
    [list.data]
  );
  const waiting = (list.data?.results ?? []).filter((d) => d.allowed_transitions.includes("out_for_delivery"));

  const positions = useStopPositions(
    onRoad.map((d) => ({ id: d.id, address: d.delivery_address, pin: toPin(d.delivery_latitude, d.delivery_longitude) }))
  );
  const locating = positions.filter((p) => p.loading).length;

  // Stops we could place on the map, in a nearest-first order from where the rider is now.
  const { ordered, unplaced } = useMemo(() => {
    const placed: Stop[] = [];
    const missing: Delivery[] = [];
    onRoad.forEach((d, i) => {
      const p = positions[i];
      if (p?.pos) placed.push({ id: d.id, label: d.customer.full_name, pos: p.pos, delivery: d, approximate: p.approximate });
      else if (!p?.loading) missing.push(d);
    });
    return { ordered: nearestNeighbourOrder(device.position, placed), unplaced: missing };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRoad, JSON.stringify(positions), device.position?.lat.toFixed(3), device.position?.lng.toFixed(3)]);

  const waypoints = [...(device.position ? [device.position] : []), ...ordered.map((s) => s.pos)];
  const route = useTripRoute(waypoints);

  // With GPS, leg i leads to stop i. Without it, the first stop has no incoming leg.
  const legOffset = device.position ? 0 : -1;
  const legTo = (i: number) => route.data?.legs[i + legOffset];

  const back = <BackLink to="/rider">Deliveries</BackLink>;

  if (list.isPending) return <LoadingState label="Loading your trip…" />;
  if (list.isError) {
    return (
      <div>
        {back}
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {back}
      <PageHeader
        title="Current trip"
        subtitle={onRoad.length ? `${onRoad.length} stop${onRoad.length === 1 ? "" : "s"} on the road` : "Nothing on the road right now"}
      />

      {onRoad.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="route"
            title="No deliveries in progress"
            hint="Start one or more scheduled deliveries and they'll appear here as a trip."
            action={
              <Link to="/rider" className="btn-primary">
                {waiting.length ? `Start ${waiting.length} ready deliver${waiting.length === 1 ? "y" : "ies"}` : "Back to deliveries"}
              </Link>
            }
          />
        </div>
      ) : (
        <>
          {route.data && (
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-gradient-to-br from-water-600 to-water-700 p-4 text-center text-white shadow-glow">
              <div>
                <p className="tabular text-xl font-bold">{ordered.length}</p>
                <p className="text-[11px] text-water-100">stops</p>
              </div>
              <div>
                <p className="tabular text-xl font-bold">{formatDistance(route.data.distanceM)}</p>
                <p className="text-[11px] text-water-100">by road</p>
              </div>
              <div>
                <p className="tabular text-xl font-bold">{formatDuration(route.data.durationS)}</p>
                <p className="text-[11px] text-water-100">driving</p>
              </div>
            </div>
          )}

          {device.status === "denied" && (
            <Alert kind="info">Location is blocked, so stops can't be ordered from where you are. Allow location for this site to get a nearest-first route.</Alert>
          )}
          {device.status === "unavailable" && (
            <Alert kind="info">Your position isn't available (GPS off, or the page isn't served over HTTPS). Stops are shown without a route from you.</Alert>
          )}
          {locating > 0 && (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner className="h-4 w-4" /> Locating {locating} stop{locating === 1 ? "" : "s"} on the map…
            </p>
          )}
          {route.isError && <p className="text-xs text-amber-700">Route unavailable ({route.error.message}). The stops are still shown.</p>}

          {ordered.length > 0 && (
            <TripMap
              stops={ordered}
              origin={device.position}
              path={route.data?.path ?? null}
              heightClass="h-72"
            />
          )}

          <div>
            <h2 className="mb-2 text-sm font-bold">Suggested order</h2>
            <p className="mb-3 text-xs text-slate-500">Nearest stop first. You can deliver in any order. Each stop is finished on its own.</p>
            <ol className="space-y-3">
              {ordered.map((s, i) => {
                const leg = legTo(i);
                const d = s.delivery;
                const collect = Number(d.amount_to_collect) > 0;
                return (
                  <li key={s.id} className="card overflow-hidden">
                    <div className="flex items-start gap-3 p-4">
                      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-[15px] font-bold text-slate-900">{d.customer.full_name}</p>
                          <OrderStatusBadge status={d.order_status} label={`#${d.id}`} />
                        </div>
                        <p className="mt-1 flex items-start gap-1.5 text-[13px] leading-snug text-slate-600">
                          <Icon name="pin" className="mt-0.5 h-3.5 w-3.5 flex-none text-water-600" /> {d.delivery_address}
                        </p>
                        {s.approximate && <p className="mt-1 text-[11px] text-amber-700">Approximate location (no exact pin)</p>}
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                          {leg && (
                            <span className="flex items-center gap-1">
                              <Icon name="route" className="h-3.5 w-3.5" /> {formatDistance(leg.distanceM)} · {formatDuration(leg.durationS)}
                              {i === 0 && device.position ? " from you" : " from previous stop"}
                            </span>
                          )}
                          {collect ? (
                            <span className="tabular rounded-lg bg-amber-100 px-2 py-0.5 font-bold text-amber-900">Collect {money(d.amount_to_collect)}</span>
                          ) : (
                            <span className="font-semibold text-emerald-700">{d.payment.payment_method === "cod" ? "COD paid" : "Prepaid"}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 border-t border-slate-100 bg-slate-50/60 p-3">
                      <button className="btn-success px-2" onClick={() => setActive({ d, dialog: "deliver" })}>
                        <Icon name="checkCircle" className="h-4 w-4" /> Delivered
                      </button>
                      <button className="btn-secondary px-2 text-red-700" onClick={() => setActive({ d, dialog: "fail" })}>
                        <Icon name="xCircle" className="h-4 w-4" /> Failed
                      </button>
                      <a href={`tel:${d.customer.contact_number}`} className="btn-secondary px-3" aria-label={`Call ${d.customer.full_name}`}>
                        <Icon name="phone" className="h-4 w-4" />
                      </a>
                    </div>
                    <Link to={`/rider/deliveries/${d.id}`} className="block border-t border-slate-100 py-2 text-center text-xs font-semibold text-water-700 hover:bg-water-50/50">
                      Open order details
                    </Link>
                  </li>
                );
              })}
            </ol>
          </div>

          {unplaced.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-bold">Couldn't be placed on the map</h2>
              <ul className="space-y-3">
                {unplaced.map((d) => (
                  <li key={d.id} className="card flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{d.customer.full_name} · #{d.id}</p>
                      <p className="text-xs text-slate-500">{d.delivery_address}</p>
                    </div>
                    <div className="flex flex-none gap-2">
                      <button className="btn-success btn-sm" onClick={() => setActive({ d, dialog: "deliver" })}>Delivered</button>
                      <button className="btn-secondary btn-sm text-red-700" onClick={() => setActive({ d, dialog: "fail" })}>Failed</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {waiting.length > 0 && (
            <Link to="/rider" className="btn-secondary w-full">
              <Icon name="plus" className="h-4 w-4" /> {waiting.length} more ready to start
            </Link>
          )}
        </>
      )}

      {active && <ActionDialogs d={active.d} dialog={active.dialog} onClose={() => setActive(null)} />}
    </div>
  );
}
