/**
 * The shared sites' total occupancies, edited in the parameter panel's
 * Occupancy group (powder and PDF pages): each site's occupancies sum to
 * exactly its total by a tie, the last member following the total minus the
 * others. 1 is a full site; below 1 leaves vacancies.
 */

import { useState } from "react";
import { color, mono } from "@/app/theme";
import { isSiteTotal } from "@/core/workflow/powderModelOptions";

interface Props {
  /** The shared sites: each one's key (its first member's label) and its members. */
  readonly sites: readonly { readonly key: string; readonly labels: readonly string[] }[];
  readonly totals: Readonly<Record<string, number>>;
  readonly onChange: (key: string, total: number) => void;
  readonly disabled?: boolean;
}

export function SiteTotals({ sites, totals, onChange, disabled }: Props): JSX.Element | null {
  if (sites.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, color: color.secondary }}>
      {sites.map((site) => (
        <SiteTotalRow key={site.key} site={site} total={totals[site.key] ?? 1} onChange={onChange} disabled={disabled} />
      ))}
    </div>
  );
}

function SiteTotalRow({ site, total, onChange, disabled }: { site: Props["sites"][number]; total: number; onChange: Props["onChange"]; disabled?: boolean | undefined }): JSX.Element {
  const [buf, setBuf] = useState<string | null>(null);
  const last = site.labels[site.labels.length - 1]!;
  const commit = (raw: string | null): void => {
    setBuf(null);
    if (raw === null) return;
    const v = Number(raw);
    if (isSiteTotal(v) && v !== total) onChange(site.key, v);
  };
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6 }} title={`${site.labels.join(", ")} share one site: their occupancies sum to exactly this total (a constraint), ${last} following the total minus the others. 1 is a full site; below 1 leaves vacancies.`}>
      <span>Σ occ {site.labels.join(" + ")} =</span>
      <input
        type="number"
        min={0.001}
        max={1}
        step={0.01}
        disabled={disabled}
        value={buf ?? String(total)}
        onChange={(e) => setBuf(e.target.value)}
        onBlur={() => commit(buf)}
        onKeyDown={(e) => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }}
        style={{ width: 64, fontFamily: mono, fontSize: 11.5 }}
        aria-label={`Total occupancy of the ${site.key} site`}
      />
      {total < 1 && <span style={{ color: color.faint }}>({+((1 - total) * 100).toPrecision(3)} % vacant)</span>}
    </label>
  );
}
