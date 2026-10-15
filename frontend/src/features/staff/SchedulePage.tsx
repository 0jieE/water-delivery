import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Icon from "@/components/Icon";
import { Alert, EmptyState, ErrorState, LoadingState, OrderStatusBadge, PageHeader } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { addDays, formatLongDate, todayISO } from "@/lib/format";
import { useOrders } from "@/lib/queries";
import type { Order } from "@/lib/types";
import { AssignRiderModal } from "./orderModals";
import { useBase } from "./useBase";

const BOARD_STATUSES = "confirmed,scheduled,out_for_delivery";
const MAX_DAYS = 31;

/** Every date from `from` to `to` inclusive (capped), so empty days still show on the board. */
function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to && days.length < MAX_DAYS; d = addDays(d, 1)) days.push(d);
  return days;
}

export default function SchedulePage() {
  const base = useBase();
  const [params, setParams] = useSearchParams();
  const today = todayISO();
  const from = params.get("from") || today;
  const to = params.get("to") || addDays(from, 6);
  const rangeOk = from <= to;
  const [assigning, setAssigning] = useState<Order | null>(null);

  const orders = useOrders(
    {
      status: BOARD_STATUSES,
      delivery_date_from: from,
      delivery_date_to: to,
      ordering: "delivery_date",
      page_size: 100,
    },
    { poll: true }
  );

  const days = useMemo(() => (rangeOk ? eachDay(from, to) : []), [from, to, rangeOk]);
  const byDay = useMemo(() => {
    const map = new Map<string, Order[]>();
    for (const o of orders.data?.results ?? []) {
      map.set(o.delivery_date, [...(map.get(o.delivery_date) ?? []), o]);
    }
    return map;
  }, [orders.data]);

  function setRange(next: { from?: string; to?: string }) {
    const p = new URLSearchParams(params);
    const f = next.from ?? from;
    let t = next.to ?? to;
    if (next.from && t < f) t = addDays(f, 6); // keep the range valid when "from" jumps past "to"
    p.set("from", f);
    p.set("to", t);
    setParams(p, { replace: true });
  }

  return (
    <div>
      <PageHeader
        title="Delivery schedule"
        subtitle="Confirmed, scheduled and in-progress orders grouped by delivery date."
        actions={
          <>
            <button className="btn-secondary btn-sm" onClick={() => setParams({}, { replace: true })}>
              This week
            </button>
          </>
        }
      />

      <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="label" htmlFor="from">From</label>
          <input id="from" type="date" className="input" value={from} onChange={(e) => e.target.value && setRange({ from: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="to">To</label>
          <input id="to" type="date" className="input" value={to} min={from} onChange={(e) => e.target.value && setRange({ to: e.target.value })} />
        </div>
        <p className="pb-2 text-xs text-slate-500">Showing up to {MAX_DAYS} days.</p>
      </div>

      {!rangeOk ? (
        <Alert>The start date must be on or before the end date.</Alert>
      ) : orders.isPending ? (
        <LoadingState label="Loading schedule…" />
      ) : orders.isError ? (
        <ErrorState message={errorMessage(orders.error)} onRetry={() => orders.refetch()} />
      ) : (
        <div className="space-y-5">
          {orders.data.count > orders.data.results.length && (
            <Alert kind="info">Showing the first {orders.data.results.length} of {orders.data.count} orders in this range. Narrow the dates to see the rest.</Alert>
          )}
          {orders.data.count === 0 && (
            <div className="card">
              <EmptyState title="No deliveries in this range" hint="Confirm an order and schedule it to see it here." />
            </div>
          )}
          {orders.data.count > 0 &&
            days.map((day) => {
              const list = byDay.get(day) ?? [];
              return (
                <section key={day}>
                  <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                    {formatLongDate(day)}
                    {day === today && <span className="rounded-full bg-water-600 px-2 py-0.5 text-[11px] text-white">Today</span>}
                    <span className="text-xs font-normal text-slate-500">
                      {list.length} order{list.length === 1 ? "" : "s"}
                    </span>
                  </h2>
                  {list.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-400">No deliveries</p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {list.map((o) => (
                        <article key={o.id} className="card p-3">
                          <div className="flex items-start justify-between gap-2">
                            <Link to={`${base}/orders/${o.id}`} className="font-semibold text-water-700 hover:underline">
                              Order #{o.id}
                            </Link>
                            <OrderStatusBadge status={o.order_status} label={o.order_status_display} />
                          </div>
                          <p className="mt-1 text-sm font-medium">{o.customer.full_name}</p>
                          <p className="line-clamp-2 text-xs text-slate-500">{o.delivery_address}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {o.items.map((i) => `${i.quantity}× ${i.service_name}`).join(", ")}
                          </p>
                          <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
                            {o.rider ? (
                              <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                                <Icon name="truck" className="h-4 w-4 text-water-600" /> {o.rider.full_name}
                              </span>
                            ) : (
                              <span className="text-xs font-medium text-red-600">No rider yet</span>
                            )}
                            {o.can_assign_rider && (
                              <button className="btn-secondary btn-sm" onClick={() => setAssigning(o)}>
                                {o.rider ? "Change" : "Assign rider"}
                              </button>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
        </div>
      )}

      {assigning && <AssignRiderModal order={assigning} open onClose={() => setAssigning(null)} />}
    </div>
  );
}
