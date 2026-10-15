import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api } from "./api";
import { POLL_MS } from "./format";
import type {
  AppNotification,
  CashHeld,
  Remittance,
  DashboardCounters,
  Order,
  Paginated,
  PaymentSettings,
  PaymentWithSummary,
  Rider,
  Service,
  TimelineEntry,
} from "./types";

export type Params = Record<string, string | number | boolean | undefined | null>;

/** Drop empty filters so they never reach the query string. */
export function cleanParams(params: Params = {}): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}

// ---- Catalog ----------------------------------------------------------------------------------

export function useServices(params?: Params) {
  return useQuery({
    queryKey: ["services", cleanParams(params)],
    queryFn: async () => (await api.get<Service[]>("/catalog/services/", { params: cleanParams(params) })).data,
  });
}

// ---- Orders (polled every 15 s) ---------------------------------------------------------------

export function useOrders(params?: Params, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: ["orders", "list", cleanParams(params)],
    queryFn: async () =>
      (await api.get<Paginated<Order>>("/orders/", { params: cleanParams(params) })).data,
    refetchInterval: opts.poll === false ? false : POLL_MS,
    placeholderData: keepPreviousData,
  });
}

export function useOrder(id: number | string | undefined) {
  return useQuery({
    queryKey: ["orders", "detail", String(id)],
    queryFn: async () => (await api.get<Order>(`/orders/${id}/`)).data,
    enabled: id !== undefined,
    refetchInterval: POLL_MS,
  });
}

export function useOrderTimeline(id: number | string | undefined) {
  return useQuery({
    queryKey: ["orders", "timeline", String(id)],
    queryFn: async () => (await api.get<TimelineEntry[]>(`/orders/${id}/timeline/`)).data,
    enabled: id !== undefined,
    refetchInterval: POLL_MS,
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: ["orders", "dashboard"],
    queryFn: async () => (await api.get<DashboardCounters>("/orders/dashboard/")).data,
    refetchInterval: POLL_MS,
  });
}

/** Everything that can change after an order/payment/delivery action. */
export function invalidateOrderData(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["orders"] }),
    qc.invalidateQueries({ queryKey: ["payments"] }),
    qc.invalidateQueries({ queryKey: ["deliveries"] }),
    qc.invalidateQueries({ queryKey: ["riders"] }),
    qc.invalidateQueries({ queryKey: ["notifications"] }),
    qc.invalidateQueries({ queryKey: ["cash"] }),
  ]);
}

/**
 * POST a staff/customer action on an order (`confirm`, `reject`, `schedule`, `assign-rider`,
 * `update-status`, `cancel`). The API returns the updated Order.
 */
export function useOrderAction(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { action: string; body?: Record<string, unknown> }) =>
      (await api.post<Order>(`/orders/${orderId}/${vars.action}/`, vars.body ?? {})).data,
    onSuccess: async (order) => {
      qc.setQueryData(["orders", "detail", String(orderId)], order);
      await invalidateOrderData(qc);
    },
  });
}

// ---- Riders -----------------------------------------------------------------------------------

export function useRiders(params?: Params, enabled = true) {
  return useQuery({
    queryKey: ["riders", cleanParams(params)],
    queryFn: async () =>
      (await api.get<Rider[]>("/deliveries/riders/", { params: cleanParams(params) })).data,
    enabled,
  });
}

// ---- Payments ---------------------------------------------------------------------------------

export function usePayments(params?: Params) {
  return useQuery({
    queryKey: ["payments", cleanParams(params)],
    queryFn: async () =>
      (await api.get<Paginated<PaymentWithSummary>>("/payments/", { params: cleanParams(params) }))
        .data,
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
  });
}

/** GCash QR + account details. Readable by any signed-in user; only admins may change it. */
export function usePaymentSettings() {
  return useQuery({
    queryKey: ["payment-settings"],
    queryFn: async () => (await api.get<PaymentSettings>("/payments/settings/")).data,
    staleTime: 60_000,
  });
}

/** Staff/admin: `verify` (no body) or `reject` (remarks required) a payment in the queue. */
export function usePaymentAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { paymentId: number; action: "verify" | "reject"; remarks?: string }) =>
      (
        await api.post<PaymentWithSummary>(
          `/payments/${vars.paymentId}/${vars.action}/`,
          vars.action === "reject" ? { remarks: vars.remarks } : {}
        )
      ).data,
    onSuccess: () => invalidateOrderData(qc),
  });
}

// ---- Cash-on-delivery remittance --------------------------------------------------------------

/** Riders currently holding cash, largest balance first (staff/admin). */
export function useCashHeld(riderId?: number) {
  return useQuery({
    queryKey: ["cash", "held", riderId ?? "all"],
    queryFn: async () => (await api.get<CashHeld[]>("/deliveries/cash/", { params: cleanParams({ rider: riderId }) })).data,
    refetchInterval: POLL_MS,
  });
}

export function useRemittances(params?: Params) {
  return useQuery({
    queryKey: ["cash", "remittances", cleanParams(params)],
    queryFn: async () =>
      (await api.get<Paginated<Remittance>>("/deliveries/cash/remittances/", { params: cleanParams(params) })).data,
    placeholderData: keepPreviousData,
  });
}

/**
 * Record that a rider handed cash in. Omit `orders` to take everything they hold. No amount is ever
 * sent: the server works it out from the orders.
 */
export function useRemit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { rider: number; orders?: number[]; remarks?: string }) =>
      (await api.post<Remittance>("/deliveries/cash/remit/", cleanBody(vars))).data,
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["cash"] }),
        qc.invalidateQueries({ queryKey: ["orders"] }),
        qc.invalidateQueries({ queryKey: ["payments"] }),
      ]),
  });
}

function cleanBody<T extends Record<string, unknown>>(body: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== "") (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

// ---- Notifications (bell polls the unread count every 15 s) -----------------------------------

export function useUnreadCount() {
  return useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: async () => (await api.get<{ count: number }>("/notifications/unread-count/")).data.count,
    refetchInterval: POLL_MS,
  });
}

export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: ["notifications", "list"],
    queryFn: async () =>
      (await api.get<Paginated<AppNotification>>("/notifications/", { params: { page_size: 15 } })).data,
    enabled,
    refetchInterval: enabled ? POLL_MS : false,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await api.post<AppNotification>(`/notifications/${id}/mark-read/`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post<{ marked: number }>("/notifications/mark-all-read/")).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
