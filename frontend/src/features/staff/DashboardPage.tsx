import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ErrorBoundary from "@/components/ErrorBoundary";
import Icon from "@/components/Icon";
import { ProofImage } from "@/components/order";
import { Avatar, Card, ErrorState, LoadingState, OrderStatusBadge, Skeleton, StatCard } from "@/components/ui";
import { StatTile, type SparkPoint } from "@/components/charts";
import { api, errorMessage } from "@/lib/api";
import { ORDER_STATUSES, ORDER_STATUS_LABEL, addDays, formatDate, formatLongDate, money, parseISODate, todayISO } from "@/lib/format";
import { useSession } from "@/lib/auth";
import { useDashboard, useOrders, usePayments } from "@/lib/queries";
import type { OrderStatus, Report } from "@/lib/types";
import type { Order, PaymentWithSummary } from "@/lib/types";
import OrderQuickActions from "./OrderQuickActions";
import PaymentActions from "./PaymentActions";
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

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const TONES = {
  amber: "bg-amber-50 text-amber-600",
  red: "bg-red-50 text-red-600",
  water: "bg-water-50 text-water-600",
} as const;

/** One "needs you" group: a title with a live count, the first few items, and a link to the full list. */
function Attention({
  title,
  icon,
  tone,
  count,
  to,
  loading,
  children,
}: {
  title: string;
  icon: "list" | "card" | "truck";
  tone: keyof typeof TONES;
  count: number;
  to: string;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="card overflow-hidden" aria-label={title}>
      <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5">
        <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-xl ${TONES[tone]}`}>
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <h2 className="flex-1 text-sm font-bold text-slate-900">{title}</h2>
        <span className="tabular rounded-full bg-slate-900 px-2.5 py-0.5 text-xs font-bold text-white">{count}</span>
      </header>
      <div className="p-4">
        {loading ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">{children}</ul>
        )}
      </div>
      {count > 3 && (
        <Link to={to} className="flex items-center justify-center gap-1 border-t border-slate-100 bg-slate-50/60 py-3 text-xs font-semibold text-water-700 hover:bg-water-50/60">
          See all {count} <Icon name="chevronRight" className="h-3.5 w-3.5" />
        </Link>
      )}
    </section>
  );
}

function OrderRow({ order, base, note }: { order: Order; base: string; note?: ReactNode }) {
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <Link to={`${base}/orders/${order.id}`} className="flex items-center gap-3">
        <Avatar name={order.customer.full_name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">
            #{order.id} · {order.customer.full_name}
          </p>
          <p className="truncate text-xs text-slate-500">
            {note ?? `Deliver ${formatDate(order.delivery_date)} · ${order.items.length} item${order.items.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <span className="tabular text-sm font-bold text-water-800">{money(order.total_amount)}</span>
      </Link>
      <div className="mt-3">
        <OrderQuickActions order={order} />
      </div>
    </li>
  );
}

function PaymentRow({ p, base }: { p: PaymentWithSummary; base: string }) {
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        {p.proof_image ? (
          <div className="w-14 flex-none">
            <ProofImage src={p.proof_image} className="h-14" />
          </div>
        ) : (
          <span className="flex h-14 w-14 flex-none items-center justify-center rounded-xl bg-slate-100 text-slate-400">
            <Icon name="camera" className="h-5 w-5" />
          </span>
        )}
        <Link to={`${base}/orders/${p.order_summary.id}`} className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">
            #{p.order_summary.id} · {p.order_summary.customer_name}
          </p>
          <p className="truncate text-xs text-slate-500">
            {p.payment_method_display}
            {p.reference_number ? ` · ${p.reference_number}` : ""}
          </p>
        </Link>
        <span className="tabular text-sm font-bold text-water-800">{money(p.amount)}</span>
      </div>
      <div className="mt-3">
        <PaymentActions paymentId={p.id} orderId={p.order_summary.id} size="sm" />
      </div>
    </li>
  );
}

