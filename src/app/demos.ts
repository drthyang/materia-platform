/**
 * The bundled demos — one converged (or self-consistent) snapshot per workflow,
 * offered on the landing page. One list, one id type, so adding a demo is one
 * entry here plus its loader in the shell.
 */

export type DemoId = "rietveld" | "pdf" | "magnetic";

export interface DemoEntry {
  readonly id: DemoId;
  /** Needs files from the git-ignored data folder (dev server only): offered
   *  only when they are reachable, never in the public build. */
  readonly local?: boolean;
  /** Landing card: kicker (workflow), title (material), blurb (what opens). */
  readonly kicker: string;
  readonly title: string;
  readonly blurb: string;
}

export const DEMOS: readonly DemoEntry[] = [
  {
    id: "rietveld",
    kicker: "Rietveld · reciprocal space",
    title: "Mn₃Ga neutron TOF",
    blurb: "Two-phase POWGEN fit at 600 K (paramagnetic, with a MnO impurity) · wR 4.2%",
  },
  {
    id: "magnetic",
    local: true,
    kicker: "Magnetic · k ≠ 0 antiferromagnet · local data",
    title: "Local magnetic TOF dataset",
    blurb: "POWGEN data from the local data folder · opens on the magnetic page with the group selected",
  },
  {
    id: "pdf",
    kicker: "PDF · real space",
    title: "GaTa₄Se₈ X-ray G(r)",
    blurb: "Synchrotron total-scattering fit at 299 K · Rw 8.1%",
  },
];
