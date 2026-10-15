import { useNavigate } from "react-router-dom";
import { useToast } from "@/components/Toast";
import { useCart } from "@/lib/cart";
import { useServices } from "@/lib/queries";
import type { Order } from "@/lib/types";

/**
 * "Order again": copy a past order's items into the cart and go to checkout. Prices and availability
 * always come from today's catalogue, never from the old order. Services that have since been
 * removed are skipped and the customer is told.
 */
export function useOrderAgain() {
  const services = useServices();
  const cart = useCart();
  const toast = useToast();
  const navigate = useNavigate();

  return {
    ready: services.isSuccess,
    run(order: Order) {
      const live = new Map((services.data ?? []).map((s) => [s.id, s]));
      let added = 0;
      const skipped: string[] = [];
      for (const item of order.items) {
        const service = live.get(item.service);
        if (!service) skipped.push(item.service_name);
        else {
          cart.add(service, item.quantity);
          added += 1;
        }
      }
      if (added === 0) {
        toast.error("None of those services are available anymore.");
        return;
      }
      toast.success(
        skipped.length
          ? `Added ${added} item${added === 1 ? "" : "s"}. No longer available: ${skipped.join(", ")}.`
          : `Added ${added} item${added === 1 ? "" : "s"} to your cart.`
      );
      navigate("/customer/checkout");
    },
  };
}