export default function DashboardPage() {
  const base = useBase();
  const { user } = useSession();
  const dash = useDashboard();
  const pendingOrders = useOrders({ status: "pending", ordering: "order_date", page_size: 3 });
  const pendingPayments = usePayments({ payment_status: "pending_verification", ordering: "created_at", page_size: 3 });
  // The API has no "no rider" filter, so look at the next few deliveries and keep those still unassigned.
  const toAssign = useOrders({ status: "confirmed,scheduled,failed", ordering: "delivery_date", page_size: 50 });
  const needRider = (toAssign.data?.results ?? []).filter((o) => !o.rider && o.can_assign_rider);

  if (dash.isPending) return <LoadingState />;
  if (dash.isError) return <ErrorState message={errorMessage(dash.error)} onRetry={() => dash.refetch()} />;
  const d = dash.data;
  const attention = d.pending_orders + d.pending_payments + d.needs_rider;
  const first = user?.first_name || user?.username || "";

  return (
    <div className="space-y-5">
      {/* Hero: the day at a glance, and how many things are waiting on you */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-water-900 to-water-700 p-5 text-white shadow-lift sm:p-6">
        <span className="pointer-events-none absolute -right-10 -top-12 h-48 w-48 rounded-full bg-white/5" aria-hidden />
        <span className="pointer-events-none absolute -bottom-16 right-16 h-40 w-40 rounded-full bg-water-400/10" aria-hidden />
        <p className="text-sm font-medium text-water-200">
          {greeting()}, {first}
        </p>
        <h1 className="mt-1 max-w-md text-2xl font-bold leading-tight tracking-tight !text-white sm:text-3xl">
          {attention > 0 ? `${attention} thing${attention === 1 ? "" : "s"} need${attention === 1 ? "s" : ""} your attention` : "You're all caught up"}
        </h1>
        <p className="mt-1 text-sm text-water-200">{formatLongDate(d.date)}</p>
        <div className="mt-5 grid grid-cols-3 gap-2.5 sm:max-w-md">
          {[
            { label: "Today", value: d.today_total },
            { label: "On the road", value: d.today_by_status.out_for_delivery },
            { label: "Delivered", value: d.today_by_status.delivered },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl bg-white/10 px-3 py-2.5 ring-1 ring-white/10 backdrop-blur">
              <p className="tabular text-xl font-bold leading-none">{s.value}</p>
              <p className="mt-1 text-[11px] font-medium text-water-200">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* On tablets and desktops the old at-a-glance cards stay; on a phone the attention list below replaces them */}
      <div className="hidden gap-3 md:grid md:grid-cols-3 lg:gap-4">
        <StatCard label="Orders to confirm" value={d.pending_orders} icon="list" tone="amber" urgent={d.pending_orders > 0} to={`${base}/orders?status=pending`} />
        <StatCard label="Payments to verify" value={d.pending_payments} icon="card" tone="water" urgent={d.pending_payments > 0} to={`${base}/payments`} />
        <StatCard label="Need a rider" value={d.needs_rider} icon="truck" tone={d.needs_rider > 0 ? "red" : "green"} urgent={d.needs_rider > 0} to={`${base}/schedule`} />
        <StatCard label="Riders available" value={d.available_riders} icon="users" tone="green" to={base === "/admin" ? "/admin/riders" : `${base}/schedule`} />
        {/* Money needs more room than a count, so it gets a double-width tile */}
        <div className="md:col-span-2">
          <StatCard
            label="Cash with riders"
            value={money(d.cash_outstanding)}
            icon="coin"
            tone={Number(d.cash_outstanding) > 0 ? "amber" : "green"}
            urgent={Number(d.cash_outstanding) > 0}
            hint={Number(d.cash_outstanding) > 0 ? "Waiting to be handed in" : undefined}
            to={`${base}/cash`}
          />
        </div>
      </div>

      {/* Needs your attention: act without leaving the home screen */}
      {attention === 0 ? (
        <div className="card flex items-center gap-4 p-5">
          <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/60">
            <Icon name="checkCircle" className="h-6 w-6" />
          </span>
          <div>
            <p className="font-semibold text-slate-900">Nothing is waiting on you</p>
            <p className="text-sm text-slate-500">New orders and payments will show up here the moment they arrive.</p>
          </div>
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {d.pending_orders > 0 && (
            <Attention title="Orders to confirm" icon="list" tone="amber" count={d.pending_orders} to={`${base}/orders?status=pending`} loading={pendingOrders.isPending}>
              {(pendingOrders.data?.results ?? []).map((o) => (
                <OrderRow key={o.id} order={o} base={base} />
              ))}
            </Attention>
          )}
          {d.pending_payments > 0 && (
            <Attention title="Payments to verify" icon="card" tone="water" count={d.pending_payments} to={`${base}/payments`} loading={pendingPayments.isPending}>
              {(pendingPayments.data?.results ?? []).map((p) => (
                <PaymentRow key={p.id} p={p} base={base} />
              ))}
            </Attention>
          )}
          {d.needs_rider > 0 && (
            <Attention title="Deliveries without a rider" icon="truck" tone="red" count={d.needs_rider} to={`${base}/schedule`} loading={toAssign.isPending}>
              {needRider.slice(0, 3).map((o) => (
                <OrderRow
                  key={o.id}
                  order={o}
                  base={base}
                  note={
                    <>
                      Deliver {formatDate(o.delivery_date)} · <span className="font-semibold text-red-600">no rider yet</span>
                    </>
                  }
                />
              ))}
            </Attention>
          )}
        </div>
      )}

      {/* Today's deliveries */}
      <Card title={`Today's deliveries · ${d.today_total} order${d.today_total === 1 ? "" : "s"}`}>
        {d.today_total > 0 && (
          <div className="mb-5 flex h-2.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Today's orders by status">
            {ORDER_STATUSES.filter((s) => d.today_by_status[s] > 0).map((s) => (
              <div
                key={s}
                className={`${BAR[s]} transition-all`}
                style={{ width: `${(d.today_by_status[s] / d.today_total) * 100}%` }}
                title={`${ORDER_STATUS_LABEL[s]}: ${d.today_by_status[s]}`}
              />
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ORDER_STATUSES.map((s) => (
            <Link
              key={s}
              to={`${base}/orders?status=${s}&delivery_date=${d.date}`}
              className="rounded-xl border border-slate-200/80 p-3 transition hover:border-water-200 hover:bg-water-50/40 active:bg-water-50"
            >
              <OrderStatusBadge status={s} label={ORDER_STATUS_LABEL[s]} />
              <p className="tabular mt-2.5 text-2xl font-bold text-slate-900">{d.today_by_status[s] ?? 0}</p>
            </Link>
          ))}
        </div>
      </Card>

      {base === "/admin" && (
        <ErrorBoundary fallback={null}>
          <SalesTile />
        </ErrorBoundary>
      )}

      {/* Phone: cash and quick links, which the tab bar has no room for */}
      <div className="grid grid-cols-2 gap-3 md:hidden">
        <Link to={`${base}/cash`} className="card card-hover p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <Icon name="coin" className="h-5 w-5" />
          </span>
          <p className="tabular mt-3 text-xl font-bold text-slate-900">{money(d.cash_outstanding)}</p>
          <p className="text-xs font-medium text-slate-500">Cash with riders</p>
        </Link>
        <Link to={base === "/admin" ? "/admin/riders" : `${base}/schedule`} className="card card-hover p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <Icon name="users" className="h-5 w-5" />
          </span>
          <p className="tabular mt-3 text-xl font-bold text-slate-900">{d.available_riders}</p>
          <p className="text-xs font-medium text-slate-500">Riders available</p>
        </Link>
      </div>
    </div>
  );
}