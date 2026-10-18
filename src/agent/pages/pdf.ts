/**
 * The PDF page for the executor (types.ts).
 */

import type { PdfAgentPort } from "@/agent/port";
import { changePdf, describePdfChange, pdfNoOp, pdfReferences, pdfReportChecks, readPdfTool } from "@/agent/pdfTools";
import { pdfAnalysis } from "@/agent/method";
import type { PageAdapter } from "@/agent/pages/types";
import { stampOf } from "@/agent/pages/stamp";

export const PDF_PAGE: PageAdapter<PdfAgentPort> = {
  page: "pdf",
  own: (port) => (port.technique === "pdf" ? port : null),
  state: (port) => port.state(),
  analysis: pdfAnalysis,
  stamp: (s) => stampOf(s.parameters, { fitRange: s.fitRange, adpModel: s.adpModel }),
  // Uniform weights: Rw is relative only, and there is no GoF.
  agreementKey: "Rw",
  agreement: (s) => s.rw,
  figures: () => ({}),
  start: () => ({}),
  references: pdfReferences,
  reportChecks: (s, probe) => pdfReportChecks(s, probe),
  assemblies: () => new Map(),
  read: (name, input, port, host) => readPdfTool(name, input, port, host),
  noOp: (spec, input, s) => pdfNoOp(spec, input, s),
  describe: (spec, input, s) => describePdfChange(spec, input, s),
  change: (name, input, port, host) => changePdf(name, input, port, host),
};
