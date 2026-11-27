# A failed Activate says why and leaves the row inactive

## What changed

On the PDF page's Subgroups view, an Activate that changed nothing showed
nothing to the person. One example is a cell-multiplying child whose mode basis
cannot be built: Mn₃Ga's CIF prints its thirds to four decimals. The reason went
to the browser console only, and the row was marked "Active ✓" although the
structure was not lowered.

The page now hands Activate's reason back to the panel, which:

- shows it under the button: "⚠ Not activated, nothing changed: …";
- marks the row active only when the child is in force.

A handler that throws is caught and shown the same way.

## Evidence

`src/app/ui/subgroupsPanel.dom.test.ts`: a failing activation leaves the row
inactive and shows the reason. A successful one is unchanged.

## What users and the validation see differently

- **Users:** a failed Activate now says why. No result, number or
  model-visible text changes.
- **The Agent:** its `lower_symmetry` already reported such refusals and is
  unchanged.

## What is left

The cause in the Mn₃Ga example, rounded special positions, is a separate fix
(snap on load), which waits for the owner's review.
