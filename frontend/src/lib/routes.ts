import type { Role } from "./types";

/** Where an order lives for each role (riders see it as a delivery). */
export function orderPath(role: Role | null, orderId: number | string): string {
  switch (role) {
    case "customer":
      return `/customer/orders/${orderId}`;
    case "rider":
      return `/rider/deliveries/${orderId}`;
    case "admin":
      return `/admin/orders/${orderId}`;
    default:
      return `/staff/orders/${orderId}`;
  }
}
