/**
 * The powder page for the executor (types.ts). Its magnetic analysis step's
 * tools run here too, through the step's handle on the powder port
 * (magneticTools.ts).
 */

import type { PowderAgentPort } from "@/agent/port";
import type { MagneticPanelState } from "@/agent/magneticPort";
import { POWDER_PLANS, powderReferences, powderReportChecks, readPowderTool, refineChecks, requireStructure } from "@/agent/powderTools";
import { isMagneticTool, magneticOutcome, readMagneticTool } from "@/agent/magneticTools";
import { powderAnalysis } from "@/agent/method";
import type { PageAdapter } from "@/agent/pages/types";
import { planFrom } from "@/agent/pages/plans";
import { sig6, stampOf } from "@/agent/pages/stamp";

/** The magnetic step's settings: k, the ions, the moment ties, the group chosen and its moments. */
function stepSettings(step: MagneticPanelState | null): unknown {
  if (!step) return null;
  const selected = step.selected ? [step.selected.id, step.selected.parameters.map((p) => [p.id, sig6(p.value), p.tiedTo ?? ""])] : null;
  return [step.k, step.ions.filter((i) => i.selected).map((i) => i.label), step.ties, selected];
}

const powderPlan = planFrom(POWDER_PLANS);

export const POWDER_PAGE: PageAdapter<PowderAgentPort> = {
  page: "powder",
  own: (port) => (port.technique === "powder" ? port : null),
  state: (port) => port.state(),
  analysis: powderAnalysis,
  stamp: (s, step) => stampOf(s.parameters, {
    fitRange: s.fitRange,
    settings: s.settings,
    // The X-ray constants (polarization, Kα₂ ratio) live on the radiation.
    radiation: s.pattern.radiation,
    phases: [s.structure, ...s.extraPhases].map((p) => p.id),
    magnetic: s.magnetic ? [s.magnetic.id, s.magnetic.propagation, s.magnetic.moments.map((m) => [m.siteLabel, m.components.map(sig6)])] : null,
    step: stepSettings(step),
  }),
  agreementKey: "wR",
  agreement: (s) => s.wR,
  figures: (_before, _after, r) => ({ gof: r.agreement.goodnessOfFit !== undefined ? Number(r.agreement.goodnessOfFit.toPrecision(4)) : null }),
  start: () => ({}),
  references: powderReferences,
  reportable: (s) => requireStructure("refine", s),
  reportChecks: (s, probe) => powderReportChecks(s, probe),
  assemblies: () => new Map(),
  magneticStep: (port) => port.magnetic?.()?.state() ?? null,
  magneticModel: (s) => s.magnetic !== null,
  read: (name, input, port, host) => (isMagneticTool(name) ? readMagneticTool(name, input, port) : readPowderTool(name, input, port, host)),
  // A change that needs a structure is refused on the placeholder before it is planned.
  plan: (spec, input, s, port) => {
    requireStructure(spec.name, s);
    return powderPlan(spec, input, s, port);
  },
  outcome: (name, port) => (isMagneticTool(name) ? magneticOutcome(name, port) : name === "refine" ? refineChecks(port.state()) : {}),
};
