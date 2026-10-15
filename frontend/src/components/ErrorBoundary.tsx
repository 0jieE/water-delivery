import { Component, type ErrorInfo, type ReactNode } from "react";
import Icon from "./Icon";

interface Props {
  children: ReactNode;
  /** What to show instead of the crashed subtree. Omit for the full "something went wrong" screen; pass `null` to just hide it. */
  fallback?: ReactNode;
  /** When this value changes (e.g. the route), a crashed boundary tries again. */
  resetKey?: string;
}

/**
 * Catches render errors so one broken component can't blank the whole app. A bad response or an
 * unexpected value then shows a friendly message (or nothing, for optional widgets) instead of a white page.
 */
export default class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI error:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 py-16 text-center" role="alert">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-red-500 ring-8 ring-red-50/60">
          <Icon name="warning" className="h-8 w-8" />
        </span>
        <h1 className="text-xl font-bold">Something went wrong</h1>
        <p className="max-w-sm text-sm leading-relaxed text-slate-500">
          This page hit an unexpected problem. Reloading usually fixes it. If it keeps happening, please tell the station staff.
        </p>
        <div className="mt-2 flex gap-2">
          <button className="btn-primary" onClick={() => window.location.reload()}>
            <Icon name="refresh" className="h-4 w-4" /> Reload
          </button>
          <a className="btn-secondary" href="/">
            Go to home
          </a>
        </div>
      </div>
    );
  }
}
