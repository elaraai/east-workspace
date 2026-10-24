# Loading design source for #1398

This is the design for elaraai/east-workspace#1398, "one way to scroll and load". It was made in Claude Design with the East Design System and settled on 22 Oct 2026.

**What is binding.**
- **Behaviour, timing and geometry** are binding as written in #1398: rules CL1–CL13 and the section "What draws before data arrives".
- **The look** is binding as drawn in these cards and as listed in `Loading.style-changes.md`, with exact tokens and values.
- **The PNGs on the issue** are previews for people. Implement from this source.

## Files

| Path | What it is |
|---|---|
| `guidelines/cards/parts-loading-run.html` | **Unloaded run**: placeholder rows at a collection's pitch, one shape per content kind, the Sheet's real numbers, the grouped band, the narrow card, and the failed run (said once, with Retry). |
| `guidelines/cards/parts-loading-wash.html` | **Region wash**: for items whose positions aren't known yet (time-grid columns, month cells, timeline rows, lane-hour cells, schematic areas), under the real rules, shading and now line. |
| `guidelines/cards/parts-loading-line.html` | **Footer loading line**: one line in its own trailing slot of the shared footer rail (idle, range, period, filtering, failed with Retry, narrow), plus the reveal timing. |
| `guidelines/cards/parts-loading-stale.html` | **Retained (stale)**: the Row card's stale state, extended to grid cells and canvases, during a narrowing or a revision re-read. |
| `guidelines/cards/collections-loading-{sheet,plan,roster,calendar,allocation,schematic}.html` | Each builder's views in each situation: cold load, unread, stale, failed and empty. |
| `guidelines/cards/loading-parts.css` | **The loading parts' styles**, shared by every card. This is the file to translate into the slot recipes. |
| `guidelines/cards/loading-parts.js` | The helpers the cards use to build their repeated rows. Card scaffolding only, not product code. |
| `guidelines/cards/slice-parts.css` | The design system's shared toolbar and slice part styles, as the cards use them. |
| `styles.css`, `_ds_bundle.css`, `tokens/*.css` | The East Design System's stylesheet and tokens, which the cards link (`../../styles.css`). Every `var(--…)` in the cards resolves here. |
| `Loading.style-changes.md` | The change list: one row per element, current → target, with token or value and the rule that requires it, plus the proposed parts and the settled conflicts. |

**To view:** open any card in a browser straight from this folder. Font Awesome loads from its CDN.

## Reading the cards

- **Toolbars.**
  - The cards draw the toolbar items that loading touches: the count, status, issues and Publish.
  - At the cards' 700 px width, they fold those items the way the code's own ladder does. That ladder is in `roster/toolbar.tsx` and `allocation/toolbar.tsx`: status first, then the View menu, issues, the navigator, and Publish.
  - Items a card leaves out, such as the Roster's and the Allocation's history bar, are unchanged.
- **The footer fit.** `fitFoot` in `loading-parts.js` is card scaffolding, but the order it follows is the behaviour to build into the footer's own layout:
  1. The legend stays whole, and the Sheet's hints end at a whole hint.
  2. The loading line shows its full text, else its short form, else the dot alone, with its text kept for screen readers.
  3. A failure keeps "● Retry".
- **The data** in the cards (names, dates, counts and codes) is illustrative. The shapes, slots and states are what's specified.

## Where each part goes in the code

| Design part | Code (east-workspace, `libs/east-ui/packages/`) |
|---|---|
| Unloaded run | A shared part in `east-ui-components/src/collections/`, replacing the Sheet's `SheetBandRow` (`e3-ui-components/src/sheet/Rows.tsx`) and the Plan's `WindowBand` (`e3-ui-components/src/plan/rows/WindowBand.tsx`). It is drawn from the scroll offset, never as a sticky child of a translated or clipped band. |
| Region wash | A shared part used by the Calendar views, the Plan row plots, the Allocation lane-hour cells and the Schematic window. |
| Footer loading line | `BuilderFrame` gains `busy`, separate from `loading`; the line lives in the shared footer rail (`east-ui-components/src/theme/slot-recipes/builder-footer.ts`). It replaces the Sheet's and the Plan's transport lines. |
| Retained (stale) | A stale state on rows, grid cells and canvas items in every builder. |
| Cold-load skeleton | `BuilderFrame`'s skeleton, drawn at each component's own pitch instead of fixed 40 px rows. |

Suggested first step for #1398: commit this folder under `libs/east-ui/docs/proposals/` as the design of record, as #1382 did for the Schematic's spec.
