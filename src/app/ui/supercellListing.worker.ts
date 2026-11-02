/**
 * The By subgroup view's cell-multiplying rows, off the main thread: one
 * listing per worker (supercellListing.ts), its events posted as they come.
 * The page terminates the worker to stop it.
 */
import { supercellListingSteps, type ListingEvent, type ListingInput } from "@/app/ui/supercellListing";

const post = (e: ListingEvent): void => (self as DedicatedWorkerGlobalScope).postMessage(e);

self.addEventListener("message", (event: MessageEvent<ListingInput>) => {
  let last = -1;
  try {
    for (const e of supercellListingSteps(event.data, { latticeProgress: (percent) => { if (percent !== last) { last = percent; post({ type: "progress", percent }); } } })) post(e);
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
});
