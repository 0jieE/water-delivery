import { Link } from "react-router-dom";
import Icon from "@/components/Icon";
import { OrderStatusBadge } from "@/components/ui";
import { formatDate, money, todayISO } from "@/lib/format";
import type { Delivery } from "@/lib/types";

export default function DeliveryCard({
  d,
  selectMode = false,
  selected = false,
  onToggle,
}: {
  d: Delivery;
  /** When on, tapping a startable (scheduled) delivery ticks it instead of opening it. */
  selectMode?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const collect = Number(d.amount_to_collect) > 0;
  const live = d.order_status === "out_for_delivery";
  const overdue = (d.order_status === "scheduled" || live) && d.delivery_date < todayISO();
  const pickable = selectMode && d.allowed_transitions.includes("out_for_delivery");

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          {selectMode && (
            <span
              className={`mt-1 flex h-6 w-6 flex-none items-center justify-center rounded-md border-2 transition ${
                !pickable
                  ? "border-slate-200 bg-slate-100"
                  : selected
                    ? "border-water-600 bg-water-600 text-white"
                    : "border-slate-300 bg-white"
              }`}
              aria-hidden
            >
              {selected && <Icon name="check" className="h-4 w-4" strokeWidth={3} />}
            </span>
          )}
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Order #{d.id}</p>
            <p className="truncate text-lg font-bold leading-tight text-slate-900">{d.customer.full_name}</p>
          </div>
        </div>
        <OrderStatusBadge status={d.order_status} label={d.order_status_display} />
      </div>

      <p className="mt-3 flex items-start gap-2 text-sm leading-snug text-slate-600">
        <Icon name="pin" className="mt-0.5 h-4 w-4 flex-none text-water-600" />
        {d.delivery_address}
      </p>
      <p className="mt-1.5 flex items-start gap-2 text-[13px] leading-snug text-slate-500">
        <Icon name="box" className="mt-0.5 h-4 w-4 flex-none text-slate-400" />
        {d.items.map((i) => `${i.quantity}× ${i.service_name}`).join(", ")}
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className={`flex items-center gap-1.5 text-xs font-medium ${overdue ? "text-red-600" : "text-slate-500"}`}>
          <Icon name="calendar" className="h-4 w-4" />
          {overdue ? "Overdue · " : ""}
          {formatDate(d.delivery_date)}
        </span>
        {collect ? (
          <span className="tabular rounded-xl bg-amber-100 px-3 py-1.5 text-sm font-bold text-amber-900">
            Collect {money(d.amount_to_collect)}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700">
            <Icon name="checkCircle" className="h-4 w-4" /> {d.payment.payment_method === "cod" ? "COD paid" : "Prepaid"}
          </span>
        )}
      </div>
    </>
  );

  return (
    <article
      className={`card overflow-hidden transition ${live ? "!border-water-300 ring-4 ring-water-100" : ""} ${
        selected ? "!border-water-500 ring-4 ring-water-200" : ""
      } ${selectMode && !pickable ? "opacity-60" : ""}`}
    >
      {live && (
        <div className="flex items-center gap-2 bg-gradient-to-r from-water-600 to-water-500 px-4 py-1.5 text-xs font-semibold text-white">
          <span className="h-2 w-2 animate-pulse rounded-full bg-white" aria-hidden /> In progress
        </div>
      )}
      {selectMode ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          disabled={!pickable}
          onClick={onToggle}
          className="block w-full p-4 text-left transition active:bg-slate-50 disabled:cursor-not-allowed"
        >
          {body}
        </button>
      ) : (
        <>
          <Link to={`/rider/deliveries/${d.id}`} className="block p-4 transition active:bg-slate-50">
            {body}
          </Link>
          <a
            href={`tel:${d.customer.contact_number}`}
            className="flex min-h-12 items-center justify-center gap-2 border-t border-slate-100 bg-slate-50/60 text-sm font-semibold text-water-700 transition active:bg-water-50"
          >
            <Icon name="phone" className="h-4 w-4" />
            Call {d.customer.contact_number}
          </a>
        </>
      )}
    </article>
  );
}
