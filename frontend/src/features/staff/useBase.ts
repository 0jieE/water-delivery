import { useLocation } from "react-router-dom";

/** Staff pages are mounted under /staff and again under /admin; links must stay in the current one. */
export function useBase(): "/admin" | "/staff" {
  return useLocation().pathname.startsWith("/admin") ? "/admin" : "/staff";
}
