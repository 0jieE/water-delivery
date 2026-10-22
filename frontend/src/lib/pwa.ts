import { useSyncExternalStore } from "react";
import { registerSW } from "virtual:pwa-register";

/*
 * Everything the app needs to behave like an installed app:
 *  - registering the service worker and telling the user when a new version is ready,
 *  - knowing whether the device is online,
 *  - the "install" prompt (Chrome/Edge/Android) and a hint for iOS, which has no prompt API.
 */

type Listener = () => void;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: Listener) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

// ---- updates ----------------------------------------------------------------------------------

let needRefresh = false;
let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined;

export function initPwa() {
  updateSW = registerSW({
    onNeedRefresh() {
      needRefresh = true;
      emit();
    },
    onRegisteredSW(_url, registration) {
      // A long-lived tab (a rider's phone all day) should still notice new versions.
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
  });
}

/** Activate the waiting version and reload. Only ever called from the user's "Update" tap. */
export function applyUpdate() {
  void updateSW?.(true);
}

export const useNeedRefresh = () => useSyncExternalStore(subscribe, () => needRefresh);

// ---- online / offline -------------------------------------------------------------------------

function subscribeOnline(listener: Listener) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine);

// ---- install ----------------------------------------------------------------------------------

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep it so our own button can trigger it
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
}

/** True when the app is already running as an installed app (not in a browser tab). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ pretends to be a Mac, so also check for a touchscreen.
  return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export const useCanInstall = () => useSyncExternalStore(subscribe, () => deferred !== null);
export const useInstalled = () => useSyncExternalStore(subscribe, () => installed || isStandalone());

/** Show the browser's install dialog. Resolves to whether the user accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  deferred = null; // a prompt can only be used once
  emit();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === "accepted";
}
