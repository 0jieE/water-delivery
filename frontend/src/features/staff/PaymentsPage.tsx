import { Link, useSearchParams } from "react-router-dom";
import { ProofImage } from "@/components/order";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Pagination,
  PaymentStatusBadge,
} from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { formatDateTime, money } from "@/lib/format";
import { usePayments } from "@/lib/queries";
import PaymentActions from "./PaymentActions";
import { useBase } from "./useBase";

const PAGE_SIZE = 12;

const TABS: { key: string; label: string; status?: string }[] = [
  { key: "pending", label: "To verify", status: "pending_verification" },
  { key: "paid", label: "Paid", status: "paid" },
  { key: "rejected", label: "Rejected", status: "rejected" },
  { key: "unpaid", label: "Unpaid", status: "unpaid" },
  { key: "all", label: "All transactions" },
];

export default function PaymentsPage() {
  const base = useBase();
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.key === params.get("tab")) ?? TABS[0];
  const page = Math.max(1, Number(params.get("page")) || 1);
  const queue = tab.key === "pending";

  const payments = usePayments({
    payment_status: tab.status,
    // The verification queue works oldest-first; history views show the latest first.
    ordering: queue ? "created_at" : "-created_at",
    page,
    page_size: PAGE_SIZE,
  });

  function update(next: Record<string, string | undefined>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) (v ? p.set(k, v) : p.delete(k));
    setParams(p, { replace: true });
  }

  return (
    <div>
      <PageHeader title="Payments" subtitle="Verify online payments and monitor transactions. Updates every 15 seconds." />

      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={t.key === tab.key}
            onClick={() => update({ tab: t.key === "pending" ? undefined : t.key, page: undefined })}
            className={`chip ${t.key === tab.key ? "chip-active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {payments.isPending ? (
        <LoadingState label="Loading payments…" />
      ) : payments.isError ? (
        <ErrorState message={errorMessage(payments.error)} onRetry={() => payments.refetch()} />
      ) : payments.data.results.length === 0 ? (
        <div className="card">
          <EmptyState
            title={queue ? "No payments waiting for verification" : "No payments here"}
            hint={queue ? "When a customer uploads a proof of payment it will show up here." : undefined}
          />
        </div>
      ) : (
        <>
          <div className={`grid gap-4 md:grid-cols-2 xl:grid-cols-3 ${payments.isPlaceholderData ? "opacity-60" : ""}`}>
            {payments.data.results.map((p) => (
              <article key={p.id} className="card flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link to={`${base}/orders/${p.order_summary.id}`} className="font-semibold text-water-700 hover:underline">
                      Order #{p.order_summary.id}
                    </Link>
                    <p className="text-sm text-slate-700">{p.order_summary.customer_name}</p>
                  </div>
                  <PaymentStatusBadge status={p.payment_status} label={p.payment_status_display} />
                </div>

                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-slate-500">Amount</dt>
                  <dd className="text-right font-semibold text-water-800">{money(p.amount)}</dd>
                  <dt className="text-slate-500">Method</dt>
                  <dd className="text-right">{p.payment_method_display}</dd>
                  {p.reference_number && (
                    <>
                      <dt className="text-slate-500">Reference</dt>
                      <dd className="break-all text-right font-mono text-xs">{p.reference_number}</dd>
                    </>
                  )}
                  <dt className="text-slate-500">Created</dt>
                  <dd className="text-right text-xs">{formatDateTime(p.created_at)}</dd>
                  {p.verified_by && (
                    <>
                      <dt className="text-slate-500">Verified by</dt>
                      <dd className="text-right text-xs">{p.verified_by.full_name}</dd>
                    </>
                  )}
                </dl>

                {p.payment_status === "rejected" && p.remarks && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">Rejected: {p.remarks}</p>
                )}

                {p.proof_image ? (
                  <ProofImage src={p.proof_image} className="h-48" />
                ) : p.payment_method !== "cod" ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
                    No proof uploaded yet
                  </p>
                ) : (
                  <p className="text-xs text-slate-400">Cash on delivery: collected by the rider.</p>
                )}

                {p.payment_status === "pending_verification" && (
                  <div className="mt-auto border-t border-slate-100 pt-3">
                    <PaymentActions paymentId={p.id} orderId={p.order_summary.id} size="sm" />
                  </div>
                )}
              </article>
            ))}
          </div>
          <Pagination page={page} count={payments.data.count} pageSize={PAGE_SIZE} onPage={(n) => update({ page: n > 1 ? String(n) : undefined })} />
        </>
      )}
    </div>
  );
}
