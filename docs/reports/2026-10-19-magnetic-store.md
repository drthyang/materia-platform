# The magnetic step's state as one store (second half)

Branch `claude/magnetic-store`, on `main`, 2026-10-19. Plan:
[AGENT_PLAN.md](../AGENT_PLAN.md), 2.4. The second half of the architecture
review's #2, as the user answered its Q5 (b): the panel's state moves into the
step's module, the panel renders it, and the Agent has one handle for the
step's life. The first half ([#73](https://github.com/drthyang/web-refinement/pull/73))
made the step's operations one module; the state stayed in the panel, in 19
pieces of React state, with two seed refs and seven effects that reset or
seeded it. The headless page kept its own state holder.

## What changed, and why

| Change | What it answers |
| --- | --- |
| `MagneticStep` (`app/magneticStep.ts`): the step's state as one value, and its changes as methods: k, the ions, the peak criteria and picks, the k-search, the framework and irreps, the group chosen, the amplitudes, the ties and flips, the open sections, the ranking, the moments fit, Show and Continue. Its derived values are one memoized function (`stepView`) of the state and the page's inputs | The step's state in a React component, and a second copy of its rules in the headless page |
| The panel renders the store (`useSyncExternalStore`) and calls its changes. It keeps only what is display: the k and I/σ drafts, the spotlight, the add-a-peak mode | 1 960 lines in the panel, now 1 634 |
| The headless page holds the same store, its inputs read off the session as the workbench gives them (`testSupport/magneticHeadless.ts`, now 69 lines) | Two holders of the step's state, with their own reset rules |
| The panel's effects become the store's rules. A new model to open on, or a new peak set, is caught up after each render (`sync`). A ranking or a fit readout is for the model and data it ran on (the data, the window, the refined structure's content, k, the ions, the ties; the group for the readout), and is dropped for good once they change | Effects keyed on object identity |
| **Show keeps the ranking.** The keys are content, so a structure rebuilt equal keeps it | Show strips the model's rows, which rebuilt the refined structure, and the panel dropped the ranking with it |
| **One handle for the Agent** (`MagneticStep.handle`), published once per panel. `rank_magnetic_groups` reads the ranking through the handle it started it with; the waits for a render and the second read are gone (`agent/magneticTools.ts`) | A handle republished every render, its state fixed at that render, which a ranking's caller had to take again after it |

## Evidence

- **The store's rules** (`app/magneticStep.test.ts`, "the step's state, as the
  panel keeps it"), each one of the panel's effects or seeds:
  - an equal, rebuilt structure keeps the ranking; another window or a moved
    site drops it, and it does not come back with the old window;
  - a new criterion drops the per-peak picks, and a new peak set keeps the
    picks of the peaks still detected;
  - the k-search's candidates go when the included peaks change, and stay
    gone;
  - a ranked group starts from its fitted moments, and an amplitude survives
    a rebuild of the same model;
  - opening on a model sets its k, chooses its group, opens its section and
    fits the amplitudes to its moments;
  - the moments fit's readout goes for good with the group or the data.
- **One handle** (`agent/magneticTools.test.ts`): the handle taken before
  `rank_magnetic_groups` is the one the port gives after it, and it reads the
  ranking's best group. The test it replaces simulated the old per-render
  handle, which no longer exists.
- **In the browser**, the Mn₃Ga TOF demo's Magnetic tab, on `main` and here,
  gave the same text up to Show:
  - the 24 residual peaks;
  - the six maximal groups ranked at k = (0 0 ½);
  - the chosen group's moments fit;
  - no page error.

  After Show, `main`'s table was empty (0 rows) and this branch's kept its six
  rows. The single-crystal page's magnetic step renders, with no page error.
  The PDF demo's mPDF step needs neutron data and stays closed on its X-ray
  pattern, as before.
- **Nothing else changed.** The step's tests from #73, the Agent's magnetic
  tools, the ranking on Example 3, the stamp, Stop, the live tools' contracts
  and the text the model reads pass unchanged.

## What changes for users

On the Magnetic tab, Show on refinement pattern no longer clears the ranking.
Everything else works as it did.

## What it means for the validation

The Agent's headless page holds the panel's own store: the magnetic scenario
runs the step's rules as the app does.

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head.
