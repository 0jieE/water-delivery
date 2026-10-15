import { useSyncExternalStore } from "react";
import type { Role, User } from "./types";

export type { Role } from "./types";

const KEYS = { access: "access", refresh: "refresh", role: "role", user: "user" } as const;

interface Session {
  access: string | null;
  refresh: string | null;
  role: Role | null;
  user: User | null;
}

const ROLES: Role[] = ["admin", "staff", "rider", "customer"];

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable; session lives for this page load only */
  }
}

/** Decode the payload of a JWT (no signature check; the API is the authority). */
export function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(payload)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function asRole(value: unknown): Role | null {
  return ROLES.includes(value as Role) ? (value as Role) : null;
}

function readSession(): Session {
  const access = safeGet(KEYS.access);
  const refresh = safeGet(KEYS.refresh);
  let user: User | null = null;
  try {
    const raw = safeGet(KEYS.user);
    user = raw ? (JSON.parse(raw) as User) : null;
  } catch {
    user = null;
  }
  // The role claim in the JWT is the source of truth; fall back to the stored copy.
  const claimRole = access ? asRole(decodeJwt(access)?.role) : null;
  const role = claimRole ?? asRole(safeGet(KEYS.role));
  return { access, refresh, role: access || refresh ? role : null, user };
}

let session: Session = readSession();
const listeners = new Set<() => void>();

function commit(next: Session) {
  session = next;
  safeSet(KEYS.access, next.access);
  safeSet(KEYS.refresh, next.refresh);
  safeSet(KEYS.role, next.role);
  safeSet(KEYS.user, next.user ? JSON.stringify(next.user) : null);
  listeners.forEach((l) => l());
}

// Keep tabs in sync (logging out in one tab logs out the others).
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key && !Object.values(KEYS).includes(e.key as never)) return;
    session = readSession();
    listeners.forEach((l) => l());
  });
}

export function getAccessToken() {
  return session.access;
}
export function getRefreshToken() {
  return session.refresh;
}
export function getRole(): Role | null {
  return session.role;
}
export function getUser() {
  return session.user;
}

export function setSession(data: { access: string; refresh: string; user: User }) {
  const role = asRole(decodeJwt(data.access)?.role) ?? data.user.role;
  commit({ access: data.access, refresh: data.refresh, role, user: data.user });
}

/** After a token refresh only the access token changes (refresh tokens are not rotated). */
export function setAccessToken(access: string) {
  const role = asRole(decodeJwt(access)?.role) ?? session.role;
  commit({ ...session, access, role });
}

export function setUser(user: User) {
  commit({ ...session, user });
}

export function clearSession() {
  commit({ access: null, refresh: null, role: null, user: null });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSession() {
  return useSyncExternalStore(subscribe, () => session);
}

/** Landing page for each role. */
export function homePathFor(role: Role | null): string {
  switch (role) {
    case "customer":
      return "/customer";
    case "staff":
      return "/staff";
    case "admin":
      return "/admin";
    case "rider":
      return "/rider";
    default:
      return "/login";
  }
}
