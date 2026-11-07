/**
 * The shape of `data/local-references.json`: the reference values the
 * data-gated tests compare with. They are numbers (and site labels) from the
 * owner's own refinements of the unpublished local datasets, so they stay in
 * the git-ignored data folder with the data; `testSupport/data.ts` reads the
 * file (`LOCAL_REFERENCES`), and each test skips when its block is absent.
 *
 * Every field is required inside its block: a block that is present but
 * incomplete fails the test that reads it, rather than skipping it.
 */

import type { Vec3 } from "@/core/math/types";

/** A hexagonal cell (a = b, γ = 120°). */
export interface HexCell { readonly a: number; readonly c: number }

/** The local magnetic TOF dataset (`LOCAL_DATA.magneticTof`). */
export interface MagneticTofReferences {
  /** The propagation vector of the ordered phase. */
  readonly k: Vec3;
  /** The refined nuclear structure (the folder's structure CIF). */
  readonly structure: {
    readonly spaceGroup: string;
    readonly cell: { readonly a: number; readonly b: number; readonly c: number; readonly beta: number };
    /** The shared site's members, each one's occupancy, and their sum. */
    readonly sharedSite: { readonly labels: readonly string[]; readonly occupancy: number; readonly sum: number };
  };
  /** The bank-3 GSAS-II calibration. */
  readonly calibration: { readonly difC: number; readonly difA: number; readonly difB: number };
  /** The bank-3 Jana calibration. */
  readonly janaCalibration: { readonly difC: number; readonly zero: number };
  /** Points of the bank-3 histograms (the Mantid export and the .gsa). */
  readonly bank3Points: number;
  /** The local demo's solved model. */
  readonly demo: {
    readonly bnsSymbol: string;
    readonly bnsNumber: string;
    /** Its index in the k-lattice of candidates. */
    readonly candidateIndex: number;
    readonly momentRows: number;
    /** An upper bound on the demo's wR. */
    readonly maxWr: number;
  };
  /** The benchmark's zero-ADP check: the B that rails to 0 and has no partner of its element, and one that has. */
  readonly zeroAdp: { readonly lone: string; readonly paired: { readonly id: string; readonly leader: string } };
}

/** One site of a hexagonal P6/mmm phase built from its Wyckoff orbit. */
export interface HexPhaseSite {
  readonly wyckoff: "1a" | "2d" | "3f";
  readonly element: string;
  readonly occupancy: number;
  readonly uIso: number;
}

export interface LocalReferences {
  readonly magneticTof?: MagneticTofReferences;
  /** The local X-ray dataset (`LOCAL_DATA.xrd`). */
  readonly xrd?: {
    readonly wavelength: number;
    /** The structure CIF's cubic a. */
    readonly a: number;
    /** One site's anisotropic U (U11 and U12) in the CIF. */
    readonly uAniso: { readonly site: string; readonly u11: number; readonly u12: number };
  };
  /** The local X-ray PDF dataset (`LOCAL_DATA.xrayPdf`, `LOCAL_DATA.xrayPdfRoomT`). */
  readonly xrayPdf?: {
    /** The owner's PDFgui instrument terms for the local fit. */
    readonly qdamp: number;
    readonly qbroad: number;
    /** Rw (2–10 Å) of the cubic average, and of the 13-coordinate distorted fit. */
    readonly cubicRw: number;
    readonly distortedRw: number;
    /** The room-temperature G(r) header's Qmax and instrument Qmax. */
    readonly roomT: { readonly qmax: number; readonly qmaxInst: number };
  };
  /** The neutron PDF of the hexagonal dataset (`LOCAL_DATA.hexPdf`, `hexPdfCopy`, `hexPdfGolden`). */
  readonly hexPdf?: {
    /** The owner's PDFgui instrument terms. */
    readonly qdamp: number;
    readonly qbroad: number;
    /** PDFgui's refined cell. */
    readonly cell: HexCell;
    /** The G(r) header's Qmax and its first r. */
    readonly qmax: number;
    readonly r0: number;
    /** PDFgui's refined model for the golden G_calc, in P1. */
    readonly golden: {
      readonly cell: HexCell;
      readonly scale: number;
      readonly delta1: number;
      readonly delta2: number;
      readonly sites: readonly {
        readonly label: string;
        readonly element: string;
        readonly position: Vec3;
        readonly occupancy: number;
        /** U11, U22, U33, U12, U13, U23 (Å²). */
        readonly uAniso: readonly [number, number, number, number, number, number];
      }[];
    };
  };
  /** The hexagonal magnetic dataset (`LOCAL_DATA.hexMagnetic`). */
  readonly hexMagnetic?: {
    /** The co-located magnetic species, and the non-magnetic sites. */
    readonly magneticSites: readonly string[];
    readonly nonMagneticSites: readonly string[];
    /** Site multiplicities in the magnetic group. */
    readonly multiplicities: Readonly<Record<string, number>>;
    /** The mCIF's moment (µB, along c). */
    readonly mcifMoment: number;
    /** The .gpx converged state. */
    readonly gpx: {
      readonly cell: HexCell;
      readonly occupancies: Readonly<Record<string, number>>;
      readonly formFactors: Readonly<Record<string, string>>;
      readonly moment: number;
    };
    /** GSAS-II's magnetic reflection list: all rows, its zeros, the allowed ones, and how many of those agree within ±8 %. */
    readonly reflections: { readonly total: number; readonly zeros: number; readonly allowed: number; readonly within8: number };
    /** GSAS-II's fit window (µs), the pure-magnetic satellite's window (µs), and the bounds on the refined moment (µB). */
    readonly tofWindow: readonly [number, number];
    readonly satelliteWindow: readonly [number, number];
    readonly momentRange: readonly [number, number];
  };
  /** The three hexagonal phases (`LOCAL_DATA.hexPhases`), by tag. */
  readonly hexPhases?: {
    readonly phases: readonly { readonly tag: string; readonly cell: HexCell; readonly sites: readonly HexPhaseSite[] }[];
  };
  /** The StoG run (`LOCAL_DATA.hexStog`): its Q range and number density. */
  readonly hexStog?: { readonly qmin: number; readonly qmax: number; readonly rho0: number };
}
