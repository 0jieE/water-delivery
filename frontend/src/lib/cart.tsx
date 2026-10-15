import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Service } from "./types";

// Prices here are only for display; the server recomputes every total from current prices.
export interface CartLine {
  serviceId: number;
  name: string;
  price: string;
  quantity: number;
}

interface CartApi {
  lines: CartLine[];
  count: number;
  total: number;
  add: (service: Service, quantity?: number) => void;
  setQuantity: (serviceId: number, quantity: number) => void;
  remove: (serviceId: number) => void;
  clear: () => void;
}

const STORAGE_KEY = "cart";
export const MAX_QTY = 500;
export const MAX_LINES = 20;

const CartContext = createContext<CartApi | null>(null);

function load(): CartLine[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* ignore */
    }
  }, [lines]);

  const add = useCallback((service: Service, quantity = 1) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.serviceId === service.id);
      if (existing) {
        return prev.map((l) =>
          l.serviceId === service.id
            ? { ...l, price: service.price, quantity: Math.min(MAX_QTY, l.quantity + quantity) }
            : l
        );
      }
      if (prev.length >= MAX_LINES) return prev;
      return [
        ...prev,
        { serviceId: service.id, name: service.service_name, price: service.price, quantity },
      ];
    });
  }, []);

  const setQuantity = useCallback((serviceId: number, quantity: number) => {
    setLines((prev) =>
      prev.map((l) =>
        l.serviceId === serviceId ? { ...l, quantity: Math.max(1, Math.min(MAX_QTY, Math.floor(quantity) || 1)) } : l
      )
    );
  }, []);

  const remove = useCallback((serviceId: number) => {
    setLines((prev) => prev.filter((l) => l.serviceId !== serviceId));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartApi>(
    () => ({
      lines,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      total: lines.reduce((sum, l) => sum + Number(l.price) * l.quantity, 0),
      add,
      setQuantity,
      remove,
      clear,
    }),
    [lines, add, setQuantity, remove, clear]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartApi {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
