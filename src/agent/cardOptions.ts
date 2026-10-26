/**
 * Options on an approval card: a change that offers the user a choice among
 * the app's own options (the B-at-0 rule's ranked ties and starting value)
 * shows them on its card with the Agent's pick preselected. The user may pick
 * another or decline; their selection is what the change applies. In auto
 * mode no card shows and the Agent's pick applies (the change records that).
 *
 * Plain types, no imports: the executor, the plans and the drawer read them.
 */

/** One option of a group, by its id (stable within the group). */
export interface CardOption {
  readonly id: string;
  /** The button's text: "1 · preferred". */
  readonly label: string;
  /** What it does, in a sentence. */
  readonly detail?: string;
}

/** A choice on the card: one per row the change acts on. */
export interface CardOptionGroup {
  readonly id: string;
  readonly title: string;
  readonly options: readonly CardOption[];
  /** The Agent's pick, preselected. */
  readonly selected: string;
}

/** The user's answer to a card with options: the option picked in each group. */
export interface CardDecision {
  readonly selected: Readonly<Record<string, string>>;
}
