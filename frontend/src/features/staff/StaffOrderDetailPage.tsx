import { useState } from "react";
import { useParams } from "react-router-dom";
import { DeliveryMap } from "@/components/map";
import {
  BackLink,
  Card,
  DefinitionList,
  ErrorState,
  LoadingState,
  OrderStatusBadge,
  PageHeader,
  Spinner,
  StatusStepper,
} from "@/components/ui";
import { DeliveryInfo, OrderItemsTable, PaymentSummary, TimelineCard } from "@/components/order";
import { useToast } from "@/components/Toast";
import { errorMessage, parseApiError } from "@/lib/api";
import { RIDER_STATUS_LABEL } from "@/lib/format";
import { toPin } from "@/lib/geo";
import { useOrder, useOrderAction, useOrderTimeline } from "@/lib/queries";
import { AssignRiderModal, ReasonModal, ScheduleModal } from "./orderModals";
import PaymentActions from "./PaymentActions";
import { useBase } from "./useBase";

type Open = null | "reject" | "cancel" | "schedule" | "assign";

export default function StaffOrderDetailPage() {
  const { id } = useParams();
  const base = useBase();
  const toast = useToast();
  const order = useOrder(id);
  const timeline = useOrderTimeline(id);
  const confirm = useOrderAction(Number(id));
  const [open, setOpen] = useState<Open>(null);

  const back = <BackLink to={`${base}/orders`}>Orders</BackLink>;

  if (order.isPending) return <LoadingState label="Loading order…" />;
  if (order.isError) {
    return (
      <div>
        {back}
        <ErrorState
          message={parseApiError(order.error).status === 404 ? "That order doesn't exist." : errorMessage(order.error)}
          onRetry={() => order.refetch()}
        />
      </div>
    );
  }

  const o = order.data;
  const can = (s: string) => (o.allowed_transitions as string[]).includes(s);
  const close = () => setOpen(null);
  const hasActions = can("confirmed") || can("rejected") || can("scheduled") || can("cancelled") || o.can_assign_rider;

  function doConfirm() {
    confirm.mutate(
      { action: "confirm" },
      {
        onSuccess: () => toast.success(`Order #${o.id} confirmed.`),
        onError: (e) => toast.error(errorMessage(e)),
      }
    );
  }

  return (
    <div>
      {back}
      <div className="mt-2">
        <PageHeader
          title={`Order #${o.id}`}
          subtitle="Updates automatically every 15 seconds."
          actions={<OrderStatusBadge status={o.order_status} label={o.order_status_display} />}
        />
      </div>

      <div className="card mb-5 p-5">
        <StatusStepper status={o.order_status} />
      </div>

      {hasActions && (
        <div className="card mb-5 flex flex-wrap items-center gap-2 border-water-200 bg-water-50/40 p-3.5">
          <span className="mr-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Actions</span>
          {can("confirmed") && (
            <button className="btn-primary" onClick={doConfirm} disabled={confirm.isPending}>
              {confirm.isPending && <Spinner className="h-4 w-4 text-white" />} Confirm order
            </button>
          )}
          {can("scheduled") && (
            <button className="btn-primary" onClick={() => setOpen("schedule")}>
              {o.order_status === "scheduled" ? "Reschedule" : o.order_status === "failed" ? "Retry delivery" : "Schedule delivery"}
            </button>
          )}
          {o.can_assign_rider && (
            <button className="btn-secondary" onClick={() => setOpen("assign")}>
              {o.rider ? "Change rider" : "Assign rider"}
            </button>
          )}
          {can("rejected") && (
            <button className="btn-secondary text-red-700" onClick={() => setOpen("reject")}>
              Reject
            </button>
          )}
          {can("cancelled") && (
            <button className="btn-secondary text-red-700" onClick={() => setOpen("cancel")}>
              Cancel order
            </button>
          )}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Card title="Items">
            <OrderItemsTable items={o.items} total={o.total_amount} />
          </Card>
          <Card title="Delivery">
            <DeliveryInfo order={o} showCustomer />
            {o.customer.email && <p className="mt-3 text-xs text-slate-500">Customer email: {o.customer.email}</p>}
            {o.rider && (
              <p className="mt-3 text-xs text-slate-500">
                Rider contact: {o.rider.contact_number} · {RIDER_STATUS_LABEL[o.rider.status]}
              </p>
            )}
          </Card>
          <Card title="Delivery location">
            <DeliveryMap address={o.delivery_address} pin={toPin(o.delivery_latitude, o.delivery_longitude)} heightClass="h-64" />
          </Card>
          <Card title="Payment">
            <PaymentSummary payment={o.payment} />
            {o.payment.payment_status === "pending_verification" && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="mb-2 text-sm text-slate-600">Check the proof and reference number, then verify or reject.</p>
                <PaymentActions paymentId={o.payment.id} orderId={o.id} />
              </div>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <TimelineCard entries={timeline.data} loading={timeline.isPending} />
          <Card title="Customer">
            <DefinitionList
              items={[
                ["Name", o.customer.full_name],
                ["Username", o.customer.username],
                ["Contact", o.customer.contact_number],
              ]}
            />
          </Card>
        </div>
      </div>

      <ReasonModal order={o} kind="reject" open={open === "reject"} onClose={close} />
      <ReasonModal order={o} kind="cancel" open={open === "cancel"} onClose={close} />
      <ScheduleModal order={o} open={open === "schedule"} onClose={close} />
      <AssignRiderModal order={o} open={open === "assign"} onClose={close} />
    </div>
  );
}
