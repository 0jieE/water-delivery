import { useServerSlow } from "@/lib/serverStatus";
import { Spinner } from "./ui";

/** A slim bar at the very top while the API is slow to answer (typically a sleeping free-tier server). */
export default function ServerNotice() {
  const slow = useServerSlow();
  if (!slow) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[70] flex animate-fade-in items-center justify-center gap-2.5 bg-slate-900 px-4 py-2 text-center text-xs font-medium text-white shadow-lift"
    >
      <Spinner className="h-3.5 w-3.5 flex-none text-white" />
      <span>Still working… the server may be waking up. The first request after a pause can take up to a minute.</span>
    </div>
  );
}
