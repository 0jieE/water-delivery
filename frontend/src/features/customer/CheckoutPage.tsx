import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import GcashPay from "@/components/GcashPay";
import Icon, { type IconName } from "@/components/Icon";
import { LocationPicker } from "@/components/map";
import { Alert, Card, EmptyState, PageHeader, Spinner, TextAreaField, TextField } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { api, errorMessage, fieldErrors, parseApiError } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { useCart } from "@/lib/cart";
import { PAYMENT_METHOD_LABEL, money, todayISO } from "@/lib/format";
import { round6, toPin, type LatLng } from "@/lib/geo";
import { invalidateOrderData, useServices } from "@/lib/queries";
import type { Order, PaymentMethod } from "@/lib/types";
import { ProofFields, uploadProof, validateProof } from "./proof";
import { QuantityStepper } from "./ServicesPage";

const METHODS: { value: PaymentMethod; hint: string; icon: IconName }[] = [
  { value: "cod", hint: "Pay the rider in cash when your water arrives.", icon: "truck" },
  { value: "gcash", hint: "Pay by GCash, then upload your receipt.", icon: "phone" },
];

export default function CheckoutPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const cart = useCart();
  const { user } = useSession();
  const services = useServices();

  const [address, setAddress] = useState(user?.address ?? "");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cod");
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  // Start from the customer's saved home location, if they have one.
  const [pin, setPin] = useState<LatLng | null>(() => toPin(user?.latitude, user?.longitude));
  const [showMap, setShowMap] = useState(() => toPin(user?.latitude, user?.longitude) !== null);

  // Current catalog prices (display only; the server recomputes everything).
  const live = useMemo(() => new Map((services.data ?? []).map((s) => [s.id, s])), [services.data]);
  const catalogLoaded = services.isSuccess;
  const unavailable = cart.lines.filter((l) => catalogLoaded && !live.has(l.serviceId));
  const estimate = cart.lines.reduce(
    (sum, l) => sum + Number(live.get(l.serviceId)?.price ?? l.price) * l.quantity,
    0
  );
  const online = method !== "cod";

  if (cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-lg">
        <PageHeader title="Checkout" />
        <div className="card">
          <EmptyState
            title="Your cart is empty"
            hint="Add some water refill services first."
            action={
              <Link to="/customer" className="btn-primary">
                Browse services
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const v: Record<string, string> = {};
    if (!address.trim()) v.delivery_address = "Enter the delivery address.";
    if (!date) v.delivery_date = "Choose a delivery date.";
    else if (date < todayISO()) v.delivery_date = "Delivery date cannot be in the past.";
    if (online) Object.assign(v, validateProof(file, reference));
    if (unavailable.length) v.items = "Remove the unavailable items from your cart.";
    setErrors(v);
    setFormError("");
    if (Object.keys(v).length) return;

    setBusy(true);
    let order: Order;
    try {
      order = (
        await api.post<Order>("/orders/", {
          items: cart.lines.map((l) => ({ service: l.serviceId, quantity: l.quantity })),
          delivery_date: date,
          delivery_address: address.trim(),
          notes: notes.trim(),
          payment_method: method,
          // Both or neither; omitted when the customer didn't pin a spot.
          ...(pin ? { delivery_latitude: round6(pin.lat), delivery_longitude: round6(pin.lng) } : {}),
        })
      ).data;
    } catch (err) {
      const info = parseApiError(err);
      const flat = fieldErrors(info);
      // Per-line item errors come back aligned with the submitted lines.
      const rawItems = info.errors.items;
      if (Array.isArray(rawItems) && rawItems.some((x) => typeof x === "object" && x !== null)) {
        const lineMsgs = rawItems
          .map((x, i) =>
            x && typeof x === "object" && Object.keys(x).length
              ? `${cart.lines[i]?.name ?? `Item ${i + 1}`}: ${Object.values(x as Record<string, string[]>).flat().join(" ")}`
              : ""
          )
          .filter(Boolean);
        flat.items = lineMsgs.join(" ");
      }
      setErrors(flat);
      setFormError(Object.keys(flat).length ? "Please fix the highlighted problems." : errorMessage(err, info));
      setBusy(false);
      return;
    }

    cart.clear();
    await invalidateOrderData(qc);

    if (online && file) {
      try {
        await uploadProof(order.payment.id, file, reference);
      } catch (err) {
        // The order exists. The confirmation screen shows the upload form again, so they can retry there.
        toast.error(`Order #${order.id} was placed, but the proof upload failed: ${errorMessage(err)} You can upload it again on the next screen.`);
      }
    }
    // The confirmation screen is the success message (and shows what to do next).
    navigate(`/customer/order-placed/${order.id}`, { replace: true });
  }

  return (
    <div>
      <PageHeader title="Checkout" subtitle="Review your items and tell us where and when to deliver." />
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <div className="space-y-5">
          {formError && <Alert>{formError}</Alert>}

          <Card
            title={`Your items (${cart.count})`}
            actions={
              <Link to="/customer" className="-my-2 -mr-2 inline-flex min-h-10 items-center rounded-lg px-2 text-xs font-semibold text-water-700 hover:underline">
                + Add more
              </Link>
            }
          >
            {errors.items && <div className="mb-3"><Alert>{errors.items}</Alert></div>}
            <ul className="-my-3 divide-y divide-slate-100">
              {cart.lines.map((l) => {
                const gone = catalogLoaded && !live.has(l.serviceId);
                const price = live.get(l.serviceId)?.price ?? l.price;
                return (
                  <li key={l.serviceId} className="py-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{l.name}</p>
                        <p className="text-xs text-slate-500">{money(price)} each</p>
                        {gone && <p className="text-xs font-medium text-red-600">No longer available</p>}
                      </div>
                      <button
                        type="button"
                        className="-mr-2 -mt-2 flex h-10 w-10 flex-none items-center justify-center rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-600"
                        onClick={() => cart.remove(l.serviceId)}
                        aria-label={`Remove ${l.name}`}
                      >
                        <Icon name="x" className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between">
                      <QuantityStepper value={l.quantity} onChange={(n) => cart.setQuantity(l.serviceId, n)} />
                      <span className="tabular text-[15px] font-bold text-slate-900">{money(Number(price) * l.quantity)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card title="Delivery">
            <div className="space-y-4">
              <TextAreaField
                label="Delivery address"
                required
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                error={errors.delivery_address}
                maxLength={255}
              />
              <div>
                <button
                  type="button"
                  className="btn-secondary w-full"
                  onClick={() => setShowMap((s) => !s)}
                  aria-expanded={showMap}
                >
                  <Icon name="pin" className="h-4 w-4 text-water-600" />
                  {showMap ? "Hide map" : pin ? "Change pin on map" : "Pin my location on a map"}
                </button>
                {showMap && (
                  <div className="mt-3">
                    <LocationPicker pin={pin} onPin={setPin} address={address} onAddress={setAddress} />
                  </div>
                )}
                {(errors.delivery_latitude || errors.delivery_longitude) && (
                  <p className="mt-2 text-xs text-red-600" role="alert">
                    {errors.delivery_latitude || errors.delivery_longitude}
                  </p>
                )}
                {!showMap && pin && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs leading-snug text-slate-500">
                    <Icon name="pin" className="mt-px h-3.5 w-3.5 flex-none text-water-600" />
                    The rider will be sent to your pinned spot. If the address above is a different place, open the map and move or remove the pin.
                  </p>
                )}
              </div>
              <TextField
                label="Delivery date"
                required
                type="date"
                min={todayISO()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                error={errors.delivery_date}
              />
              <TextAreaField
                label="Notes for the rider (optional)"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                error={errors.notes}
                maxLength={1000}
                placeholder="Landmarks, gate instructions, preferred time…"
              />
            </div>
          </Card>

          <Card title="Payment">
            <fieldset className="space-y-2">
              <legend className="sr-only">Payment method</legend>
              {METHODS.map((m) => {
                const selected = method === m.value;
                return (
                  <label
                    key={m.value}
                    className={`flex cursor-pointer items-center gap-3.5 rounded-2xl border-2 p-3.5 transition ${
                      selected ? "border-water-500 bg-water-50/70" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="payment_method"
                      className="sr-only"
                      checked={selected}
                      onChange={() => setMethod(m.value)}
                    />
                    <span
                      className={`flex h-11 w-11 flex-none items-center justify-center rounded-xl ${
                        selected ? "bg-water-600 text-white" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      <Icon name={m.icon} className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-900">{PAYMENT_METHOD_LABEL[m.value]}</span>
                      <span className="block text-xs leading-snug text-slate-500">{m.hint}</span>
                    </span>
                    <span
                      className={`flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 transition ${
                        selected ? "border-water-600 bg-water-600 text-white" : "border-slate-300"
                      }`}
                      aria-hidden
                    >
                      {selected && <Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} />}
                    </span>
                  </label>
                );
              })}
              {errors.payment_method && <p className="text-xs text-red-600">{errors.payment_method}</p>}
            </fieldset>

            {online && (
              <div className="mt-4 space-y-5 border-t border-slate-100 pt-4">
                <GcashPay amount={money(estimate)} />
                <ProofFields file={file} onFile={setFile} reference={reference} onReference={setReference} errors={errors} />
              </div>
            )}
          </Card>
        </div>

        <Card className="overflow-hidden !border-water-200 bg-gradient-to-b from-white to-water-50/40">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-600">Estimated total</span>
            <span className="tabular text-2xl font-bold tracking-tight text-water-800">{money(estimate)}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">The final amount is confirmed by the server when you place the order.</p>
          <button className="btn-primary btn-lg mt-4 w-full" disabled={busy || unavailable.length > 0}>
            {busy ? <Spinner className="h-5 w-5 text-white" /> : <Icon name="check" className="h-5 w-5" strokeWidth={2.4} />} Place order
          </button>
        </Card>
      </form>
    </div>
  );
}
