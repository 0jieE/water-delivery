import { Link, useSearchParams } from "react-router-dom";
import Icon from "@/components/Icon";
import { EmptyState, ErrorState, LoadingState, OrderStatusBadge, PageHeader, PaymentStatusBadge, Pagination } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { formatDate, money } from "@/lib/format";
import { useOrders } from "@/lib/queries";

const PAGE_SIZE = 10;

const TABS: { key: string; label: string; status?: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active", status: "pending,confirmed,scheduled,out_for_delivery" },
  { key: "delivered", label: "Delivered", status: "delivered" },
  { key: "closed", label: "Cancelled / failed", status: "cancelled,rejected,failed" },
];

export default function MyOrdersPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.key === params.get("tab")) ?? TABS[0];
  const page = Math.max(1, Number(params.get("page")) || 1);

  const orders = useOrders({ status: tab.status, page, page_size: PAGE_SIZE });

  function update(next: Record<string, string | undefined>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) (v ? p.set(k, v) : p.delete(k));
    setParams(p, { replace: true });
  }

  return (
    <div>
      <PageHeader title="My orders" subtitle="Live updates every 15 seconds" />

      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={t.key === tab.key}
            onClick={() => update({ tab: t.key === "all" ? undefined : t.key, page: undefined })}
            className={`chip ${t.key === tab.key ? "chip-active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {orders.isPending ? (
        <LoadingState label="Loading your orders…" />
      ) : orders.isError ? (
        <ErrorState message={errorMessage(orders.error)} onRetry={() => orders.refetch()} />
      ) : orders.data.results.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="box"
            title="No orders here yet"
            hint={tab.key === "all" ? "Place your first order and it will show up here." : "Nothing matches this filter."}
            action={
              tab.key === "all" ? (
                <Link to="/customer" className="btn-primary">
                  Browse services
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <ul className={`space-y-3 transition-opacity ${orders.isPlaceholderData ? "opacity-60" : ""}`}>
            {orders.data.results.map((o) => (
              <li key={o.id}>
                <Link to={`/customer/orders/${o.id}`} className="card card-hover block p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[15px] font-bold text-slate-900">Order #{o.id}</p>
                      <p className="text-xs text-slate-400">Placed {formatDate(o.order_date)}</p>
                    </div>
                    <OrderStatusBadge status={o.order_status} label={o.order_status_display} />
                  </div>
                  <p className="mt-3 line-clamp-2 text-[13px] leading-snug text-slate-600">
                    {o.items.map((i) => `${i.quantity} × ${i.service_name}`).join(", ")}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                    <span className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Icon name="calendar" className="h-4 w-4 text-slate-400" /> {formatDate(o.delivery_date)}
                    </span>
                    <span className="flex items-center gap-2">
                      <PaymentStatusBadge status={o.payment.payment_status} label={o.payment.payment_status_display} />
                      <span className="tabular text-[15px] font-bold text-water-800">{money(o.total_amount)}</span>
                      <Icon name="chevronRight" className="h-4 w-4 text-slate-300" />
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={page} count={orders.data.count} pageSize={PAGE_SIZE} onPage={(p) => update({ page: p > 1 ? String(p) : undefined })} />
        </>
      )}
    </div>
  );
}
