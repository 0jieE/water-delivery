import { useState } from "react";
import { formatDate, formatDateTime, money } from "@/lib/format";
import type { Order, OrderItem, Payment, TimelineEntry } from "@/lib/types";
import { Card, DefinitionList, EmptyState, Modal, OrderStatusBadge, PaymentStatusBadge } from "./ui";

export function OrderItemsTable({ items, total }: { items: OrderItem[]; total: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-3 font-semibold">Service</th>
            <th className="px-3 py-2 text-right font-semibold">Qty</th>
            <th className="px-3 py-2 text-right font-semibold">Unit price</th>
            <th className="py-2 pl-3 text-right font-semibold">Subtotal</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((i) => (
            <tr key={i.id}>
              <td className="py-2 pr-3">{i.service_name}</td>
              <td className="px-3 py-2 text-right">{i.quantity}</td>
              <td className="px-3 py-2 text-right">{money(i.unit_price)}</td>
              <td className="py-2 pl-3 text-right">{money(i.subtotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-200 font-semibold">
            <td className="py-2 pr-3" colSpan={3}>
              Total
            </td>
            <td className="py-2 pl-3 text-right text-water-800">{money(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Click-to-enlarge payment proof. The URL is absolute and needs no auth header (API.md §1). */
export function ProofImage({ src, className = "h-40" }: { src: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative block overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
        aria-label="View payment proof full size"
      >
        <img src={src} alt="Proof of payment" className={`w-full object-contain ${className}`} loading="lazy" />
        <span className="absolute inset-x-0 bottom-0 bg-slate-900/60 py-1 text-center text-xs text-white opacity-0 transition group-hover:opacity-100">
          Click to enlarge
        </span>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Proof of payment" size="xl">
        <img src={src} alt="Proof of payment" className="mx-auto max-h-[70vh] w-auto max-w-full rounded" />
      </Modal>
    </>
  );
}

export function PaymentSummary({ payment, showProof = true }: { payment: Payment; showProof?: boolean }) {
  return (
    <div className="space-y-3">
      <DefinitionList
        items={[
          ["Method", payment.payment_method_display],
          ["Status", <PaymentStatusBadge key="s" status={payment.payment_status} label={payment.payment_status_display} />],
          ["Amount", money(payment.amount)],
          ["Paid on", payment.payment_date ? formatDateTime(payment.payment_date) : "—"],
          ...(payment.reference_number ? ([["Reference no.", payment.reference_number]] as [string, string][]) : []),
          ...(payment.verified_by ? ([["Verified by", payment.verified_by.full_name]] as [string, string][]) : []),
          // Staff/admin only: where the cash from a paid COD order is now.
          ...(payment.payment_method === "cod" && payment.payment_status === "paid" && payment.remittance !== undefined
            ? ([["Cash", payment.remittance ? `Handed in ${formatDateTime(payment.remitted_at)}` : "Still with the rider"]] as [string, string][])
            : []),
        ]}
      />
      {payment.remarks && payment.payment_status === "rejected" && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <span className="font-medium">Payment rejected:</span> {payment.remarks}
        </p>
      )}
      {showProof && payment.proof_image && <ProofImage src={payment.proof_image} />}
    </div>
  );
}

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) return <EmptyState title="No activity yet" />;
  return (
    <ol className="relative space-y-5 border-l-2 border-water-100 pl-5">
      {entries.map((e, idx) => {
        const latest = idx === entries.length - 1;
        return (
          <li key={e.id} className="relative">
            <span
              className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 ${
                latest ? "border-water-600 bg-water-600" : "border-water-300 bg-white"
              }`}
              aria-hidden
            />
            <div className="flex flex-wrap items-center gap-2">
              <OrderStatusBadge status={e.to_status} label={e.to_status_display} />
              <span className="text-xs text-slate-500">{formatDateTime(e.created_at)}</span>
            </div>
            {e.remarks && <p className="mt-1 text-sm text-slate-700">{e.remarks}</p>}
            {e.changed_by && (
              <p className="mt-0.5 text-xs text-slate-500">
                by {e.changed_by.full_name} ({e.changed_by.role})
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function TimelineCard({ entries, loading }: { entries?: TimelineEntry[]; loading: boolean }) {
  return (
    <Card title="Order tracking">
      {loading ? (
        <p className="text-sm text-slate-500">Loading timeline…</p>
      ) : (
        <Timeline entries={entries ?? []} />
      )}
    </Card>
  );
}

export function DeliveryInfo({ order, showCustomer = false }: { order: Order; showCustomer?: boolean }) {
  return (
    <DefinitionList
      items={[
        ...(showCustomer
          ? ([
              ["Customer", order.customer.full_name],
              ["Contact", order.customer.contact_number],
            ] as [string, string][])
          : []),
        ["Delivery date", formatDate(order.delivery_date)],
        ["Delivery address", order.delivery_address],
        ["Placed", formatDateTime(order.order_date)],
        [
          "Rider",
          order.rider ? `${order.rider.full_name} · ${order.rider.vehicle_type}` : "Not assigned yet",
        ],
        ...(order.notes ? ([["Notes", order.notes]] as [string, string][]) : []),
      ]}
    />
  );
}
