import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ErrorBoundary from "@/components/ErrorBoundary";
import Icon from "@/components/Icon";
import { Avatar, Card, EmptyState, ErrorState, LoadingState, OrderStatusBadge, PageHeader, StatCard } from "@/components/ui";
import { StatTile, type SparkPoint } from "@/components/charts";
import { api, errorMessage } from "@/lib/api";
import { ORDER_STATUSES, ORDER_STATUS_LABEL, addDays, formatDate, formatLongDate, money, parseISODate, todayISO } from "@/lib/format";
import { useDashboard, useOrders } from "@/lib/queries";
import type { OrderStatus, Report } from "@/lib/types";
import { useBase } from "./useBase";

/** Bar colours for the "today" breakdown (matches the status badges). */
const BAR: Record<OrderStatus, string> = {
  pending: "bg-amber-400",
  confirmed: "bg-sky-400",
  scheduled: "bg-indigo-400",
  out_for_delivery: "bg-water-500",
  delivered: "bg-emerald-500",
  cancelled: "bg-slate-300",
  rejected: "bg-red-400",
  failed: "bg-orange-400",
};

/** Sales for the last 14 days, split into the latest 7 and the 7 before it (admin only). */
function SalesTile() {
  const sales = useQuery({
    queryKey: ["reports", "dashboard-sales"],
    queryFn: async () =>
      (await api.get<Report>("/reports/sales/daily/", { params: { date_from: addDays(todayISO(), -13), date_to: todayISO() } })).data,
    staleTime: 60_000,
  });
  if (sales.isPending) return <div className="card h-[118px] animate-pulse bg-slate-100/60" aria-hidden />;
  if (sales.isError) return null; // the dashboard still works without it

  const rows = sales.data.rows;
  const points: SparkPoint[] = rows.map((r, i) => ({
    label: parseISODate(String(r.period)).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" }),
    value: Number(r.total_sales),
    current: i >= rows.length - 7,
  }));
  const cur = points.filter((p) => p.current).reduce((n, p) => n + p.value, 0);
  const prev = points.filter((p) => !p.current).reduce((n, p) => n + p.value, 0);
  const pct = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;

  return (
    <StatTile
      label="Sales · last 7 days"
      value={money(cur)}
      delta={pct === null ? undefined : `${pct >= 0 ? "+" : ""}${pct}%`}
      deltaGood={cur >= prev}
      deltaNote={`vs ${money(prev)} the 7 days before`}
      points={points}
      format={money}
      icon={<Icon name="chart" className="h-4 w-4 text-slate-400" />}
    />
  );
}

export default function DashboardPage() {
  const base = useBase();
  const dash = useDashboard();
  const pending = useOrders({ status: "pending", ordering: "order_date", page_size: 6 });

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={dash.data ? `${formatLongDate(dash.data.date)} · refreshes every 15 seconds` : "Refreshes every 15 seconds"}
      />

      {dash.isPending ? (
        <LoadingState />
      ) : dash.isError ? (
        <ErrorState message={errorMessage(dash.error)} onRetry={() => dash.refetch()} />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 lg:gap-4">
            <StatCard label="Orders to confirm" value={dash.data.pending_orders} icon="list" tone="amber" to={`${base}/orders?status=pending`} />
            <StatCard label="Payments to verify" value={dash.data.pending_payments} icon="card" tone="amber" to={`${base}/payments`} />
            <StatCard
              label="Need a rider"
              value={dash.data.needs_rider}
              icon="truck"
              tone={dash.data.needs_rider > 0 ? "red" : "green"}
              to={`${base}/schedule`}
            />
            <StatCard
              label="Riders available"
              value={dash.data.available_riders}
              icon="users"
              tone="green"
              to={base === "/admin" ? "/admin/riders" : `${base}/schedule`}
            />
            <StatCard
              label="Cash with riders"
              value={money(dash.data.cash_outstanding)}
              icon="coin"
              tone={Number(dash.data.cash_outstanding) > 0 ? "amber" : "green"}
              to={`${base}/cash`}
            />
          </div>

          {base === "/admin" && (
            <ErrorBoundary fallback={null}>
              <SalesTile />
            </ErrorBoundary>
          )}

          <Card title={`Today's deliveries · ${dash.data.today_total} order${dash.data.today_total === 1 ? "" : "s"}`}>
            {dash.data.today_total > 0 && (
              <div className="mb-5 flex h-2.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Today's orders by status">
                {ORDER_STATUSES.filter((s) => dash.data.today_by_status[s] > 0).map((s) => (
                  <div
                    key={s}
                    className={`${BAR[s]} transition-all`}
                    style={{ width: `${(dash.data.today_by_status[s] / dash.data.today_total) * 100}%` }}
                    title={`${ORDER_STATUS_LABEL[s]}: ${dash.data.today_by_status[s]}`}
                  />
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {ORDER_STATUSES.map((s) => (
                <Link
                  key={s}
                  to={`${base}/orders?status=${s}&delivery_date=${dash.data.date}`}
                  className="group rounded-xl border border-slate-200/80 p-3 transition hover:border-water-200 hover:bg-water-50/40"
                >
                  <OrderStatusBadge status={s} label={ORDER_STATUS_LABEL[s]} />
                  <p className="tabular mt-2.5 text-2xl font-bold text-slate-900">{dash.data.today_by_status[s] ?? 0}</p>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      )}

      <div className="mt-5">
        <Card
          title="Waiting for confirmation"
          actions={
            <Link to={`${base}/orders?status=pending`} className="text-xs font-semibold text-water-700 hover:underline">
              View all
            </Link>
          }
        >
          {pending.isPending ? (
            <LoadingState compact />
          ) : pending.isError ? (
            <ErrorState message={errorMessage(pending.error)} onRetry={() => pending.refetch()} />
          ) : pending.data.results.length === 0 ? (
            <EmptyState icon="checkCircle" title="Nothing waiting" hint="New orders will appear here." />
          ) : (
            <ul className="-my-2 divide-y divide-slate-100">
              {pending.data.results.map((o) => (
                <li key={o.id}>
                  <Link
                    to={`${base}/orders/${o.id}`}
                    className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-3 transition hover:bg-slate-50"
                  >
                    <Avatar name={o.customer.full_name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        #{o.id} · {o.customer.full_name}
                      </p>
                      <p className="text-xs text-slate-500">
                        Deliver {formatDate(o.delivery_date)} · {o.items.length} item{o.items.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span className="tabular text-sm font-bold text-water-800">{money(o.total_amount)}</span>
                    <Icon name="chevronRight" className="h-4 w-4 text-slate-300" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

