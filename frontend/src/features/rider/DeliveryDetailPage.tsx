import { useState } from "react";
import { useParams } from "react-router-dom";
import Icon from "@/components/Icon";
import { DeliveryMap } from "@/components/map";
import {
  Alert,
  BackLink,
  Card,
  ErrorState,
  LoadingState,
  Modal,
  OrderStatusBadge,
  Spinner,
  StatusStepper,
  TextAreaField,
} from "@/components/ui";
import { useToast } from "@/components/Toast";
import { errorMessage, fieldErrors, parseApiError } from "@/lib/api";
import { formatDate, money } from "@/lib/format";
import { toPin } from "@/lib/geo";
import type { Delivery } from "@/lib/types";
import { useDelivery, useDeliveryStatus } from "./api";

export type Dialog = null | "deliver" | "fail";

export function ActionDialogs({ d, dialog, onClose }: { d: Delivery; dialog: Dialog; onClose: () => void }) {
  const toast = useToast();
  const update = useDeliveryStatus(d.id);
  const isCod = d.payment.payment_method === "cod";
  const [collected, setCollected] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  function close() {
    setCollected(false);
    setReason("");
    setError("");
    onClose();
  }

  function onApiError(e: unknown) {
    const info = parseApiError(e);
    const fe = fieldErrors(info);
    setError(fe.cod_collected || fe.remarks || errorMessage(e, info));
  }

  function deliver() {
    if (isCod && !collected) {
      setError("Confirm that you collected the cash first.");
      return;
    }
    setError("");
    update.mutate(
      { status: "delivered", ...(isCod ? { cod_collected: true } : {}) },
      {
        onSuccess: () => {
          toast.success(`Order #${d.id} delivered. Great job!`);
          close();
        },
        onError: onApiError,
      }
    );
  }

  function fail() {
    if (!reason.trim()) {
      setError("Tell us why the delivery failed.");
      return;
    }
    setError("");
    update.mutate(
      { status: "failed", remarks: reason.trim() },
      {
        onSuccess: () => {
          toast.success(`Order #${d.id} marked as failed.`);
          close();
        },
        onError: onApiError,
      }
    );
  }

  return (
    <>
      <Modal
        open={dialog === "deliver"}
        onClose={close}
        title="Confirm delivery"
        footer={
          <>
            <button className="btn-secondary" onClick={close} disabled={update.isPending}>
              Back
            </button>
            <button className="btn-success btn-lg" onClick={deliver} disabled={update.isPending}>
              {update.isPending && <Spinner className="h-4 w-4 text-white" />} Mark delivered
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <p className="text-sm text-slate-600">
            Order #{d.id} for <span className="font-medium text-slate-900">{d.customer.full_name}</span> has been handed over.
          </p>
          {isCod && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
              <input type="checkbox" className="mt-1 h-5 w-5" checked={collected} onChange={(e) => setCollected(e.target.checked)} />
              <span>
                <span className="block text-base font-semibold text-amber-900">I collected {money(d.amount_to_collect)} in cash</span>
                <span className="block text-xs text-amber-800">Required for cash-on-delivery orders.</span>
              </span>
            </label>
          )}
        </div>
      </Modal>

      <Modal
        open={dialog === "fail"}
        onClose={close}
        title="Delivery failed"
        footer={
          <>
            <button className="btn-secondary" onClick={close} disabled={update.isPending}>
              Back
            </button>
            <button className="btn-danger btn-lg" onClick={fail} disabled={update.isPending}>
              {update.isPending && <Spinner className="h-4 w-4 text-white" />} Mark failed
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <Alert>{error}</Alert>}
          <TextAreaField
            label="Reason"
            required
            rows={3}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError("");
            }}
            maxLength={500}
            placeholder="e.g. Nobody home, wrong address…"
            autoFocus
          />
        </div>
      </Modal>
    </>
  );
}

