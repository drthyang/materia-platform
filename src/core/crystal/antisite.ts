/**
 * Antisite disorder between two cation sites: each site's element is added on
 * the other site, at occupancy 0, sharing its host's position and ADP (atoms
 * at one position form a mixed site). With each site's occupancies summing to
 * its total (the shared-site tie) and "hold composition", the exchange then
 * refines as one fraction while the formula stays.
 */

import type { AtomSite, StructureModel } from "@/core/crystal/types";

/** The label of `element` sitting on `host`'s site, e.g. "Cr_W1" (plain enough for GSAS-II and FullProf). */
export const antisiteLabel = (element: string, host: string): string => `${element}_${host}`;

/** The structure with `a` and `b` exchanging their atoms (both added at occupancy 0). */
export function withAntisite(structure: StructureModel, a: string, b: string): StructureModel {
  const siteA = structure.sites.find((s) => s.label === a);
  const siteB = structure.sites.find((s) => s.label === b);
  if (!siteA || !siteB) throw new Error(`no site ${!siteA ? a : b}; the sites are ${structure.sites.map((s) => s.label).join(", ")}`);
  if (siteA.element === siteB.element) throw new Error(`${a} and ${b} are both ${siteA.element}: an exchange between them changes nothing`);
  const guest = (from: AtomSite, host: AtomSite): AtomSite => ({
    label: antisiteLabel(from.element, host.label),
    element: from.element,
    ...(from.isotope !== undefined ? { isotope: from.isotope } : {}),
    ...(from.oxidationState !== undefined ? { oxidationState: from.oxidationState } : {}),
    position: host.position,
    occupancy: 0,
    adp: host.adp,
    ...(host.multiplicity !== undefined ? { multiplicity: host.multiplicity } : {}),
  });
  const added = [guest(siteB, siteA), guest(siteA, siteB)];
  const taken = added.find((g) => structure.sites.some((s) => s.label === g.label));
  if (taken) throw new Error(`${taken.label} is already in the structure: the exchange is already modelled`);
  return { ...structure, sites: [...structure.sites, ...added] };
}
