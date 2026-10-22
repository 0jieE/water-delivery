import { useEffect, useRef, useState, type RefObject } from "react";

const THRESHOLD = 64; // px of (damped) pull needed to trigger a refresh
const MAX_PULL = 96;

/**
 * Pull-to-refresh for touch screens: drag down from the very top of the page (or of `scroller`) and release.
 * Does nothing on desktop (no touch events), inside maps / form fields / dialogs, or when the page isn't at the top.
 */
export function usePullToRefresh(onRefresh: () => Promise<unknown>, scroller?: RefObject<HTMLElement | null>) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const state = useRef({ startY: 0, startX: 0, tracking: false, pull: 0, busy: false });
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  useEffect(() => {
    const s = state.current;
    const top = () => (scroller?.current ? scroller.current.scrollTop : window.scrollY);

    function start(e: TouchEvent) {
      const target = e.target instanceof Element ? e.target : null; // never assume: could be the document or a text node
      s.tracking =
        !s.busy &&
        e.touches.length === 1 &&
        top() <= 0 &&
        !target?.closest(".leaflet-container, input, textarea, select, [role=dialog], [data-no-pull]");
      s.startY = e.touches[0].clientY;
      s.startX = e.touches[0].clientX;
      s.pull = 0;
    }

    function move(e: TouchEvent) {
      if (!s.tracking) return;
      const dy = e.touches[0].clientY - s.startY;
      const dx = Math.abs(e.touches[0].clientX - s.startX);
      // Mostly-horizontal drags (swiping a chip row, say) and upward drags are not pulls.
      if (dy <= 0 || dx > dy || top() > 0) {
        if (s.pull) {
          s.pull = 0;
          setPull(0);
        }
        return;
      }
      s.pull = Math.min(MAX_PULL, dy * 0.5); // damped, so it feels elastic
      if (e.cancelable && dy > 8) e.preventDefault(); // stop the browser's own overscroll from competing
      setPull(s.pull);
    }

    async function end() {
      if (!s.tracking) return;
      s.tracking = false;
      if (s.pull >= THRESHOLD) {
        s.busy = true;
        setRefreshing(true);
        setPull(THRESHOLD);
        try {
          await refresh.current();
        } finally {
          // Keep the spinner up for a beat so a very fast refresh still feels acknowledged.
          setTimeout(() => {
            s.busy = false;
            setRefreshing(false);
            setPull(0);
          }, 350);
        }
      } else {
        setPull(0);
      }
      s.pull = 0;
    }

    document.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end);
    document.addEventListener("touchcancel", end);
    return () => {
      document.removeEventListener("touchstart", start);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", end);
    };
  }, [scroller]);

  return { pull, refreshing, threshold: THRESHOLD };
}
