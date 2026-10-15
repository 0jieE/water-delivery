import { useState } from "react";
import { Link } from "react-router-dom";
import Icon from "@/components/Icon";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { errorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { MAX_LINES, MAX_QTY, useCart } from "@/lib/cart";
import { money } from "@/lib/format";
import { useOrders, useServices } from "@/lib/queries";
import { useOrderAgain } from "./useOrderAgain";
import type { Service } from "@/lib/types";

/** Pill-shaped quantity control. Also used in the checkout summary. */
export function QuantityStepper({
  value,
  onChange,
  min = 1,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
}) {
  const btn =
    "flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-700 shadow-soft transition active:scale-90 hover:text-water-700 disabled:opacity-40 disabled:hover:text-slate-700";
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 p-1">
      <button type="button" className={btn} onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Decrease quantity">
        <Icon name="minus" className="h-4 w-4" strokeWidth={2.2} />
      </button>
      <input
        className="tabular h-9 w-11 bg-transparent text-center text-sm font-bold text-slate-900 focus:outline-none"
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value.replace(/\D/g, ""), 10);
          onChange(Number.isFinite(n) ? Math.min(MAX_QTY, Math.max(min, n)) : min);
        }}
        aria-label="Quantity"
      />
      <button type="button" className={btn} onClick={() => onChange(Math.min(MAX_QTY, value + 1))} disabled={value >= MAX_QTY} aria-label="Increase quantity">
        <Icon name="plus" className="h-4 w-4" strokeWidth={2.2} />
      </button>
    </div>
  );
}

function ServiceCard({ service }: { service: Service }) {
  const cart = useCart();
  const toast = useToast();
  const [qty, setQty] = useState(1);
  const inCart = cart.lines.find((l) => l.serviceId === service.id)?.quantity ?? 0;
  const cartFull = inCart === 0 && cart.lines.length >= MAX_LINES;

  function add() {
    if (cartFull) {
      toast.error(`A single order can have at most ${MAX_LINES} different services.`);
      return;
    }
    cart.add(service, qty);
    toast.success(`Added ${qty} × ${service.service_name}`);
    setQty(1);
  }

  return (
    <article className="card card-hover p-4">
      <div className="flex items-start gap-3.5">
        <span className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl bg-gradient-to-br from-water-100 to-water-50 text-water-600 ring-1 ring-water-100">
          <Icon name="drop" className="h-7 w-7 fill-water-500/20" strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-snug text-slate-900">{service.service_name}</h3>
          <p className="mt-0.5 text-[13px] leading-snug text-slate-500">{service.description || "Water refill service."}</p>
        </div>
        <p className="flex-none text-right">
          <span className="tabular block text-lg font-bold text-water-700">{money(service.price)}</span>
          <span className="block text-[11px] text-slate-400">each</span>
        </p>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <QuantityStepper value={qty} onChange={setQty} />
        <button className="btn-primary flex-1" onClick={add}>
          <Icon name="plus" className="h-4 w-4" strokeWidth={2.2} /> Add to cart
        </button>
      </div>
      {inCart > 0 && (
        <p className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
          <Icon name="checkCircle" className="h-3.5 w-3.5" /> {inCart} in your cart
        </p>
      )}
    </article>
  );
}

export default function ServicesPage() {
  const services = useServices();
  const cart = useCart();
  const { user } = useSession();
  const first = user?.first_name || user?.username || "there";
  // The latest delivered order, offered as a one-tap reorder.
  const lastDelivered = useOrders({ status: "delivered", page_size: 1 }, { poll: false });
  const last = lastDelivered.data?.results[0];
  const again = useOrderAgain();

  return (
    <div>
      <section className="relative mb-6 overflow-hidden rounded-3xl bg-gradient-to-br from-water-500 via-water-600 to-water-800 p-5 text-white shadow-lift">
        <span className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10" aria-hidden />
        <span className="pointer-events-none absolute -bottom-14 right-10 h-32 w-32 rounded-full bg-white/10" aria-hidden />
        <p className="text-sm font-medium text-water-100">Hi {first},</p>
        <h1 className="mt-1 max-w-[16rem] text-2xl font-bold leading-tight tracking-tight text-white">Fresh water, delivered to your door.</h1>
        <p className="mt-2 max-w-[17rem] text-[13px] leading-snug text-water-100">Pick a refill, choose a delivery date, and we'll bring it to you.</p>
        <Link to="/customer/orders" className="btn mt-4 h-9 rounded-full bg-white/15 px-4 text-xs text-white backdrop-blur hover:bg-white/25">
          <Icon name="truck" className="h-4 w-4" /> Track my orders
        </Link>
      </section>

      {last && (
        <section className="card mb-6 flex items-center gap-3 p-4" aria-label="Your last delivered order">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <Icon name="refresh" className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Order again</p>
            <p className="truncate text-sm font-semibold text-slate-900">
              {last.items.map((i) => `${i.quantity}× ${i.service_name}`).join(", ")}
            </p>
          </div>
          <button className="btn-primary btn-sm flex-none" onClick={() => again.run(last)} disabled={!again.ready}>
            Reorder
          </button>
        </section>
      )}

      <h2 className="mb-3 text-base font-bold">Our services</h2>
      {services.isPending ? (
        <LoadingState label="Loading services…" />
      ) : services.isError ? (
        <ErrorState message={errorMessage(services.error)} onRetry={() => services.refetch()} />
      ) : services.data.length === 0 ? (
        <EmptyState title="No services available right now" hint="Please check back soon." />
      ) : (
        <div className="grid gap-3.5">
          {services.data.map((s) => (
            <ServiceCard key={s.id} service={s} />
          ))}
        </div>
      )}

      {cart.count > 0 && (
        // Floats above the content, just over the tab bar.
        <div className="sticky bottom-0 z-20 mt-4 animate-slide-up">
          <Link
            to="/customer/checkout"
            className="flex items-center justify-between gap-3 rounded-2xl bg-slate-900 px-4 py-3.5 text-white shadow-pop transition active:scale-[0.99]"
          >
            <span className="flex items-center gap-3">
              <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
                <Icon name="cart" className="h-5 w-5" />
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-water-500 px-1 text-[10px] font-bold">
                  {cart.count}
                </span>
              </span>
              <span className="leading-tight">
                <span className="block text-xs text-slate-300">Your cart</span>
                <span className="tabular block text-[15px] font-bold">{money(cart.total)}</span>
              </span>
            </span>
            <span className="flex items-center gap-1 text-sm font-semibold">
              Checkout <Icon name="chevronRight" className="h-4 w-4" strokeWidth={2.2} />
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
