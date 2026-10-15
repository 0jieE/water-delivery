import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axios from "axios";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { CartProvider } from "./lib/cart";
import "@fontsource-variable/inter";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Client errors (400/403/404) won't fix themselves; only retry network/server hiccups.
      retry: (failureCount, error) => {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status && status < 500) return false;
        return failureCount < 2;
      },
      staleTime: 5_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <CartProvider>
            <App />
          </CartProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
