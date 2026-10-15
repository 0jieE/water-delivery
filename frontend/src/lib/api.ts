import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { clearSession, getAccessToken, getRefreshToken, setAccessToken } from "./auth";
import type { ApiErrorInfo } from "./types";

const baseURL = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api";

export const api = axios.create({ baseURL });

// A bare client with no interceptors, used only for the refresh call so it can never loop.
const bare = axios.create({ baseURL });

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

/**
 * Login, token refresh and registration must go out *without* a Bearer header: DRF rejects an
 * expired token with 401 even on endpoints that would otherwise be public.
 */
function isAnonymousAuthUrl(url?: string) {
  if (!url) return false;
  return /\/auth\/(token|register)\//.test(url.startsWith("/") ? url : `/${url}`);
}

api.interceptors.request.use((config) => {
  if (isAnonymousAuthUrl(config.url)) return config;
  const token = getAccessToken();
  if (token) config.headers.set("Authorization", `Bearer ${token}`);
  return config;
});

// One in-flight refresh shared by every request that hits 401 at the same time.
let refreshing: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refresh = getRefreshToken();
  if (!refresh) throw new Error("No refresh token");
  const res = await bare.post<{ access: string }>("/auth/token/refresh/", { refresh });
  setAccessToken(res.data.access); // refresh tokens are not rotated: only `access` comes back
  return res.data.access;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    if (error.response?.status !== 401 || !original || isAnonymousAuthUrl(original.url)) {
      return Promise.reject(error);
    }
    // Not signed in at all: nothing to refresh, let the route guard handle it.
    if (!getRefreshToken()) return Promise.reject(error);

    // We already retried once with a fresh token and it still failed: the session is dead.
    if (original._retry) {
      clearSession();
      return Promise.reject(error);
    }
    original._retry = true;

    try {
      refreshing ??= refreshAccessToken().finally(() => {
        refreshing = null;
      });
      const access = await refreshing;
      original.headers.set("Authorization", `Bearer ${access}`);
      return api(original);
    } catch (refreshError) {
      // Only an explicit rejection of the refresh token ends the session; a network blip does not.
      const status = axios.isAxiosError(refreshError) ? refreshError.response?.status : undefined;
      if (status === 401 || status === 400 || !axios.isAxiosError(refreshError)) clearSession();
      return Promise.reject(error);
    }
  }
);

// ---------------------------------------------------------------------------------------------
// Error handling (API.md §1.1: { detail, code, errors })
// ---------------------------------------------------------------------------------------------

export function parseApiError(err: unknown): ApiErrorInfo {
  if (axios.isAxiosError(err)) {
    if (!err.response) {
      return {
        status: null,
        code: "network_error",
        detail: "Cannot reach the server. Check your connection and try again.",
        errors: {},
      };
    }
    const data = err.response.data as Partial<ApiErrorInfo> | string | undefined;
    if (data && typeof data === "object") {
      return {
        status: err.response.status,
        code: data.code ?? "error",
        detail: data.detail ?? "Something went wrong.",
        errors: (data.errors as Record<string, unknown>) ?? {},
      };
    }
    return {
      status: err.response.status,
      code: "error",
      detail:
        err.response.status >= 500
          ? "The server had a problem. Please try again later."
          : "Something went wrong.",
      errors: {},
    };
  }
  return {
    status: null,
    code: "error",
    detail: err instanceof Error ? err.message : "Something went wrong.",
    errors: {},
  };
}

/** Errors on `responseType: 'blob'` requests arrive as a Blob; read the JSON out of it first. */
export async function parseBlobError(err: unknown): Promise<ApiErrorInfo> {
  if (axios.isAxiosError(err) && err.response?.data instanceof Blob) {
    try {
      const body = JSON.parse(await err.response.data.text());
      return {
        status: err.response.status,
        code: body.code ?? "error",
        detail: body.detail ?? "Something went wrong.",
        errors: body.errors ?? {},
      };
    } catch {
      /* fall through */
    }
  }
  return parseApiError(err);
}

/** Flatten `errors` into { field: "message" }. Non-string/nested values are skipped. */
export function fieldErrors(info: ApiErrorInfo): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(info.errors)) {
    if (Array.isArray(value) && value.every((v) => typeof v === "string") && value.length) {
      out[key] = value.join(" ");
    } else if (typeof value === "string") {
      out[key] = value;
    }
  }
  return out;
}

/** A single readable sentence for toasts / banners. */
export function errorMessage(err: unknown, info: ApiErrorInfo = parseApiError(err)): string {
  if (info.detail !== "Invalid input.") return info.detail;
  const flat = Object.entries(fieldErrors(info)).map(([k, v]) =>
    k === "non_field_errors" ? v : `${k.replace(/_/g, " ")}: ${v}`
  );
  return flat.length ? flat.join(" ") : info.detail;
}

// ---------------------------------------------------------------------------------------------
// File downloads (reports, backups): need the Authorization header, so go through Axios.
// ---------------------------------------------------------------------------------------------

function filenameFrom(disposition: unknown, fallback: string) {
  if (typeof disposition !== "string") return fallback;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return match ? decodeURIComponent(match[1]) : fallback;
}

export async function downloadFile(
  url: string,
  params: Record<string, string | number | undefined>,
  fallbackName: string
) {
  let res;
  try {
    res = await api.get<Blob>(url, { params, responseType: "blob" });
  } catch (err) {
    const info = await parseBlobError(err);
    throw Object.assign(new Error(info.detail), { info });
  }
  const link = document.createElement("a");
  const href = URL.createObjectURL(res.data);
  link.href = href;
  link.download = filenameFrom(res.headers["content-disposition"], fallbackName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}
