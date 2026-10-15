// Types mirror API.md. Money is always a string with 2 decimals.

export type Role = "admin" | "staff" | "rider" | "customer";

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "scheduled"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "rejected"
  | "failed";

// `bank_transfer` is no longer offered to customers but stays here so older orders still display.
export type PaymentMethod = "cod" | "gcash" | "bank_transfer";
export type PaymentStatus = "unpaid" | "pending_verification" | "paid" | "rejected";
export type RiderStatus = "available" | "on_delivery" | "off_duty";

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface RiderProfileLite {
  id: number;
  vehicle_type: string;
  status: RiderStatus;
}

export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: Role;
  contact_number: string;
  address: string;
  /** Saved home location: both numbers, or both null (API.md §1 "Coordinates"). */
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
  created_at: string;
  rider_profile: RiderProfileLite | null;
}

export interface LoginResponse {
  access: string;
  refresh: string;
  user: User;
}

export interface Service {
  id: number;
  service_name: string;
  description: string;
  price: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrderCustomer {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  contact_number: string;
  email?: string; // omitted for riders
  address: string;
}

export interface OrderRider {
  id: number; // RiderProfile id
  user_id: number;
  full_name: string;
  contact_number: string;
  vehicle_type: string;
  status: RiderStatus;
}

export interface OrderItem {
  id: number;
  service: number;
  service_name: string;
  quantity: number;
  unit_price: string;
  subtotal: string;
}

export interface Payment {
  id: number;
  order: number;
  payment_method: PaymentMethod;
  payment_method_display: string;
  payment_status: PaymentStatus;
  payment_status_display: string;
  // The next four are omitted from the rider's reduced view.
  reference_number?: string;
  proof_image?: string | null;
  verified_by?: { id: number; full_name: string } | null;
  remarks?: string;
  amount: string;
  payment_date: string | null;
  created_at: string;
  /** Cash-on-delivery hand-in (staff/admin only; absent for customers and riders). */
  remittance?: number | null;
  remitted_at?: string | null;
}

export interface Order {
  id: number;
  customer: OrderCustomer;
  rider: OrderRider | null;
  order_date: string;
  delivery_date: string;
  delivery_address: string;
  /** The pin the customer chose at checkout, or null when none was sent (older orders). */
  delivery_latitude: number | null;
  delivery_longitude: number | null;
  notes: string;
  total_amount: string;
  order_status: OrderStatus;
  order_status_display: string;
  items: OrderItem[];
  payment: Payment;
  allowed_transitions: OrderStatus[];
  can_assign_rider: boolean;
  updated_at: string;
}

/** `deliveries/my/` item: the rider's reduced Order plus two extra fields. */
export interface Delivery extends Order {
  amount_to_collect: string;
  rider_status: RiderStatus;
}

export interface TimelineEntry {
  id: number;
  from_status: OrderStatus | "";
  from_status_display: string;
  to_status: OrderStatus;
  to_status_display: string;
  changed_by: { id: number; full_name: string; role: Role } | null;
  remarks: string;
  created_at: string;
}

export interface PaymentWithSummary extends Payment {
  order_summary: {
    id: number;
    customer_id: number;
    customer_name: string;
    order_status: OrderStatus;
    delivery_date: string;
    total_amount: string;
  };
}

export interface AppNotification {
  id: number;
  title: string;
  message: string;
  order: number | null;
  is_read: boolean;
  created_at: string;
}

/** The station's GCash details (API.md "Payment settings"). The record always exists. */
export interface PaymentSettings {
  gcash_qr_image: string | null;
  gcash_account_name: string;
  gcash_number: string;
}

export interface Rider {
  id: number; // RiderProfile id
  user_id: number;
  username: string;
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
  contact_number: string;
  is_active: boolean;
  vehicle_type: string;
  status: RiderStatus;
  created_at: string;
}

export interface DashboardCounters {
  date: string;
  today_by_status: Record<OrderStatus, number>;
  today_total: number;
  pending_orders: number;
  pending_payments: number;
  needs_rider: number;
  available_riders: number;
  /** Total COD cash currently held by riders (money string). */
  cash_outstanding: string;
}

export interface ReportColumn {
  key: string;
  label: string;
  type: "text" | "number" | "money";
}

export interface Report {
  report: string;
  title: string;
  note: string;
  date_from: string;
  date_to: string;
  generated_at: string;
  columns: ReportColumn[];
  rows: Record<string, string | number>[];
  totals: Record<string, string | number>;
}

export interface BackupFile {
  filename: string;
  size: number;
  created_at: string;
  engine: "sqlite" | "postgres";
}

/** Normalised error from the API (see API.md §1.1). */
export interface ApiErrorInfo {
  status: number | null;
  code: string;
  detail: string;
  errors: Record<string, unknown>;
}

// ---- Cash-on-delivery remittance -------------------------------------------------------------

export interface CashOrder {
  order_id: number;
  amount: string;
  collected_at: string;
}

/** One rider who is holding cash (GET deliveries/cash/). */
export interface CashHeld {
  rider: { id: number; full_name: string; vehicle_type: string };
  orders_count: number;
  amount_held: string;
  oldest_collected_at: string;
  orders: CashOrder[];
}

export interface Remittance {
  id: number;
  rider: { id: number; full_name: string };
  amount: string;
  orders: { order_id: number; amount: string }[];
  received_by: { id: number; full_name: string };
  received_at: string;
  remarks: string;
}

/** The signed-in rider's own balance (GET deliveries/my/cash/). */
export interface MyCash {
  amount_held: string;
  orders: CashOrder[];
  recent_remittances: { id: number; amount: string; received_at: string; received_by: string }[];
}