import { describe, it, expect } from "vitest";
import { parseCif } from "@/parsers/cif";
import { parseInstrumentParameters } from "@/parsers/instrument";
import { parseGsasHistogramPattern } from "@/parsers/gsasHistogram";
import { dFromTof } from "@/core/diffraction/instrument";
import { detectExtraPeaks } from "@/core/magnetic/extraPeaks";
import { searchPropagationVector } from "@/core/magnetic/kSearch";
import { dataExists, readData, LOCAL_DATA, LOCAL_REFERENCES } from "@/testSupport/data";

/**
 * End-to-end magnetic propagation-vector search on **real** POWGEN neutron data:
 * the local magnetic TOF dataset (`LOCAL_DATA.magneticTof`, unpublished). Below
 * the ordering temperature the pattern grows satellites that are absent in the
 * paramagnetic state.
 *
 * The pipeline mirrors the M2 workflow: take the 6 K (ordered) and a
 * paramagnetic reference pattern for the *same* detector bank (identical SLOG
 * TOF grid), scale the reference on the high-Q half where magnetism is
 * negligible, detect the extra (magnetic) peaks in the difference, convert their
 * TOF to d via the bank calibration, and rank candidate k. The known k (the
 * reference's, from data/local-references.json) tops the ranking. Skips when
 * the git-ignored data/ folder is absent.
 */

const CIF = `${LOCAL_DATA.magneticTof}/structure_100K.cif`;
const INST = `${LOCAL_DATA.magneticTof}/instrument_bank3.instprm`;
const LOW_6K = `${LOCAL_DATA.magneticTof}/PG3_powder_6K.gsa`; // 6 K, bank 3 — magnetically ordered
const PARA_100K = `${LOCAL_DATA.magneticTof}/PG3_powder_100K.gsa`; // 100 K, bank 3 — paramagnetic reference
const K = LOCAL_REFERENCES?.magneticTof?.k;
const has = !!K && dataExists(CIF) && dataExists(INST) && dataExists(LOW_6K) && dataExists(PARA_100K);

describe.skipIf(!has)("real local magnetic TOF data — k-search from the ordered POWGEN pattern", () => {
  it("recovers the reference k from the 6 K − paramagnetic magnetic peaks", () => {
    const s = parseCif(readData(CIF), "local");
    const inst = parseInstrumentParameters(readData(INST));
    expect(inst.kind).toBe("tof");
    if (inst.kind !== "tof") return;

    const low = parseGsasHistogramPattern(readData(LOW_6K), "low", "ordered");
    const ref = parseGsasHistogramPattern(readData(PARA_100K), "ref", "paramagnetic");
    // Same bank ⇒ same SLOG grid, so the two patterns subtract point-for-point.
    expect(ref.points.length).toBe(low.points.length);

    const dArr = low.points.map((p) => dFromTof(inst, p.x));
    const yLow = low.points.map((p) => p.yObs);
    const yRef = ref.points.map((p) => p.yObs);

    // Scale the paramagnetic reference to the ordered pattern using the high-Q
    // half (d < 2 Å), where magnetic scattering has died off, so only the nuclear
    // intensities set the scale.
    let sumLow = 0;
    let sumRef = 0;
    for (let i = 0; i < dArr.length; i++) {
      if (dArr[i]! < 2) {
        sumLow += yLow[i]!;
        sumRef += yRef[i]!;
      }
    }
    const scale = sumRef > 0 ? sumLow / sumRef : 1;
    const yCalc = yRef.map((y) => y * scale);

    // Extra (magnetic) peaks: positive residual over the paramagnetic reference.
    const peaks = detectExtraPeaks(dArr, yLow, yCalc, { sigma: 8, minFraction: 0.05, limit: 30 });
    expect(peaks.length).toBeGreaterThan(3);

    const candidates = searchPropagationVector(s.cell, peaks.map((p) => p.d), { tolerance: 0.03 });
    // The known propagation vector tops the ranking, explaining several satellites…
    expect(candidates[0]!.k).toEqual(K);
    expect(candidates[0]!.matched).toBeGreaterThanOrEqual(3);
    // …and beats the same k along the other two axes on matched-peak count.
    const matchOf = (k: readonly number[]): number =>
      candidates.find((c) => c.k[0] === k[0] && c.k[1] === k[1] && c.k[2] === k[2])?.matched ?? 0;
    const k = K!;
    for (const other of [[k[1], k[2], k[0]], [k[2], k[0], k[1]]]) {
      if (other.every((x, i) => x === k[i])) continue;
      expect(matchOf(k)).toBeGreaterThan(matchOf(other));
    }
  });
});
