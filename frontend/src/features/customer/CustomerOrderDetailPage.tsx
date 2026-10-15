import { useState } from "react";
import { useParams } from "react-router-dom";
import { DeliveryMap } from "@/components/map";
import {
  Alert,
  BackLink,
  Card,
  ErrorState,
  LoadingState,
  Modal,
  OrderStatusBadge,
  PageHeader,
  Spinner,
  StatusStepper,
  TextAreaField,
} from "@/components/ui";
import { DeliveryInfo, OrderItemsTable, PaymentSummary, TimelineCard } from "@/components/order";
import { useToast } from "@/components/Toast";
import { errorMessage, parseApiError } from "@/lib/api";
import { toPin } from "@/lib/geo";
import { useOrder, useOrderAction, useOrderTimeline } from "@/lib/queries";
import type { Order } from "@/lib/types";
import Icon from "@/components/Icon";
import { ProofUploadCard } from "./proof";
import { useOrderAgain } from "./useOrderAgain";

function CancelModal({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const cancel = useOrderAction(order.id);
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState("");

  function submit() {
    setError("");
    cancel.mutate(
      { action: "cancel", body: remarks.trim() ? { remarks: remarks.trim() } : {} },
      {
        onSuccess: () => {
          toast.success(`Order #${order.id} was cancelled.`);
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      }
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Cancel order #${order.id}?`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={cancel.isPending}>
            Keep order
          </button>
          <button className="btn-danger" onClick={submit} disabled={cancel.isPending}>
            {cancel.isPending && <Spinner className="h-4 w-4 text-white" />} Cancel order
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">You can only cancel while the order is still pending. This cannot be undone.</p>
        {error && <Alert>{error}</Alert>}
        <TextAreaField label="Reason (optional)" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} />
      </div>
    </Modal>
  );
}

export default function CustomerOrderDetailPage() {
  const { id } = useParams();
  const order = useOrder(id);
  const timeline = useOrderTimeline(id);
  const [cancelOpen, setCancelOpen] = useState(false);
  const again = useOrderAgain();

  if (order.isPending) return <LoadingState label="Loading order…" />;
  if (order.isError) {
    return (
      <div>
        <BackLink to="/customer/orders">My orders</BackLink>
        <ErrorState
          message={parseApiError(order.error).status === 404 ? "We couldn't find that order." : errorMessage(order.error)}
          onRetry={() => order.refetch()}
        />
      </div>
    );
  }

  const o = order.data;
  const canCancel = o.allowed_transitions.includes("cancelled");
  const needsProof =
    o.payment.payment_method !== "cod" &&
    (o.payment.payment_status === "unpaid" || o.payment.payment_status === "rejected") &&
    o.order_status !== "cancelled" &&
    o.order_status !== "rejected";

  return (
    <div>
      <BackLink to="/customer/orders">My orders</BackLink>
      <div className="mt-2">
        <PageHeader
          title={`Order #${o.id}`}
          subtitle="Live updates every 15 seconds"
          actions={<OrderStatusBadge status={o.order_status} label={o.order_status_display} />}
        />
      </div>

      <div className="card mb-5 p-4">
        <StatusStepper status={o.order_status} />
        <div className="mt-4 grid gap-2">
          <button
            className={o.order_status === "delivered" ? "btn-primary w-full" : "btn-secondary w-full"}
            onClick={() => again.run(o)}
            disabled={!again.ready}
          >
            <Icon name="refresh" className="h-4 w-4" /> Order again
          </button>
          {canCancel && (
            <button className="btn-secondary w-full text-red-700" onClick={() => setCancelOpen(true)}>
              Cancel this order
            </button>
          )}
        </div>
      </div>

      {o.order_status === "rejected" && timeline.data && (
        <div className="mb-4">
          <Alert>
            Your order was rejected{(() => {
              const last = [...timeline.data].reverse().find((t) => t.to_status === "rejected");
              return last?.remarks ? `: ${last.remarks}` : ".";
            })()}
          </Alert>
        </div>
      )}

      {/* Most useful first: what needs doing, where it's going, what happened, then the receipt details. */}
      <div className="space-y-5">
        {needsProof && <ProofUploadCard order={o} />}
        <Card title="Delivery location">
          <DeliveryMap address={o.delivery_address} pin={toPin(o.delivery_latitude, o.delivery_longitude)} heightClass="h-56" />
        </Card>
        <TimelineCard entries={timeline.data} loading={timeline.isPending} />
        <Card title="Items">
          <OrderItemsTable items={o.items} total={o.total_amount} />
        </Card>
        <Card title="Delivery details">
          <DeliveryInfo order={o} />
        </Card>
        <Card title="Payment">
          <PaymentSummary payment={o.payment} />
        </Card>
      </div>

      <CancelModal order={o} open={cancelOpen} onClose={() => setCancelOpen(false)} />
    </div>
  );
}
