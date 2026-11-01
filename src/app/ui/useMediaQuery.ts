/**
 * Whether a CSS media query matches, following the window as it changes (a
 * phone turned on its side, a keyboard and trackpad attached). Read once at
 * first render, so a component lays out for the window it opens in without a
 * flash of the other layout.
 */

import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const get = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = (): void => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}
