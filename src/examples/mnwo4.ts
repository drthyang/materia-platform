/**
 * MnWO₄ (hübnerite), wolframite type, monoclinic P2/c — a published structure
 * for the tests that need a wolframite.
 *
 * Source: J. Macavei and H. Schulz, "The crystal structure of wolframite type
 * tungstates at high pressure", Z. Kristallogr. 207, 193–208 (1993); the
 * ambient-pressure refinement in air (COD 9013907, AMCSD 0011051): a = 4.830,
 * b = 5.7603, c = 4.994 Å, β = 91.14°; Mn on 2f, W on 2e, O1 and O2 on 4g, with
 * the coordinates and U_iso below as published. The site labels are ours.
 */

import { parseCif } from "@/parsers/cif";
import type { StructureModel } from "@/core/crystal/types";

export const MNWO4_CIF = `data_MnWO4_Macavei_Schulz_1993
_chemical_formula_sum  'Mn O4 W'
_cell_length_a  4.830
_cell_length_b  5.7603
_cell_length_c  4.994
_cell_angle_alpha  90
_cell_angle_beta   91.14
_cell_angle_gamma  90
_symmetry_cell_setting  monoclinic
_space_group_name_H-M_alt  "P 2/c"
_space_group_name_Hall  "-P 2yc"
_symmetry_Int_Tables_number  13
loop_
    _space_group_symop_id
    _space_group_symop_operation_xyz
     1  x,y,z
     2  -x,y,1/2-z
     3  -x,-y,-z
     4  x,-y,1/2+z
loop_
   _atom_site_label
   _atom_site_type_symbol
   _atom_site_fract_x
   _atom_site_fract_y
   _atom_site_fract_z
   _atom_site_occupancy
   _atom_site_adp_type
   _atom_site_U_iso_or_equiv
Mn1    Mn   0.50000     0.68560     0.25000     1.0     Uiso 0.01080
W1     W    0.00000     0.18000     0.25000     1.0     Uiso 0.00600
O1     O    0.21100     0.10200     0.94300     1.0     Uiso 0.01000
O2     O    0.25000     0.37400     0.39300     1.0     Uiso 0.01100
`;

/** MnWO₄, P2/c, as published (Macavei & Schulz 1993). */
export function mnwo4Structure(): StructureModel {
  return parseCif(MNWO4_CIF, "mnwo4");
}

/** The elements sharing the A site of {@link sharedSiteWolframite}: Mn and its first label, then the others, Zn (d¹⁰) last. */
export const SHARED_A_SITE = ["Mn1", "Fe1", "Co1", "Zn1"] as const;

/**
 * A synthetic wolframite with one shared site: MnWO₄ as published, its 2f A
 * site split among Mn, Fe, Co and Zn (each a published wolframite end member),
 * each at `occupancy` (default ¼), all at Mn's position and U_iso. A test
 * fixture for co-located species, not a measured structure.
 */
export function sharedSiteWolframite(occupancy = 0.25): StructureModel {
  const base = mnwo4Structure();
  const mn = base.sites.find((s) => s.label === "Mn1")!;
  const shared = SHARED_A_SITE.map((label) => ({ ...mn, label, element: label.replace(/\d+$/, ""), occupancy }));
  const others = base.sites.filter((s) => s !== mn);
  return { ...base, id: "shared-site-wolframite", name: "(Mn,Fe,Co,Zn)WO₄ (synthetic)", sites: [shared[0]!, ...others, ...shared.slice(1)] };
}
