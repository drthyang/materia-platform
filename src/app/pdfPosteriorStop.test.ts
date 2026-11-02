import { describe, it, expect } from "vitest";
import { ComputeClient } from "@/workers/computeClient";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { pdfPage, pdfPosterior, reportInputOf, withPosterior, type PdfPageModel } from "@/app/pdfPage";

/**
 * Stop on the PDF page's Posterior, through the real client (in this thread
 * here: the sampler waits a macrotask per batch, so the Stop lands between
 * batches). The stopped run comes back marked, its chain a shorter run's; the
 * page's report never carries it; and a fresh run after it is a clean run.
 */

function demoPage(): PdfPageModel {
  const demo = gata4se8PdfExample();
  return pdfPage(demo.structure, demo.pattern, { preset: { values: demo.refinedParams, fitRange: { min: 1.5, max: 6 } } });
}

describe("the PDF page's posterior Stop", () => {
  it("stops promptly, keeps the partial run marked, keeps it out of the report, and a rerun is clean", async () => {
    const client = new ComputeClient();
    const m = demoPage();
    const stop = new AbortController();
    let askedAt = 0;
    const out = await pdfPosterior(client, m, false, 40, (s) => {
      if (s === 6) {
        askedAt = performance.now();
        stop.abort();
      }
    }, stop.signal);
    const tookMs = performance.now() - askedAt;
    expect(tookMs).toBeLessThan(1000);
    const res = out.sample.result;
    expect(res.stopped?.atStep).toBe(6);
    expect(res.stopped?.plannedStep).toBe(40);
    expect(res.status).toBe("not-converged");
    // The chain is exactly a 6-step run's.
    const six = await pdfPosterior(new ComputeClient(), m, false, 6);
    expect(res.resume).toEqual(six.sample.result.resume);

    // On the page, the partial run is the Posterior tab's only: the report is the same without it.
    const withStopped = withPosterior(m, out.sample, out.key);
    expect(withStopped.sample?.result.stopped).toBeDefined();
    expect(JSON.stringify(reportInputOf(withStopped))).toBe(JSON.stringify(reportInputOf(m)));

    // A fresh run on the same client afterwards: nothing of the stopped one left in it.
    const again = await pdfPosterior(client, withStopped, false, 8);
    const clean = await pdfPosterior(new ComputeClient(), m, false, 8);
    expect(again.sample.result.stopped).toBeUndefined();
    expect(again.sample.result.chains).toEqual(clean.sample.result.chains);
    expect(again.sample.result.resume).toEqual(clean.sample.result.resume);
  }, 120_000);
});
