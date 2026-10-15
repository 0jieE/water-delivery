import type { Role } from "@/lib/types";
import Icon, { type IconName } from "./Icon";

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  icon: IconName;
  /** Sidebar section heading (staff/admin). */
  group?: string;
  /** Show the cart count as a badge on this tab (customer only). */
  cart?: boolean;
  /** Live count badge from the dashboard counters (staff/admin only). */
  badge?: "pending_orders" | "pending_payments";
}

const staffItems = (base: string): NavItem[] => [
  { to: base, label: "Dashboard", end: true, icon: "home", group: "Operations" },
  { to: `${base}/orders`, label: "Orders", icon: "list", group: "Operations", badge: "pending_orders" },
  { to: `${base}/schedule`, label: "Delivery schedule", icon: "calendar", group: "Operations" },
  { to: `${base}/payments`, label: "Payments", icon: "card", group: "Operations", badge: "pending_payments" },
  { to: `${base}/cash`, label: "Rider cash", icon: "coin", group: "Operations" },
];

export function navFor(role: Role): NavItem[] {
  switch (role) {
    case "customer":
      return [
        { to: "/customer", label: "Services", end: true, icon: "drop" },
        { to: "/customer/orders", label: "Orders", icon: "list" },
        { to: "/customer/checkout", label: "Cart", icon: "cart", cart: true },
        { to: "/customer/profile", label: "Profile", icon: "user" },
      ];
    case "rider":
      return [
        { to: "/rider", label: "Deliveries", end: true, icon: "truck" },
        { to: "/rider/history", label: "History", icon: "clock" },
        { to: "/rider/cash", label: "Cash", icon: "coin" },
        { to: "/rider/profile", label: "Profile", icon: "user" },
      ];
    case "staff":
      return [...staffItems("/staff"), { to: "/staff/profile", label: "Profile", icon: "user", group: "Account" }];
    case "admin":
      return [
        ...staffItems("/admin"),
        { to: "/admin/users", label: "Users", icon: "users", group: "Management" },
        { to: "/admin/riders", label: "Riders", icon: "truck", group: "Management" },
        { to: "/admin/services", label: "Services & prices", icon: "tag", group: "Management" },
        { to: "/admin/payment-settings", label: "Payment settings", icon: "card", group: "Management" },
        { to: "/admin/reports", label: "Reports", icon: "chart", group: "Management" },
        { to: "/admin/backups", label: "Backups", icon: "db", group: "Management" },
        { to: "/admin/profile", label: "Profile", icon: "user", group: "Account" },
      ];
  }
}

export const roleLabel: Record<Role, string> = {
  admin: "Administrator",
  staff: "Staff",
  rider: "Rider",
  customer: "Customer",
};

export function Brand({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-gradient-to-b from-water-400 to-water-600 text-white shadow-glow">
        <Icon name="drop" className="h-5 w-5 fill-white/90" strokeWidth={1.4} />
      </span>
      <span className="leading-tight">
        <span className={`block text-[15px] font-bold tracking-tight ${light ? "text-white" : "text-slate-900"}`}>Deep Water</span>
        {!compact && (
          <span className={`block text-[11px] font-medium ${light ? "text-water-100" : "text-slate-500"}`}>Refilling Station</span>
        )}
      </span>
    </div>
  );
}
