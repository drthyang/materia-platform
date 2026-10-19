/**
 * Which page cards the Agent is on: the cards a running (or waiting) tool call
 * acts on, and the cards a reply names. The shell writes them to the root
 * element (`data-agent-focus`), and workbench.css makes those cards' edges
 * breathe, so the user sees where the agent is looking.
 */

import { LIVE_TOOLS, type AgentCard } from "@/agent/tools";

export type { AgentCard };

/** The cards each tool reads or changes (its definition's), by name. */
export const TOOL_CARDS: Readonly<Record<string, readonly AgentCard[]>> = Object.fromEntries(LIVE_TOOLS.map((t) => [t.name, t.cards]));

/** Words that name a card, conservatively: each must point at one place on the page. */
const CARD_WORDS: readonly [AgentCard, RegExp][] = [
  ["structure", /\b(structure|space group|bonds?|bond lengths?|atoms?|unit cell|cell check)\b/i],
  ["instrument", /\b(instrument|wavelength|difC|difA|calibration|zero shift)\b/i],
  ["data", /\b(data file|dataset|counting statistics)\b/i],
  // "peak widths" and "peak shape" are the profile, not the plot.
  ["pattern", /\b(plot|pattern|residual|peaks?\b(?!\s+(widths?|shapes?))|fit window|fit range|difference curve|G\(r\))/i],
  ["parameters", /\b(background|scale|ADPs?|B_?iso|U_?iso|occupanc(y|ies)|positions?|profile|peak (widths?|shapes?)|microstrain|parameters?)\b/i],
  ["result", /\b(wR|Rwp|Rw|GoF|goodness of fit|converged|esds?)\b/i],
];

/** The cards a piece of text names. */
export function cardsInText(text: string): AgentCard[] {
  return CARD_WORDS.filter(([, re]) => re.test(text)).map(([card]) => card);
}

/**
 * The cards a reply points the user to: those named in its last paragraph,
 * where a reply says what it found or proposes next (naming every card the
 * whole reply touches would light up the page).
 */
export function cardsInReply(text: string): AgentCard[] {
  const last = text.split(/\n\s*\n/).filter((p) => p.trim()).at(-1) ?? "";
  return cardsInText(last);
}
