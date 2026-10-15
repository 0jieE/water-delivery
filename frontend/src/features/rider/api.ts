import axios from "axios";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { setUser } from "@/lib/auth";
import { POLL_MS } from "@/lib/format";
import { invalidateOrderData } from "@/lib/queries";
import type { Delivery, MyCash, Paginated, Rider, RiderStatus, User } from "@/lib/types";

/** `active` = every scheduled + out-for-delivery order of any date (in-progress first). */
export type DeliveryScope = "today" | "upcoming" | "history" | "active";

export function useDeliveries(scope: DeliveryScope, page = 1) {
  return useQuery({
    queryKey: ["deliveries", "list", scope, page],
    queryFn: async () =>
      (await api.get<Paginated<Delivery>>("/deliveries/my/", { params: { scope, page, page_size: 20 } })).data,
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
  });
}

/** `{id}` is the ORDER id (API.md §9). */
export function useDelivery(id: string | undefined) {
  return useQuery({
    queryKey: ["deliveries", "detail", String(id)],
    queryFn: async () => {
      // The API returns only active orders by default; finished ones (delivered / failed) need ?scope=history.
      try {
        return (await api.get<Delivery>(`/deliveries/my/${id}/`)).data;
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          return (await api.get<Delivery>(`/deliveries/my/${id}/`, { params: { scope: "history" } })).data;
        }
        throw err;
      }
    },
    enabled: id !== undefined,
    refetchInterval: POLL_MS,
  });
}

export interface StatusUpdate {
  status: "out_for_delivery" | "delivered" | "failed";
  remarks?: string;
  cod_collected?: boolean;
}

export function useDeliveryStatus(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: StatusUpdate) => (await api.post<Delivery>(`/deliveries/my/${id}/status/`, body)).data,
    onSuccess: async (delivery) => {
      qc.setQueryData(["deliveries", "detail", String(id)], delivery);
      await Promise.all([invalidateOrderData(qc), qc.invalidateQueries({ queryKey: ["me"] })]);
    },
  });
}

/**
 * Start several scheduled deliveries at once (POST deliveries/my/start/). All-or-nothing: if any
 * order can't be started the server changes nothing and names the order in `errors.orders`.
 */
export function useStartDeliveries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orders: number[]) => (await api.post<Delivery[]>("/deliveries/my/start/", { orders })).data,
    onSuccess: async (deliveries) => {
      for (const d of deliveries) qc.setQueryData(["deliveries", "detail", String(d.id)], d);
      await Promise.all([invalidateOrderData(qc), qc.invalidateQueries({ queryKey: ["me"] })]);
    },
  });
}

/** Cash the signed-in rider has collected on COD orders and not yet handed in. */
export function useMyCash() {
  return useQuery({
    queryKey: ["cash", "mine"],
    queryFn: async () => (await api.get<MyCash>("/deliveries/my/cash/")).data,
    refetchInterval: POLL_MS,
  });
}

/** The rider's own profile (carries `rider_profile.status`), polled so the status chip stays current. */
export function useRiderMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => (await api.get<User>("/auth/me/")).data,
    refetchInterval: POLL_MS,
  });
}

export function useAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (status: Extract<RiderStatus, "available" | "off_duty">) =>
      (await api.post<Rider>("/deliveries/my/availability/", { status })).data,
    onSuccess: async () => {
      const me = await api.get<User>("/auth/me/");
      setUser(me.data);
      qc.setQueryData(["me"], me.data);
    },
  });
}
