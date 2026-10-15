import { Link } from "react-router-dom";
import Icon from "@/components/Icon";
import { Card, EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { formatDateTime, money } from "@/lib/format";
import { useMyCash } from "./api";

/** The rider's own view: how much cash they are carrying and what they've already handed in. */
export default function CashPage() {
  const cash = useMyCash();

  return (
    <div className="space-y-5">
      <PageHeader title="Cash on hand" subtitle="Cash you collected on cash-on-delivery orders" />

      {cash.isPending ? (
        <LoadingState />
      ) : cash.isError ? (
        <ErrorState message={errorMessage(cash.error)} onRetry={() => cash.refetch()} />
      ) : (
        <>
          <div
            className={`rounded-3xl p-5 text-white shadow-lift ${
              Number(cash.data.amount_held) > 0 ? "bg-gradient-to-br from-amber-500 to-orange-600" : "bg-gradient-to-br from-emerald-500 to-emerald-700"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-white/80">You are holding</p>
            <p className="tabular mt-1 text-4xl font-extrabold tracking-tight">{money(cash.data.amount_held)}</p>
            <p className="mt-2 text-sm text-white/90">
              {Number(cash.data.amount_held) > 0
                ? "Hand this to the station staff. They'll confirm it here."
                : "Nothing to hand in. You're all settled."}
            </p>
          </div>

          <Card title={`Orders to hand in (${cash.data.orders.length})`}>
            {cash.data.orders.length === 0 ? (
              <p className="py-2 text-center text-sm text-slate-500">No cash from deliveries yet.</p>
            ) : (
              <ul className="-my-2 divide-y divide-slate-100">
                {cash.data.orders.map((o) => (
                  <li key={o.order_id} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <Link to={`/rider/deliveries/${o.order_id}`} className="text-sm font-semibold text-water-700">Order #{o.order_id}</Link>
                      <p className="text-xs text-slate-400">{formatDateTime(o.collected_at)}</p>
                    </div>
                    <span className="tabular text-[15px] font-bold text-slate-900">{money(o.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Recent hand-ins">
            {cash.data.recent_remittances.length === 0 ? (
              <EmptyState icon="coin" title="No hand-ins yet" hint="When staff confirm your cash, it will be listed here." />
            ) : (
              <ul className="-my-2 divide-y divide-slate-100">
                {cash.data.recent_remittances.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-3">
                    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                      <Icon name="check" className="h-4 w-4" strokeWidth={2.5} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="tabular text-sm font-bold text-slate-900">{money(r.amount)}</p>
                      <p className="text-xs text-slate-500">{formatDateTime(r.received_at)} · received by {r.received_by}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
