import { useEffect, useState } from "react";
import { Alert, Modal, SelectField, Spinner, TextAreaField, TextField } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { errorMessage, fieldErrors, parseApiError } from "@/lib/api";
import { RIDER_STATUS_LABEL, addDays, todayISO } from "@/lib/format";
import { useOrderAction, useRiders } from "@/lib/queries";
import type { Order } from "@/lib/types";

interface ModalProps {
  order: Order;
  open: boolean;
  onClose: () => void;
}

/** Reject (pending) and cancel (confirmed / scheduled / failed) both need a written reason. */
export function ReasonModal({
  order,
  open,
  onClose,
  kind,
}: ModalProps & { kind: "reject" | "cancel" }) {
  const toast = useToast();
  const action = useOrderAction(order.id);
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setRemarks("");
      setError("");
    }
  }, [open]);

  const isReject = kind === "reject";

  function submit() {
    if (!remarks.trim()) {
      setError("A reason is required.");
      return;
    }
    const vars = isReject
      ? { action: "reject", body: { remarks: remarks.trim() } }
      : { action: "update-status", body: { status: "cancelled", remarks: remarks.trim() } };
    action.mutate(vars, {
      onSuccess: () => {
        toast.success(isReject ? `Order #${order.id} rejected.` : `Order #${order.id} cancelled.`);
        onClose();
      },
      onError: (e) => setError(errorMessage(e)),
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isReject ? `Reject order #${order.id}` : `Cancel order #${order.id}`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={action.isPending}>
            Back
          </button>
          <button className="btn-danger" onClick={submit} disabled={action.isPending}>
            {action.isPending && <Spinner className="h-4 w-4 text-white" />} {isReject ? "Reject order" : "Cancel order"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">The customer will see this reason and be notified.</p>
        {error && <Alert>{error}</Alert>}
        <TextAreaField
          label="Reason"
          required
          rows={3}
          value={remarks}
          onChange={(e) => {
            setRemarks(e.target.value);
            setError("");
          }}
          maxLength={500}
          autoFocus
        />
      </div>
    </Modal>
  );
}

/** Only riders who are `available` and active can be assigned (API.md §8). */
function RiderSelect({
  order,
  value,
  onChange,
  error,
  allowNone,
}: {
  order: Order;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  allowNone?: boolean;
}) {
  // `assignable` = active riders who are available OR already out on a trip (they can take more stops).
  const riders = useRiders({ assignable: true });
  const current = order.rider;
  const options = riders.data ?? [];
  return (
    <SelectField
      label="Rider"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error}
      disabled={riders.isPending}
      hint={
        riders.isError
          ? "Could not load riders."
          : riders.isSuccess && options.length === 0
            ? "No riders are available right now."
            : current
              ? `Currently assigned: ${current.full_name} (${RIDER_STATUS_LABEL[current.status]})`
              : undefined
      }
    >
      <option value="">{allowNone ? "No change / assign later" : "Select a rider…"}</option>
      {options.map((r) => (
        <option key={r.id} value={r.id}>
          {r.full_name} — {r.vehicle_type || "no vehicle"}
          {r.status === "on_delivery" ? " (on a trip)" : ""}
        </option>
      ))}
    </SelectField>
  );
}

export function AssignRiderModal({ order, open, onClose }: ModalProps) {
  const toast = useToast();
  const action = useOrderAction(order.id);
  const [rider, setRider] = useState("");
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");

  useEffect(() => {
    if (open) {
      setRider("");
      setError("");
      setFieldError("");
    }
  }, [open]);

  function submit() {
    if (!rider) {
      setFieldError("Choose a rider.");
      return;
    }
    setError("");
    setFieldError("");
    action.mutate(
      { action: "assign-rider", body: { rider: Number(rider) } },
      {
        onSuccess: () => {
          toast.success(`Rider assigned to order #${order.id}.`);
          onClose();
        },
        onError: (e) => {
          const info = parseApiError(e);
          const fe = fieldErrors(info);
          if (fe.rider) setFieldError(fe.rider);
          else setError(errorMessage(e, info));
        },
      }
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={order.rider ? `Change rider · order #${order.id}` : `Assign rider · order #${order.id}`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={action.isPending}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={action.isPending}>
            {action.isPending && <Spinner className="h-4 w-4 text-white" />} Assign rider
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <RiderSelect order={order} value={rider} onChange={setRider} error={fieldError} />
      </div>
    </Modal>
  );
}

/** Schedule a confirmed/failed order, or reschedule a scheduled one; a rider can be set in the same call. */
export function ScheduleModal({ order, open, onClose }: ModalProps) {
  const toast = useToast();
  const action = useOrderAction(order.id);
  const rescheduling = order.order_status === "scheduled";
  const [date, setDate] = useState(order.delivery_date);
  const [rider, setRider] = useState("");
  const [remarks, setRemarks] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      const today = todayISO();
      setDate(order.delivery_date >= today ? order.delivery_date : addDays(today, 1));
      setRider("");
      setRemarks("");
      setErrors({});
      setError("");
    }
  }, [open, order.delivery_date]);

  function submit() {
    const v: Record<string, string> = {};
    if (!date) v.delivery_date = "Choose a delivery date.";
    else if (date < todayISO()) v.delivery_date = "Delivery date cannot be in the past.";
    setErrors(v);
    setError("");
    if (Object.keys(v).length) return;

    const body: Record<string, unknown> = { delivery_date: date };
    if (rider) body.rider = Number(rider);
    if (remarks.trim()) body.remarks = remarks.trim();
    action.mutate(
      { action: "schedule", body },
      {
        onSuccess: () => {
          toast.success(rescheduling ? `Order #${order.id} rescheduled.` : `Order #${order.id} scheduled.`);
          onClose();
        },
        onError: (e) => {
          const info = parseApiError(e);
          const fe = fieldErrors(info);
          setErrors(fe);
          setError(Object.keys(fe).length ? "" : errorMessage(e, info));
        },
      }
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${rescheduling ? "Reschedule" : "Schedule"} order #${order.id}`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={action.isPending}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={action.isPending}>
            {action.isPending && <Spinner className="h-4 w-4 text-white" />} {rescheduling ? "Reschedule" : "Schedule delivery"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Delivery date"
          required
          type="date"
          min={todayISO()}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          error={errors.delivery_date}
        />
        <RiderSelect order={order} value={rider} onChange={setRider} error={errors.rider} allowNone />
        <TextAreaField label="Remarks (optional)" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} />
      </div>
    </Modal>
  );
}

/** Payment rejection needs a reason (API.md §10). */
export function RejectPaymentModal({
  open,
  title,
  onClose,
  onSubmit,
  busy,
  error,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onSubmit: (remarks: string) => void;
  busy: boolean;
  error: string;
}) {
  const [remarks, setRemarks] = useState("");
  const [local, setLocal] = useState("");
  useEffect(() => {
    if (open) {
      setRemarks("");
      setLocal("");
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Back
          </button>
          <button
            className="btn-danger"
            disabled={busy}
            onClick={() => {
              if (!remarks.trim()) return setLocal("A reason is required.");
              onSubmit(remarks.trim());
            }}
          >
            {busy && <Spinner className="h-4 w-4 text-white" />} Reject payment
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">The customer will be told why and can upload a new proof.</p>
        {(error || local) && <Alert>{local || error}</Alert>}
        <TextAreaField
          label="Reason"
          required
          rows={3}
          value={remarks}
          onChange={(e) => {
            setRemarks(e.target.value);
            setLocal("");
          }}
          maxLength={500}
          placeholder="e.g. Amount does not match"
          autoFocus
        />
      </div>
    </Modal>
  );
}
