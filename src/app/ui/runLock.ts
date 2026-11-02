/**
 * Refinement and posterior sampling never run together: both drive the
 * compute client's one evaluator pool, so a second run would take it over
 * from under the first. While one runs the other's buttons are disabled, with
 * the reason as their title. One rule for both pages and every place the
 * buttons sit (the parameter card, the phone's run bar, the Posterior tab).
 */

/** Title of a Refine / Prefit / Escape min held while the sampler runs. */
export const SAMPLING_BLOCKS_REFINE = "Sampling the posterior; stop it first";
/** Title of a Sample posterior / Continue held while a refinement runs. */
export const REFINING_BLOCKS_SAMPLING = "A refinement is running; wait for it or cancel it first";

/** Why each kind of run is held right now (null: free to start). */
export function runLock(state: { readonly refining: boolean; readonly sampling: boolean }): { readonly refine: string | null; readonly sample: string | null } {
  return {
    refine: state.sampling ? SAMPLING_BLOCKS_REFINE : null,
    sample: state.refining ? REFINING_BLOCKS_SAMPLING : null,
  };
}
