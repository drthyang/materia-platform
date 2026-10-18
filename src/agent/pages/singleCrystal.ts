/**
 * The single-crystal page for the executor (types.ts).
 */

import type { SingleCrystalAgentPort } from "@/agent/port";
import { changeSingleCrystal, describeSingleCrystalChange, keptMeasurements, readSingleCrystalTool, singleCrystalNoOp, singleCrystalReferences, singleCrystalReportChecks } from "@/agent/scTools";
import { disorderAssemblies } from "@/agent/correlationCheck";
import { singleCrystalAnalysis } from "@/agent/method";
import { pct } from "@/agent/liveCommon";
import type { PageAdapter } from "@/agent/pages/types";
import { stampOf } from "@/agent/pages/stamp";

export const SINGLE_CRYSTAL_PAGE: PageAdapter<SingleCrystalAgentPort> = {
  page: "singleCrystal",
  own: (port) => (port.technique === "singleCrystal" ? port : null),
  state: (port) => port.state(),
  analysis: singleCrystalAnalysis,
  stamp: (s) => stampOf(s.parameters, {
    probe: s.probe,
    radiation: s.dataset.radiation,
    merged: !!s.dataset.merged,
    resolution: [s.resolution.dMin ?? null, s.resolution.dMax ?? null],
    filter: [s.outlierFilter.on, s.outlierFilter.cutoffSigma, s.outlierFilter.minExtinction ?? null],
    omitted: s.omitted,
    weighting: s.weighting,
    extinctionModel: s.extinctionModel,
    twinLaws: s.twinLaws,
    restraints: s.distanceRestraints,
    riding: s.riding,
    adpModel: s.adpModel,
    inverted: s.inverted ?? null,
  }),
  // SHELX's wR2 on F², with R1 beside it.
  agreementKey: "wR2",
  agreement: (s) => s.agreement.wr2,
  figures: (before, after) => ({ R1: pct(after.agreement.r1), R1Before: pct(before.agreement.r1), GooF: Number(after.agreement.goof.toPrecision(4)) }),
  start: (s) => ({ r1: s.agreement.r1 }),
  references: singleCrystalReferences,
  reportChecks: (s, probe, record) => singleCrystalReportChecks(s, probe, keptMeasurements(record)),
  // SHELXL's PART groups: pairs within one are listed, not stopped.
  assemblies: (s) => disorderAssemblies(s.structure, s.bindings, s.twinLaws),
  read: (name, input, port, host) => readSingleCrystalTool(name, input, port, host),
  noOp: (spec, input, s) => singleCrystalNoOp(spec, input, s),
  describe: (spec, input, s) => describeSingleCrystalChange(spec, input, s),
  change: (name, input, port, host) => changeSingleCrystal(name, input, port, host),
};
