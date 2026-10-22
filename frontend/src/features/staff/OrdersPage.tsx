import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Icon from "@/components/Icon";
import {
  Avatar,
  EmptyState,
  ErrorState,
  LoadingState,
  OrderStatusBadge,
  PageHeader,
  Pagination,
  PaymentStatusBadge,
} from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { ORDER_STATUSES, ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL, formatDate, money } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { useOrders } from "@/lib/queries";
import { useBase } from "./useBase";

const PAGE_SIZE = 20;
const PAYMENT_STATUSES = Object.keys(PAYMENT_STATUS_LABEL) as (keyof typeof PAYMENT_STATUS_LABEL)[];

const ORDERINGS: { value: string; label: string }[] = [
  { value: "-order_date", label: "Newest first" },
  { value: "order_date", label: "Oldest first" },
  { value: "delivery_date", label: "Delivery date ↑" },
  { value: "-delivery_date", label: "Delivery date ↓" },
  { value: "-total_amount", label: "Highest total" },
  { value: "total_amount", label: "Lowest total" },
];

export default function OrdersPage() {
  const base = useBase();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const get = (k: string) => params.get(k) ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);

  const [search, setSearch] = useState(get("search"));
  const debouncedSearch = useDebounced(search);

  function update(next: Record<string, string | undefined>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) (v ? p.set(k, v) : p.delete(k));
    if (!("page" in next)) p.delete("page");
    setParams(p, { replace: true });
  }

  // Push the debounced search term into the URL (and so into the query).
  useEffect(() => {
    if (debouncedSearch.trim() !== get("search")) update({ search: debouncedSearch.trim() || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const query = {
    status: get("status"),
    search: get("search"),
    date_from: get("date_from"),
    date_to: get("date_to"),
    delivery_date: get("delivery_date"),
    payment_status: get("payment_status"),
    ordering: get("ordering") || "-order_date",
    page,
    page_size: PAGE_SIZE,
  };
  const orders = useOrders(query);
  const filtered = ["status", "search", "date_from", "date_to", "delivery_date", "payment_status"].some((k) => get(k));
  const activeFilters = ["status", "date_from", "date_to", "delivery_date", "payment_status"].filter((k) => get(k)).length;
  const [showFilters, setShowFilters] = useState(activeFilters > 0);

  return (
    <div>
      <PageHeader title="Orders" subtitle="All customer orders · live updates every 15 seconds" />

      <div className="card mb-5 p-4">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
            <input
              id="q"
              className="input pl-10"
              placeholder="Search orders…"
              aria-label="Search orders"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {/* Small screens: filters live behind a toggle so the orders stay in view. */}
          <button
            type="button"
            className="btn-secondary relative lg:hidden"
            onClick={() => setShowFilters((s) => !s)}
            aria-expanded={showFilters}
          >
            <Icon name="list" className="h-4 w-4" /> Filters
            {activeFilters > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-water-600 px-1 text-[11px] font-bold text-white">
                {activeFilters}
              </span>
            )}
          </button>
        </div>
        <div className={`mt-4 gap-3 sm:grid-cols-2 lg:grid-cols-4 ${showFilters ? "grid" : "hidden lg:grid"}`}>
          <div>
            <label className="label" htmlFor="status">Status</label>
            <select id="status" className="input" value={get("status")} onChange={(e) => update({ status: e.target.value || undefined })}>
              <option value="">All statuses</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="pay">Payment</label>
            <select id="pay" className="input" value={get("payment_status")} onChange={(e) => update({ payment_status: e.target.value || undefined })}>
              <option value="">Any payment status</option>
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>{PAYMENT_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="dd">Delivery date</label>
            <input id="dd" type="date" className="input" value={get("delivery_date")} onChange={(e) => update({ delivery_date: e.target.value || undefined })} />
          </div>
          <div>
            <label className="label" htmlFor="ord">Sort by</label>
            <select id="ord" className="input" value={query.ordering} onChange={(e) => update({ ordering: e.target.value === "-order_date" ? undefined : e.target.value })}>
              {ORDERINGS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="from">Placed from</label>
            <input id="from" type="date" className="input" value={get("date_from")} max={get("date_to") || undefined} onChange={(e) => update({ date_from: e.target.value || undefined })} />
          </div>
          <div>
            <label className="label" htmlFor="to">Placed to</label>
            <input id="to" type="date" className="input" value={get("date_to")} min={get("date_from") || undefined} onChange={(e) => update({ date_to: e.target.value || undefined })} />
          </div>
          {filtered && (
            <div className="flex items-end">
              <button
                className="btn-ghost"
                onClick={() => {
                  setSearch("");
                  setParams({}, { replace: true });
                }}
              >
                <Icon name="x" className="h-4 w-4" /> Clear filters
              </button>
            </div>
          )}
        </div>
      </div>

      {orders.isPending ? (
        <LoadingState label="Loading orders…" />
      ) : orders.isError ? (
        <ErrorState message={errorMessage(orders.error)} onRetry={() => orders.refetch()} />
      ) : orders.data.results.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="search"
            title="No orders found"
            hint={filtered ? "Try changing or clearing the filters." : "Orders will appear here once customers place them."}
          />
        </div>
      ) : (
        <>
          {/* Phones and tablets: cards (two columns on a tablet). Large screens: a table. */}
          <ul className={`grid gap-3 md:grid-cols-2 lg:hidden ${orders.isPlaceholderData ? "opacity-60" : ""}`}>
            {orders.data.results.map((o) => (
              <li key={o.id}>
                <Link to={`${base}/orders/${o.id}`} className="card card-hover block p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={o.customer.full_name} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">#{o.id} · {o.customer.full_name}</p>
                        <p className="text-xs text-slate-400">Placed {formatDate(o.order_date)}</p>
                      </div>
                    </div>
                    <OrderStatusBadge status={o.order_status} label={o.order_status_display} />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1.5">
                      <Icon name="calendar" className="h-4 w-4 text-slate-400" /> {formatDate(o.delivery_date)}
                    </span>
                    <span className="flex items-center gap-2">
                      <PaymentStatusBadge status={o.payment.payment_status} label={o.payment.payment_status_display} />
                      <span className="tabular text-sm font-bold text-water-800">{money(o.total_amount)}</span>
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <div className={`table-wrap hidden lg:block ${orders.isPlaceholderData ? "opacity-60" : ""}`}>
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Delivery</th>
                  <th className="text-right">Total</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th>Rider</th>
                </tr>
              </thead>
              <tbody>
                {orders.data.results.map((o) => (
                  <tr key={o.id} className="cursor-pointer" onClick={() => navigate(`${base}/orders/${o.id}`)}>
                    <td>
                      <Link to={`${base}/orders/${o.id}`} className="font-semibold text-water-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                        #{o.id}
                      </Link>
                      <div className="text-xs text-slate-400">{formatDate(o.order_date)}</div>
                    </td>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar name={o.customer.full_name} size="sm" />
                        <div>
                          <div className="font-medium text-slate-900">{o.customer.full_name}</div>
                          <div className="text-xs text-slate-400">{o.customer.contact_number}</div>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap">{formatDate(o.delivery_date)}</td>
                    <td className="tabular text-right font-semibold text-slate-900">{money(o.total_amount)}</td>
                    <td><OrderStatusBadge status={o.order_status} label={o.order_status_display} /></td>
                    <td>
                      <PaymentStatusBadge status={o.payment.payment_status} label={o.payment.payment_status_display} />
                      <div className="mt-1 text-xs text-slate-400">{o.payment.payment_method_display}</div>
                    </td>
                    <td>{o.rider ? o.rider.full_name : <span className="text-slate-300">Unassigned</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} count={orders.data.count} pageSize={PAGE_SIZE} onPage={(p) => update({ page: p > 1 ? String(p) : undefined })} />
        </>
      )}
    </div>
  );
}
