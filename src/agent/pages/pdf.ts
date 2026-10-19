/**
 * The PDF page for the executor (types.ts).
 */

import type { PdfAgentPort } from "@/agent/port";
import { PDF_PLANS, pdfReferences, pdfReportChecks, readPdfTool } from "@/agent/pdfTools";
import { planFrom } from "@/agent/pages/plans";
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
  plan: planFrom(PDF_PLANS),
};
