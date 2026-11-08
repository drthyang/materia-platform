# Demo script

A 5–10 minute walk through MATERIA on the live site, to rehearse before
presenting it. Every step uses the two bundled public demos. Each step gives
its clock time, the clicks, and one line to say. The times were measured on
the production build at 1600×900 ([demo-qa.md](./demo-qa.md)); a slower
laptop or a busy network adds to them.

**Contents:** [Pre-flight](#pre-flight-checklist) ·
[The script](#the-script-about-10-minutes) ·
[A 5-minute cut](#a-5-minute-cut) · [Fallbacks](#fallbacks)

## Pre-flight checklist

Do this 15 minutes before, on the machine you will present from.

- [ ] **Browser.** A current Chrome, Edge or Safari. Close every other tab and
      app that might notify; turn on Do Not Disturb.
- [ ] **Zoom and window.** Browser zoom at 100 % (⌘0 / Ctrl+0). Window at least
      1440×900, ideally 1600×900; if the screen is shared at a lower
      resolution, check the Copilot and the page still fit side by side.
- [ ] **Network.** Open [the live site](https://drthyang.github.io/materia-platform/)
      and open each demo once. If the network is unreliable, run
      `npm run build && npm run preview` locally and present from
      `http://localhost:4173/materia-platform/` instead.
- [ ] **Copilot key.** In the Copilot's settings (⚙): **Anthropic** →
      **API key**, paste the key, tick **Remember on this device**, and pick
      the model you will use. Send one short question to see it answer, then
      click **New conversation**. Leave **Ask first** selected. (Presenting from
      `npm run preview` or `npm run dev`: put `ANTHROPIC_API_KEY` in
      `.env.local` and choose **Local proxy**.)
- [ ] **Clean start.** Click **Close** so the start page shows. If it offers to
      restore the last session, decline.
- [ ] **Fallbacks ready** (see [Fallbacks](#fallbacks)): the screenshots in
      [`docs/media/`](./media/) open in an image viewer, the 96 s Copilot
      video [`docs/media/agent-demo.mp4`](./media/agent-demo.mp4), and, if
      you may need the scripted replay, `npm run dev` running in a terminal.
- [ ] **The validation page** open in a second window, not a tab: the
      README's [Validation and evals](../README.md#validation-and-evals).

## The script (about 10 minutes)

| # | Clock | Do | Say |
| --- | --- | --- | --- |
| 0 | 0:00–0:30 | The start page. | "Crystal and magnetic structure refinement in the browser: nothing to install, and the data never leave this machine." |
| 1 | 0:30–1:30 | **Rietveld · Mn₃Ga neutron TOF** (0.3 s), then **Refine** (0.2 s). Point at wR 4.24 %, GoF 3.23 and MnO 3.33(7) wt % on the Structure card. Open **Validation**. | "A two-phase time-of-flight neutron fit; every number with its esd from the engine, and Validation reads the fit against an acceptance bar." |
| 2 | 1:30–2:45 | **Magnetic analysis →**, **Include them in the k-search**, **Search k from … peaks** (instant), then **Rank 14 candidates against the data** (18–29 s; narrate while it runs). | "From the residual to k, to the magnetic space groups k allows, each fitted against the data. At 600 K this sample is paramagnetic, and the app says no candidate beats the nuclear-only fit instead of inventing moments." |
| 3 | 2:45–3:30 | **Close** (**Discard** if asked), **PDF · GaTa₄Se₈ X-ray G(r)** (about 1 s), **Refine** (1 s). | "The same engine in real space: an X-ray PDF at 299 K, fitted with the cubic average structure, Rw 8.1 %." |
| 4 | 3:30–4:45 | **Subgroups**: the 2×2×2 list streams in (about 8 s; narrate). The **Tree** shows F-43m's five maximal subgroups; click **P-43m #215** (X·1) for its detail. Then **List**, **Supercell** → **1×1×2** (about 4 s), **Find** `P-42_1m`, click the 1×1×2 row (24 dom). | "The subgroup engine is built in, not looked up: irreps, isotropy subgroups and the lattice within a supercell, checked against Bilbao and ISODISTORT." |
| 5 | 4:45–5:15 | **Activate P -4 21 m #113** (0.5 s). Point at the banner, "lowered to P -4 21 m #113 · in its own cell, 1×1×2", and the Structure card: 22 sites, c = 20.74 Å. | "One click realises the child in its own doubled cell, with its modes by parent irrep and the order parameter kicked." |
| 6 | 5:15–6:15 | **3D Model**. The k-point chips; the chart (X irrep 5 of 5 and W irrep 1 of 4 share the distortion); click the X bar for its arrows; **Expand all**; **Bonds** → ball-and-stick. Optional: **Refine** the child (about 20 s). | "The modes fold by irrep; the chart gives each irrep's share of the distortion, and a click draws its displacements." |
| 7 | 6:15–8:15 | **Subgroups** → **✕ clear** (back to F-43m). Open the **Copilot** (Ask first). Type: *"Lower the symmetry to P-42₁m in a 1×1×2 cell (c doubled)."* It reads the PDF method and lists the subgroups, then shows a card: **Approve**. If it then proposes **Refine**, approve it (about 20 s). Point at the **Context** meter. | "It reads my written method first, uses the same Subgroups machinery, and asks before every change; each one is a History step I can undo. The meter shows how full its window is." |
| 8 | 8:15–9:30 | The second window: README, [Validation and evals](../README.md#validation-and-evals). | "The engine is checked against SHELXL, GSAS-II, FullProf, PDFfit2, ISODISTORT and Bilbao. The Copilot has an eval gate: eight scenarios on Haiku 5.5 and Sonnet 5.5, three runs each. That is a regression test of behaviour; whether it beats the app alone is a separate study, not finished." |
| 9 | 9:30–10:00 | Back to the app. | "It's a public beta, AGPL, with every known gap listed in the limitations page." |

## A 5-minute cut

Keep steps 0, 1, 3, 4 (start the Subgroups view at 1×1×2), 5, 6 and 8, about
30–45 s each. Skip the ranking in step 2 (show
[`magnetic-ranked.webp`](./media/magnetic-ranked.webp) instead) and do step 7
only if the model answers quickly in the pre-flight.

## Fallbacks

**The model or the network is slow or down (step 7).**

- If nothing streams for about 30 s, click **Stop** (■) and say "this is a
  live model; here is the same run".
- **Pre-recorded screenshots**, from a run with a scripted model (no model
  called), the same request as step 7:
  [`copilot-lower-symmetry.webp`](./media/copilot-lower-symmetry.webp) (the
  approval card and the context meter), then
  [`copilot-lowered.webp`](./media/copilot-lowered.webp) (after Approve).
  Or play the 96 s video [`agent-demo.mp4`](./media/agent-demo.mp4).
- **Scripted replay, live in the app** (needs `npm run dev`; the dev server
  plays the turns, so there is no model, key or network): open
  `http://localhost:5173/materia-platform/?agentReplay=pdf-local-geometry`,
  open the **GaTa₄Se₈** demo and the **Copilot**, and send any message, such
  as *"Is the Ta coordination the same locally as on average? Write the report
  when you are done."* It runs a boxcar scan and writes the report through the
  real tools and approval cards. On the Mn₃Ga demo,
  `?agentReplay=full-refinement` runs the staged Rietveld refinement. The
  Copilot labels these "a scripted replay, not a live run"; say so. No replay
  lowers the symmetry: for that, use the screenshots. Loading the page again
  without `?agentReplay` restores your own settings.

**A long step runs slow.**

- **Ranking the magnetic candidates** (step 2, 18–29 s): narrate the method
  ("each candidate's moments are fitted against the held nuclear model;
  Hamilton's test marks the ties") or click **Cancel** and show
  [`magnetic-ranked.webp`](./media/magnetic-ranked.webp).
- **The 2×2×2 Subgroups listing** (step 4, about 8 s): narrate while the rows
  stream in, or set **Supercell** to **1×1×2** first (about 4 s), which is all
  steps 5–7 need. The Tree is in
  [`subgroups-tree.webp`](./media/subgroups-tree.webp), the Find step in
  [`subgroups-find.webp`](./media/subgroups-find.webp).
- **Refining the 1×1×2 child** (step 6 or 7, about 20 s): skip it; the modes,
  chart and arrows show at the kicked amplitudes without it
  ([`modes-3d.webp`](./media/modes-3d.webp) shows the refined child).
- **A phone question:** [`phone.webp`](./media/phone.webp) shows the bottom
  action bar, the Subgroups sheet and the Copilot sheet.

**Something else breaks.** **History ▾** goes back to any earlier step, and
**Close** → a demo card starts over in a second.
