import { Link, useParams } from "react-router-dom";
import Icon from "@/components/Icon";
import { Alert, Card, ErrorState, LoadingState } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { formatDate, money } from "@/lib/format";
import { useOrder } from "@/lib/queries";
import type { Order } from "@/lib/types";
import { ProofUploadCard } from "./proof";

/** What the customer should do next, based on how they chose to pay. */
function NextStep({ order }: { order: Order }) {
  const p = order.payment;
  if (p.payment_method === "cod") {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <Icon name="truck" className="h-5 w-5" />
          </span>
          <div>
            <p className="font-semibold text-slate-900">Pay the rider in cash</p>
            <p className="mt-0.5 text-sm leading-snug text-slate-500">
              Have <span className="font-semibold text-slate-800">{money(order.total_amount)}</span> ready when your water arrives. Nothing to pay now.
            </p>
          </div>
        </div>
      </Card>
    );
  }
  if (p.payment_status === "pending_verification") {
    return <Alert kind="success">Payment proof received. Our staff will verify it shortly and you'll get a notification.</Alert>;
  }
  if (p.payment_status === "paid") return <Alert kind="success">Payment confirmed. Thank you!</Alert>;
  // Unpaid (e.g. the upload failed at checkout) or rejected: show the QR + upload form right here.
  return <ProofUploadCard order={order} />;
}

export default function OrderPlacedPage() {
  const { id } = useParams();
  const order = useOrder(id);

  if (order.isPending) return <LoadingState label="Loading your order…" />;
  if (order.isError) {
    return (
      <div className="space-y-4">
        <ErrorState message={errorMessage(order.error)} onRetry={() => order.refetch()} />
        <Link to="/customer/orders" className="btn-secondary w-full">View my orders</Link>
      </div>
    );
  }
  const o = order.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center pt-4 text-center">
        <span className="flex h-20 w-20 animate-scale-in items-center justify-center rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600 text-white shadow-[0_12px_30px_-10px_rgb(5_150_105/0.7)] ring-8 ring-emerald-50">
          <Icon name="check" className="h-10 w-10" strokeWidth={3} />
        </span>
        <h1 className="mt-5 text-2xl font-bold tracking-tight">Order placed!</h1>
        <p className="mt-1 text-sm text-slate-500">
          Order <span className="font-semibold text-slate-800">#{o.id}</span> is with our staff. We'll notify you at every step.
        </p>
      </div>

      <NextStep order={o} />

      <Card title="Summary">
        <ul className="-my-1.5 divide-y divide-slate-100 text-sm">
          {o.items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
              <span><span className="font-semibold">{i.quantity}×</span> {i.service_name}</span>
              <span className="tabular text-slate-500">{money(i.subtotal)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3">
          <span className="text-sm text-slate-600">Total</span>
          <span className="tabular text-lg font-bold text-water-800">{money(o.total_amount)}</span>
        </div>
        <dl className="mt-4 space-y-3 border-t border-slate-100 pt-4 text-sm">
          <div className="flex gap-3">
            <Icon name="calendar" className="mt-0.5 h-4 w-4 flex-none text-slate-400" />
            <div>
              <dt className="sr-only">Delivery date</dt>
              <dd className="font-medium text-slate-800">{formatDate(o.delivery_date)}</dd>
            </div>
          </div>
          <div className="flex gap-3">
            <Icon name="pin" className="mt-0.5 h-4 w-4 flex-none text-water-600" />
            <div>
              <dt className="sr-only">Delivery address</dt>
              <dd className="leading-snug text-slate-700">{o.delivery_address}</dd>
            </div>
          </div>
          <div className="flex gap-3">
            <Icon name="card" className="mt-0.5 h-4 w-4 flex-none text-slate-400" />
            <div>
              <dt className="sr-only">Payment</dt>
              <dd className="text-slate-700">{o.payment.payment_method_display}</dd>
            </div>
          </div>
        </dl>
      </Card>

      <div className="grid gap-2 pb-2">
        <Link to={`/customer/orders/${o.id}`} className="btn-primary btn-lg w-full">
          <Icon name="route" className="h-5 w-5" /> Track this order
        </Link>
        <Link to="/customer" className="btn-secondary w-full">
          Order more
        </Link>
      </div>
    </div>
  );
}