export default function DeliveryDetailPage() {
  const { id } = useParams();
  const delivery = useDelivery(id);
  const toast = useToast();
  const start = useDeliveryStatus(Number(id));
  const [dialog, setDialog] = useState<Dialog>(null);

  const back = <BackLink to="/rider">Deliveries</BackLink>;

  if (delivery.isPending) return <LoadingState label="Loading delivery…" />;
  if (delivery.isError) {
    return (
      <div>
        {back}
        <ErrorState
          message={parseApiError(delivery.error).status === 404 ? "This delivery isn't assigned to you." : errorMessage(delivery.error)}
          onRetry={() => delivery.refetch()}
        />
      </div>
    );
  }

  const d = delivery.data;
  const can = (s: string) => (d.allowed_transitions as string[]).includes(s);
  const collect = Number(d.amount_to_collect) > 0;

  function startDelivery() {
    start.mutate(
      { status: "out_for_delivery" },
      {
        onSuccess: () => toast.success("Delivery started. Drive safe!"),
        onError: (e) => toast.error(errorMessage(e)),
      }
    );
  }

  return (
    <div className="space-y-4">
      {back}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Order #{d.id}</p>
          <h1 className="truncate text-2xl font-bold leading-tight tracking-tight">{d.customer.full_name}</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500">
            <Icon name="calendar" className="h-4 w-4" /> Deliver {formatDate(d.delivery_date)}
          </p>
        </div>
        <OrderStatusBadge status={d.order_status} label={d.order_status_display} />
      </div>

      <div className="card p-4">
        <StatusStepper status={d.order_status} />
      </div>

      {(can("out_for_delivery") || can("delivered") || can("failed")) && (
        <div className="space-y-3">
          {can("out_for_delivery") && (
            <button className="btn-primary btn-lg w-full" onClick={startDelivery} disabled={start.isPending}>
              {start.isPending ? <Spinner className="h-5 w-5 text-white" /> : <Icon name="route" className="h-5 w-5" />} Start delivery
            </button>
          )}
          {can("delivered") && (
            <button className="btn-success btn-lg w-full" onClick={() => setDialog("deliver")}>
              <Icon name="checkCircle" className="h-5 w-5" /> Mark as delivered
            </button>
          )}
          {can("failed") && (
            <button className="btn-secondary btn-lg w-full text-red-700" onClick={() => setDialog("fail")}>
              <Icon name="xCircle" className="h-5 w-5" /> Could not deliver
            </button>
          )}
        </div>
      )}

      {collect && (
        <div className="relative overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100 p-4 text-center">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-800">Cash to collect</p>
          <p className="tabular mt-1 text-4xl font-extrabold tracking-tight text-amber-900">{money(d.amount_to_collect)}</p>
        </div>
      )}

      <Card title="Customer & address">
        <p className="text-base font-semibold text-slate-900">{d.customer.full_name}</p>
        <p className="mt-1.5 flex items-start gap-2 text-sm leading-snug text-slate-600">
          <Icon name="pin" className="mt-0.5 h-4 w-4 flex-none text-water-600" />
          {d.delivery_address}
        </p>
        {d.notes && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm leading-snug text-amber-900 ring-1 ring-amber-100">
            <span className="font-semibold">Note:</span> {d.notes}
          </p>
        )}
        <a href={`tel:${d.customer.contact_number}`} className="btn-primary btn-lg mt-4 w-full">
          <Icon name="phone" className="h-5 w-5" /> Call {d.customer.contact_number}
        </a>
      </Card>

      {d.order_status !== "delivered" && d.order_status !== "failed" && (
        <Card title="Route">
          <DeliveryMap address={d.delivery_address} pin={toPin(d.delivery_latitude, d.delivery_longitude)} rider heightClass="h-72" />
        </Card>
      )}

      <Card title="Items">
        <ul className="divide-y divide-slate-100">
          {d.items.map((i) => (
            <li key={i.id} className="flex items-center justify-between py-2.5 text-base">
              <span>
                <span className="font-semibold">{i.quantity}×</span> {i.service_name}
              </span>
              <span className="text-sm text-slate-500">{money(i.subtotal)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-3">
          <span className="text-sm text-slate-600">Order total</span>
          <span className="text-lg font-semibold text-water-800">{money(d.total_amount)}</span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Payment: {d.payment.payment_method_display} · {d.payment.payment_status_display}
        </p>
      </Card>

      <ActionDialogs d={d} dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

