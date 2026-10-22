import Icon from "./Icon";

/** The little circle that follows your finger while you pull down to refresh. */
export default function PullIndicator({
  pull,
  refreshing,
  threshold,
  className = "fixed left-1/2 top-16 z-40",
}: {
  pull: number;
  refreshing: boolean;
  threshold: number;
  className?: string;
}) {
  if (pull <= 0 && !refreshing) return null;
  const progress = Math.min(1, pull / threshold);
  return (
    <div
      className={`pointer-events-none ${className} -translate-x-1/2`}
      style={{ transform: `translate(-50%, ${Math.min(pull, 80) - 24}px)`, opacity: Math.max(0.25, progress) }}
      role="status"
      aria-label={refreshing ? "Refreshing" : "Pull to refresh"}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-water-600 shadow-lift ring-1 ring-slate-200">
        <Icon
          name="refresh"
          className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`}
          strokeWidth={2}
        />
      </span>
    </div>
  );
}
