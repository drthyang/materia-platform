/**
 * A small synthetic magnetic CIF for the tests (THY-45), written for them —
 * not a MAGNDATA entry. A body-centred antiferromagnet: Mn²⁺ at the origin,
 * its moment along c, reversed at (½ ½ ½) by the anti-centring
 * {1|½ ½ ½}′, plus a non-magnetic O. The nuclear lattice is I-centred
 * (h + k + l even); the magnetic peaks sit on the h + k + l odd positions the
 * nuclear structure forbids, so every magnetic peak is apart from the
 * nuclear ones. The orthorhombic metric keeps the reflections apart.
 *
 * `momentC` sets the moment (µ_B); zero writes the moment loop with a zero
 * moment and gives no magnetic model (the parser skips zero moments).
 */
export function syntheticMcif(momentC = 3): string {
  return `# Synthetic body-centred antiferromagnet (MATERIA test fixture, THY-45)
data_synthetic_bcc_afm
_chemical_name_common 'synthetic MnO-bcc'
_cell_length_a 4.10
_cell_length_b 4.30
_cell_length_c 4.55
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_space_group_magn.name_BNS "P_S-1"
loop_
_space_group_symop_magn_operation.id
_space_group_symop_magn_operation.xyz
1 x,y,z,+1
2 -x,-y,-z,+1
loop_
_space_group_symop_magn_centering.id
_space_group_symop_magn_centering.xyz
1 x,y,z,+1
2 x+1/2,y+1/2,z+1/2,-1
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
_atom_site_B_iso_or_equiv
Mn1 Mn2+ 0 0 0 1 0.4
O1 O 0.5 0 0 1 0.6
loop_
_atom_site_moment.label
_atom_site_moment.crystalaxis_x
_atom_site_moment.crystalaxis_y
_atom_site_moment.crystalaxis_z
Mn1 0 0 ${momentC}
`;
}
