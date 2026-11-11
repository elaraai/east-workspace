# East UI Components

React rendering layer for East UI types. Converts East variant/struct
values into Chakra UI v3 React components.

## HARD RULE: East values through East

An East value is printed, read, compared, ordered, collected and typed
through East's utilities — never a JavaScript stand-in — and tested over
real, decoded East values. `make lint` runs `east/east-rules` (the
host-value rules) over source and tests and fails on a JavaScript stand-in;
[`EAST_TS_INTEROP.md`](../../../../docs/conventions/EAST_TS_INTEROP.md)
§7–§11 names each utility and the rule that enforces it. In short:

- print with `printFor(T)`, or the locale formatters for a person; read
  text with `parseFor(T)` and act on `success`;
- compare with `equalFor` / `compareFor`, and use `Object.is` only where
  you mean the same object (a memo, a cache);
- key a Set or Dict by a struct, variant or DateTime with `SortedSet` /
  `SortedMap` and `compareFor(K)`;
- type decoded values `ValueTypeOf<…>` and narrow on `.type` — never a
  `{ type, value }` cast or a `*Like` mirror;
- build variants with `variant()` / `some()` / `none`, in tests too, and
  assert over whole values (`toEqual(variant(…))` checks East's brand).

## Visual style

**Canonical design source: the East Design System** in claude.ai/design,
downloaded read-only into `libs/east-ui/app_design_system/` (see
[`../../CLAUDE.md`](../../CLAUDE.md) › Canonical design source). Do not
maintain a copy of its tokens anywhere else in prose — the theme is the copy,
and the token guard holds it to the download.

The theme (`src/theme/`, exported as `system`) holds one token for each
design-system token — `fg` … `fg.faint` (`--ink` … `--ink-5`),
`bg.surface` / `bg.canvas` / `bg.subtle` (the papers), `border.subtle` /
`border.strong` (the rules), `brandMark` / `brand.solid` / `brandPressed` /
`brandTint`, `status.pos` … (valence bases: marks, fills, edges) and
`fg.success` … (their text steps: words), `heat.1` … `heat.5`, the
`fontSizes` `label.*` / `body.*` / `title.*` / `num`, the radii, the focus
rings `focus` / `focusInset`, and the motion tokens — and
`src/theme/design-system.test.ts` fails, naming the token, when one drifts
from `app_design_system/tokens/*.css`. Recipes and renderers name these
tokens, never a raw hex, a raw palette step (`brand.600`) or a size outside
the scale.

**A computed place is written inline (#1440).** A position or size a
renderer computes — a bar's left and width, a row's height, a grid's
template, a clip — goes through `style` (or a CSS variable set there), never
a Chakra style prop. A prop mints an emotion class for each distinct value,
each carrying a copy of its element's recipe, and the page never removes
one: a canvas that zoomed or panned grew its style sheet by thousands of
rules a gesture (planNestedAll's Year zoom alone, 57,000), every frame's
styling slowed with it, and past about 262,000 rules Chrome applies no new
one, so whatever then draws at a new place draws unstyled. A value from a
bounded set — a token, a state's literal — stays a prop, and so does a
number passed through whole, which Chakra may read as a token (`w={10}` is
2.5rem). The lint rule `east-ui/inline-places` (`eslint/inline-places.js`,
its cases in `test/lint/`) refuses a Chakra style prop given a number worked
out as the component renders — a sum, a template, `Math.round(x)`, or a
local or helper of this code holding one — and the responsive suite's
`plan-geometry.spec.ts` holds planNestedAll's rule count still across zooms,
pans and strip drags.

| Target (from `libs/east-ui/`) | What it does |
|---|---|
| `make design` | Serves the design system's download (`app_design_system/`) on :5174. |
| `make test-responsive` | The showcase's responsive suite — where visual changes are measured. |
| `make east-ui-examples-html-all` | Snapshots every east-ui example to standalone HTML. |
| `make east-ui-examples-html-<key>` | Snapshots a single example (e.g. `east-ui-examples-html-disclosure/tabs`). |

Visual verification measures and looks: a visual change lands with a visual
invariant in `../east-ui-showcase/tests/responsive/`, computed styles measured
in the page, and before it is called finished it is screenshotted and the
screenshots read (see [`../../CLAUDE.md`](../../CLAUDE.md) › Canonical design
source).

**Palette (#1091).** Brand is the default `colorPalette`.
`theme/global-css.ts` sets it on `html`, where Chakra sets its own `gray`.
A renderer passes `colorPalette` only when the East style names one, so a
part with none takes the brand. A part the design system draws neutral
keeps the gray palette in its own recipe, and a prop still wins over it:
- badge, tag, avatar, kbd and code set `colorPalette: "gray"` on their
  root;
- the button sets it in every role but the primary (`outline`, `ghost`,
  `subtle`, `surface`, `plain`);
- a container pins the colour itself, never its palette: the tabs'
  underline bar, the table's selected and hovered rows, and the progress
  track. A palette set on a container is inherited by every part inside
  it (a primary button in a table cell would draw gray).

A variant that fills from the palette reads only the roles every palette
defines: `solid`, `contrast` and `solidHover`. It never reads a numeric
stop. A stop is the same colour in both modes, and the valence palettes
have none, so the brand's would be inherited from `html`.
`test/theme/palette.spec.ts` holds every palette to those roles.

## Stack

- **React 19.2** with `react-dom` 19
- **Chakra UI 3.30** (Ark UI / Zag.js state machines)
- **TanStack Table 8.21** (sorting, column sizing, row selection)
- **TanStack Virtual 3.13** (row virtualization)
- **TanStack Query 5.90** (async data fetching)
- **TypeScript 5.9** with `exactOptionalPropertyTypes`
- **Vite** builds, **ESLint** lints
- **use-local-storage-state** for opt-in persistence

## Commands

`make build`, `make test`, `make lint` from this directory. See
[`../../../../docs/conventions/MAKEFILE_TARGETS.md`](../../../../docs/conventions/MAKEFILE_TARGETS.md).

`build` type-checks before vite bundles: `pnpm typecheck` runs `tsc` over
`tsconfig.typecheck.json`, which covers `src` (tests included), `test`,
`scripts` and the configs — vite and vitest strip types without checking
them, so this is the only gate that sees a type error (#589).

The bundle keeps React, Chakra and react-aria's locale (`@react-aria/i18n`)
external: each is a context the host and the sibling renderer packages share.
Bundled, the package would hold a copy of its own, and a host's one
`I18nProvider` would reach it or e3-ui-components' renderers, never both
(#1206).

## Architecture

### Rendering pipeline

East programs produce **values** (variant/struct data). This package
renders them:

```
East value (VariantType) → EastChakraComponent (match) → Specific renderer (memo) → Chakra UI JSX
```

`EastChakraComponent` in `src/component.tsx` is the top-level dispatcher.
It matches on the East variant tag and delegates to the appropriate
component.

### File structure

```
src/
  component.tsx              # Top-level variant dispatcher
  hooks/usePersistedState.ts # localStorage persistence hook
  platform/                  # East state management (UIStore, DatasetStore)
  collections/               # Table, Matrix, TreeView, DataList (the Plan's, the Sheet's, the Flowchart's and the Schematic's renderers are e3-ui-components')
  disclosure/                # Tabs, Accordion, Carousel
  layout/                    # Box, Flex, Grid, Stack, Splitter, Separator
  forms/                     # Input, Select, Checkbox, Switch, Slider, etc.
  overlays/                  # Dialog, Drawer, Popover, Tooltip, Menu
  display/                   # Badge, Tag, Avatar, Stat, Icon
  typography/                # Text, Heading, Code, CodeBlock, Link
  charts/                    # Sparkline, Area, Bar, Line, Pie
  feedback/                  # Alert, Progress
  container/                 # Card
  buttons/                   # Button, IconButton, CopyButton
  utils/                     # RowStateManager, RowSortManager
```

## Builder frame

A builder-style component — one toolbar over a pane or two beside a main
area, as Studio's builder and the query builder are — is laid out with
`BuilderFrame` (`src/layout/builder-frame/`, #1125), never by hand: it names
its regions, and the frame lays them out. The frame holds no content of its
own and draws no outer border, so a host frames it or places it bare. It is a
React part for renderers, exported as `DockPane` and `Toolbar` are: no East
component, nothing in east-ui.

```
┌───────────────────────────────────────────────────────────┐
│ toolbar   (Toolbar: one row, folding)                     │
├───────────────────────────────────────────────────────────┤
│ banners   (in-flow, full width)                           │
├────────┬────────────────────────────────────────┬─────────┤
│ start  │ main  (children: always present; its   │   end   │
│ pane   │        content scrolls itself)         │   pane  │
├────────┴────────────────────────────────────────┴─────────┤
│ footer                                                    │
└───────────────────────────────────────────────────────────┘
```

- **Props.** `children` is main, the one region every frame has: the room
  the panes leave, a bounded box its content scrolls in. `toolbar` (the
  shared `Toolbar`'s items), `banners`, `start`, `end` and `footer` appear
  only when given. `storageKey` is where each pane keeps its open tab, and
  its collapsed state when it persists; `minMain` (480px by default) is the
  narrowest main may get beside pinned panes; `label` is the frame's
  accessible name; `ref` is its root (the bounds of a popover inside it) —
  `rootCss` and `rootProps` a host's own styles and attributes on it, for a
  slot of the host's over the frame's content (the optimiser's landing,
  #1409) — and
  `toolbarRef` its toolbar's element (where a host finds its items' controls:
  the search box a key focuses); `onKeyDown` hears keys from anywhere in the
  frame, the panes included. A key a builder acts on — there, in its canvas
  or grid, a radio group's arrows (`radioGroupKey`), a Library card's ⏎ or a
  drag's keys — is taken (`takeKey`: its default prevented, its propagation
  stopped), so it goes no further than the builder: a page's own shortcut on
  the same key, the showcase's `[` that folds its sidebar, never hears it
  (#1398). While a drag is in flight its sensors hear its keys on the
  document ahead of everything under it, so a builder's own Escape or arrows
  never take one the drag needs. A key it leaves goes on as it came.
- **Loading (opt-in).** `loading` covers the complete frame with shared Chakra
  Skeletons for its cold load only — the first read, before anything it shows
  has landed (#1398, CL5) — its body rows at `loadingPitch`, the component's
  own row pitch, each a 12px bar. Its actual regions stay
  mounted, measurable, inert and hidden from assistive technology; a
  `liveFooter` stays live under the cover, so the footer's loading line and its
  Retry carry the wait. On the first
  resolved window it also waits for the mounted content's fonts after layout
  measurement; no timeout or initial pane animation. After cold load a read in
  flight is `busy`: `aria-busy` on main, nothing covered, the toolbar, panes
  and Save live. The `builderFrame` recipe
  owns these states and skeleton geometry. Existing callers that omit `loading`
  retain their own loading behavior. Keep usable cached data visible on refresh;
  surface errors instead of leaving the skeleton indefinitely. The builders'
  integration and evidence are in
  [`../e3-ui-components/CLAUDE.md`](../e3-ui-components/CLAUDE.md#loading-and-bounded-rendering).
- **The footer's loading line** (#1398, CL3, `./internal`). One line in a slot
  of its own at the footer rail's trailing end — `LoadingLine` over a
  `LoadingLineValue` (what is read, or what failed with its reason and Retry,
  in the builder's words), shown on the builder's one reveal clock (after
  150 ms, held at least 300 ms; a failure at once): `LoadingReveal` around the
  builder's frame, which the line and every placeholder read where they show
  (`useRevealed`), so the clock's flips render them and never the frame. It is
  a polite live region that speaks once a load. The rail fits it on one line
  with no word cut
  (`useFooterFit` over `fitFooter`, pure): the legend's items
  (`data-footer-unit`, cut whole by `footerCut`, `FooterMore` ending a cut
  legend), or a footer's hints running on in one item (`data-footer-units`),
  stay whole; the line shows its full text, its short form or its dot alone. A
  builder's own rail that carries the line takes `FOOTER_FIT`
  (`builder-footer.ts`), as the Sheet's does. Nothing the fit measures may
  move with the fit: every other item of the rail is weighed at its natural
  width, and one the flex layout shrinks — the Sheet's message, which
  ellipsizes — is marked `data-footer-slack`, fitted at no width, and takes
  what the fit leaves it. An unmarked item that shrinks looped the fit on a
  phone (the showcase's `builder-footer-line.spec.ts` holds every rail to it).
- **The Elara eye** (#1409, `src/optimise/`). What a run of the app's
  optimiser draws in a builder, shared, so each builder lists the parts in
  its frame and draws nothing of them itself: `OptimiseButton` — the eye,
  `optimiseToolbarItem` the toolbar item a builder lists immediately before
  the history item, in every fold of the ladder and never out of the toolbar
  (`toolbar`, 32 × 28 as the builders' rows' controls stand; `md` 32 × 32;
  `sm` 24 × 24), running, blinking and disabled states, its names
  `optimiseMessages`' — a period that cannot be optimised at all lists no
  eye, one whose reads are in flight a disabled one; `OptimiseEntry` — the eye
  as an entry of its builder's View, which the row's floor folds it into
  (below), the View's own `xs` button: the same run, its Stop, and while the
  eye is off, off too, saying why (`Read-only`) beside its name; `OptimiseBanner`
  — the result in the banners slot, the `BannerView`'s `elara` tone (`done`,
  `none`, `fail`), leaving over `--dur-base`; `optimiseRunningLine` /
  `optimiseStoppedLine` — the footer line's `busy` kind while the call is out,
  its seconds beside it, and its `note` for 2.5 s after Stop;
  `OptimiseLegendItem` — the legend's `Elara change`; and `useLanding` with
  `useLandingStyles` over the `optimise` recipe's `landing` slot, which draws
  the landing and the highlight from the attributes a builder's entries carry
  — `data-op="add|chg|del|from"`, `data-fill="own|cell"`, `data-opn` on a
  total — and from main's own (`data-optimise-landing` while the result
  lands, `data-optimise-lit` for the highlight's 8 s), the cascade's one
  binding `--optimise-delay` the hook writes. The slot goes on a builder's
  own root, or — for a builder with no root of its own around its frame, the
  Sheet — on the frame's root through `BuilderFrame`'s `rootCss` and
  `rootProps`, never on a wrapper of the builder's own around the frame: a
  host sizes and measures a builder through the frame's parent, and a
  wrapper there is either no box at all or a box the host's own then scrolls.
  Every colour is the `elara` tokens'. The `HistoryBar` takes `locked` while
  a run is out: Undo, Redo, Discard and Save `aria-disabled`, their size and
  the focus kept. A button that runs out under the focus — Discard pressed
  from the keyboard — keeps it the same way until the focus moves on, and a
  session banner's action that takes the banners away leaves the focus on
  the frame's main, its first control: never on the page.
- **Panes.** A `BuilderFramePane` is either a description the frame draws as
  a `DockPane` (`BuilderFrameDock`: `label`, `body` or `tabs` — each tab's
  `count`, when given, follows its name, the Calendar's and the Sheet
  builder's `ROWS 11` — `tab` / `onTabChange`, `icon`, `badge`, `detail`,
  `active`, `size` — 320px by default — `mode`, `collapsed` /
  `defaultCollapsed` / `onCollapsedChange`, `persist`, `collapsible`), or
  `{ element }`, placed as it is and pinned at its side (a SnapGrid's East
  `Dock` pane, which draws itself). A pane tab that lists cards is a
  `Library` (`EastChakraLibrary`, `toolbar` on for its search), whose
  `empty` words say what an empty tab shows; a search or a filter that
  hides every card says `No matches` itself, in the shared empty state. A
  host may give its own words for the search (`search`) and for a search that
  hides every card (`noMatch`), draw beside each compact card's shared face
  what its domain shows (`extras`: a tooltip, a figure on the name's line, a
  note line in a tone, a dashed or sunken look, an × of its own), and mark a
  group's head (`groupMark`) — the Allocation's Library (#1330). While a
  host's narrowing — a builder's rail — leaves it no item, `narrowing` gives
  its empty state the host's words and a Clear filters (#1339); the Library
  still lists only what its host feeds it. While cards its host is to list
  are still read — the Calendar's Backlog on a step to a period not read yet
  — `pending` draws its pending rows, the paged Library's card-sized
  skeletons, after the cards it holds and says no empty state (#1398, CL13):
  the Library stays mounted, so its search box keeps its text and the focus.
  A tab that also lists cards the
  narrowing does not touch — the Roster's agency requests beside its people —
  says so above them while the narrowing has left none of its own
  (`emptied`), and a narrowing that clears elsewhere (a Find's chip) offers no
  Clear filters (#1342). A tab's search box finds within that tab alone, never
  the rail's search: the Library is a palette (#1340, ruling 11). The paged Library (`PagedLibrary`,
  `./internal`) takes the same `empty` and `narrowing` (#1341), and, given its
  source's part of the rail (`search`, #1346), draws the Library's search box
  over its record (`LibrarySearchBox`, shared with the Library, ⌘ / and all):
  a prefix of the first String field its source lists in `search` that follows
  the rail's choices on one index, or that the rail narrows already, narrowed
  further (`paged-search.ts`), read through the part's `pageWhere` and
  `countWhere`. Its text is the tab's own state, never the rail's, so the rail,
  the board and every count stay as they are; its footer counts what it hides,
  with Show all, and a search the rail's choices block says which, with the
  rail's Clear filters. Over a rail's narrowed source — a live one, its id the
  same under every narrowing (#1354) — it starts its viewport again when the
  source's `query()` moves, as for a new source; a reader that keeps windows
  keys them by `snapshotOf(source)`, the revision and the narrowing together.
  It never blinks (#1398, CL8; #1424): while a new narrowing's count and first
  rows — the rail's, or its own search's — or a new revision's rows in view, or
  a new count's at the same revision (its host's drafts moving its rows), are
  read, the rows that last landed stand in, retained (`aria-disabled` in an
  `aria-busy` region on its rows), and are swapped whole once they land, a new
  narrowing's view starting at its start; a read again of rows it showed — the
  same narrowing, revision and count, its windows let go meanwhile — keeps
  them until they land again. Only its first read, and rows scrolled into view,
  draw pending rows. Its page, `PAGED_LIBRARY_PAGE` (32), is what a host whose figures swap
  with its rows waits on: the Calendar's Backlog hands its tab's count on with
  the list's first page. A tab's count
  while a rail narrows it is `narrowedCount` over resident cards (`10 of 33`),
  or `pagedCount` over a paged record's exact counts (`40 of 2,048`). A collapsed
  pane's rail may carry a `mark` after its badge (`Overdue arrival`).
- **Rail counts.** Pass a numeric `badge` for a count, keeping it numeric until
  `DockPane` formats it with the shared locale formatter's `compact()`.
  Its exact value remains available on hover and to assistive technology.
  Numeric tab counts use the same formatter's full `number()` form. The dock
  recipe bounds badges to the rail, including longer locale abbreviations;
  builders must not implement their own abbreviation or badge styles.
- **A rail's editor** (#1393). Each known value's chip counts its own rows
  under the other fields' choices, the chosen marked, as a faceted search
  counts — never what a click on it would show (east-ui's
  `RecordSliceController.values`). The editor (`SliceEditPopover`) keeps to
  the frame's sides while it fits between them, else to the page's, and down
  the page always to the page's, so it flips above its trigger as it did
  (`overlays/popover/frame-bounds.ts`, read live at every placement: passed
  as a function, since Zag copies a popover's positioning each time it draws,
  so the first open, its content not yet there, keeps to the frame too). A
  choice the narrowing as it stands cannot take names the fields to choose
  first — `Choose Kiln group first.`: those an index taking it needs exact
  choices of, the fewest (east-ui's `recordChoiceNeeds`) — and a String
  field's search offers `All starting with …` only where an index takes a
  prefix of the field, never where none does whatever is chosen first (an
  interval index takes exact values alone on its leading fields). Its box
  stands at its own height in the editor's column (`sliceEdit`'s
  `choiceList`), never the toolbar row's basis taken as a height.
- **A tab row too narrow folds** (`DockPane`, #1210): the counts leave the
  row first, kept in each tab's name; then the trailing tabs fold into a
  `+n` menu after the last that fits, the open tab always on the row, so no
  tab runs under the collapse control. The row measures its tabs drawn whole
  before it paints, again when its room or its tabs change or fonts arrive;
  the decision is `fitTabs` (`src/layout/dock/fold.ts`), a pure function.
- **Modes.** `pinned`: in the flow; opening it pushes main aside over the
  design system's `--dur-base` on `--ease-in-out`. `overlay`: its 44px rail
  stays in the flow, so main never moves; open, the pane floats over main
  from its edge, full height — never wider than the frame's width less what
  the other side keeps in the flow (its rail, or a pinned pane), less 48px
  (`MIN_SCRIM`), so a 48px strip of main always shows beside it, as a
  phone's drawer leaves one (`paneWidths`, a pure function: on a 324px
  phone Studio's palette and inspector are each 232px). Esc closes it before
  anything else in the frame hears it, and puts the focus on its rail — but
  a layer open in it that takes Esc itself and says so, `data-escape-layer`
  (the shared Chooser laid in a pane, given `onClose`), closes first, as a
  popover portaled out of the frame does; one
  overlay pane is open at a time. `auto` (the default): pinned while main
  keeps `minMain` beside the pinned panes, the start pane placed first;
  overlaid otherwise, and always at 560px and narrower — the frame's own
  width, not the window's (`placePanes`, a pure function). An `auto` pane
  that starts to overlay closes, and opens again once it is pinned again,
  unless it was opened or closed meanwhile. A pane that never collapses is
  always pinned. A pane that persists (`persist`) keeps only the viewer's own
  collapse or opening: what the frame does for lack of room is never
  written, so a reload restores the viewer's choice at any width.
- **The scrim** covers main while an overlay pane is open for lack of room —
  an `auto` pane overlaying, or any overlay pane at 560px and narrower — in
  the theme's `overlay.backdrop`; main takes no pointer, and a tap on the
  scrim — the strip of it beside the pane, 48px at least — closes the pane.
  The other pane's rail stays out from under it. A pane its host sets to
  `overlay` on a wider frame floats over a live main. While a drag is under
  way an open overlay pane slides off main and its scrim lifts, so it never
  hides a drop target; the frame hears of a drag only while one is open
  (`OverlayDragWatch`), so a frame with none draws nothing as a drag starts
  and ends (#1594).
- **A phone's frame** (560px or narrower, `data-phone`; `Mobile Builder
  Frame Spec.md` in `libs/east-ui/docs/proposals`, ruled 3 Nov 2026) stacks
  its regions and gives main the frame's whole width. The items that draw a
  `secondRow` (`ToolbarItem.secondRow`: the history's phone form,
  `HistoryBar`'s `phone` — the drafts' count, its number whole or not there,
  Issues off at none, the four buttons at 44px, Discard asking first in a
  band under the row (`FrameSessionBand`) — or, in a row short of Discard and
  Save's chevron both, More in its place, holding the two — and no conflicts button: the row
  holds its five squares whatever waits, Issues counting the conflicts and
  opening them in the bottom panel, the focus back on it as they close — and
  the Elara eye before it) leave the first row for the toolbar's second row,
  44px, always shown. The footer's `LoadingLine` draws itself at that row's
  start in its short form (`SessionRowSlot`), the count stepping aside while
  it shows, and a footer whose line it so takes is not shown, mounted still;
  a footer with no loading line (the query builder's status line) stays, and
  under the cold-load cover the line stays in the live footer. A described
  pane that collapses is a tab of the pane strip on the bottom edge — icon,
  label, detail or badge — and opens as the Filters view does (ruled 3 Nov
  2026): a view over the whole frame, edge to edge, sliding in from the
  right, its `DockPane` a vertical tray: one at a time, Esc and its collapse close it, the
  focus moves in and back to its tab, its open tab and bodies kept across the
  width. What the drawer holds hears `FrameDrawer` (`./internal`), so a pane
  draws its phone form there — the Sheet's inspector its head and each field a
  section of its own at touch size (`Mobile Sheet Spec.md` SH12). A pane that never collapses and
  an `{ element }` pane stay pinned. A frame given `phonePanel` (the Calendar,
  the Roster, the Allocation: FR9) hears what main and an open pane open
  through `FrameBottomPanel`: `SliceEditPopover` draws in a slot in the flow
  over the strip, as the Sheet's action bar stands, what is above giving way,
  rather than in a popover; the toolbar's stay views. `phoneViews` opens them
  as views instead, over the whole builder (the query builder, `Query Builder
  Phone Spec.md`), and a dock's `phoneTabs` gives the strip a tab for each of a
  single pane's own tabs. Every builder has a phone-sized example
  (a 390px box) that the showcase's `builder-frame-phone.spec.ts` measures.
- **Styles.** The `builderFrame` slot recipe owns every style the frame has.
  The frame sets data attributes (`data-builder-frame`, `data-frame-slot`,
  `data-pane-mode`, `data-collapsed`, `data-scrim`) and geometry only, and a
  host's own recipe keeps what is the host's (the snap grid's canvas column,
  the query builder's status line). A part drawn often — a toolbar item, a
  rail, a row — reads its slot recipe's styles through `useSlotStyles(key,
  variants)` (`./internal`), made once for the theme and its variants, never
  `useSlotRecipe` an instance, which makes every slot again for each (#1398,
  CL9); the frame's own styles and its toolbar's are read so too. The
  shared rail's and a record rail's toolbar items are made again only as
  what they show moves, and so is the key search's
  (`useKeySearchToolbarItem`: its search, its rank, side and words, and its
  own state); the `Toolbar` draws again only as its items move, so a host
  that hands it the same items while what they show holds — the Plan's
  frame, drawn again at each of its canvas's commits as a far jump lands —
  draws and measures nothing of its toolbar again. An item whose content
  moves inside it is still taken from the row's observer, as a width change
  is; a test walking a toolbar's ladder tells the row's observer of each
  width, as the browser does (`toolbar.dom.test.tsx`' `resize`), never draws
  its host again for it. A part drawn a thousand times at once — the
  Calendar timeline's event blocks, as a month of them mounts — draws plain
  elements of its slots' classes (`useSlotClass`, `./internal`): each slot's
  styles made a class once for the theme, with the rules Chakra gives an
  element drawn with them, inserted in the page's emotion cache once.
  Chakra's styled element works its styles out again at every element it
  draws — its css function keys its cache by the whole style object, printed,
  and emotion serialises and hashes what that gives. The class is the one
  Chakra gives an element drawn with those styles, in the one emotion cache
  every renderer package shares (`@emotion/react` is external to each bundle,
  e3-ui-components' `test/one-emotion.spec.ts`), so a class made ahead serves
  any element drawn with them, plain or Chakra's. What a gesture draws — a
  drag's ghost, a drop's preview — has its class made as the page is drawn (the
  Library's `useCardGhost`, `useSlotClass`'s module docs, #1594): a
  rule added as a drag starts invalidates every font in the page in Chromium,
  since Chakra writes each in a cascade layer, and a first drag worked out
  the whole page's styles and laid all of it out again.
- **Retained content** (#1398, CL8). What a builder keeps on screen while it
  reads again — a period stepped to, a narrowing, a new revision — is
  `aria-disabled`, never `inert`, in an `aria-busy` region: readable,
  focusable, its selection kept. The shared drag layer picks nothing up in it
  and takes no drop there, and a Library card in it places nothing on ⏎, takes
  nothing back by its × and adds nothing (`dnd/retained.ts`' `inRetained`).
  The cold-load cover alone is inert.
- **The row's height.** Every control in a builder's toolbar row is 28px
  tall and centred on it (`theme/toolbar-row.ts`, ruled 23 Oct 2026): a chip,
  a segment strip, a stepper, a tab strip, the key search's box and every
  button (`size="sm"`), the history's and the date navigator's among them. The
  showcase's `toolbar-row-heights.spec.ts` holds every builder to it, unfolded
  and folded.
- **The row's floor** (hand retest, 27 Oct 2026). Below the toolbar's ladder
  lies its floor: a fold step ranked at `FLOOR_RANK` (`toolbar/fold.ts`) or
  past it is one of its rungs, taken only once every step of the ladder — the
  history's last among them, and an item that folds last let go — still leaves
  the row too wide, the fewest that fit, and listed apart from the ladder
  (`data-toolbar-floor`), so the ladder still ends with the history's step. The
  rail's trigger is its filter icon alone, without its caret, at `FLOOR_RANK` —
  a one-affordance cluster's summary chip too — then, where the builder's View
  bundles the period's controls on a phone (the Roster's, the Allocation's),
  the Elara eye goes into that View as its entry (`OptimiseEntry`): the eye's
  step out of the row and the View's step that lists it are one bundle at
  `OPTIMISE_RANK`, so the eye never leaves the toolbar (ruled 27 Oct 2026,
  "Into the View menu"); a builder with no such View gives the eye no rung,
  its row holding the eye at every width. The query builder's Run is its icon
  alone: at a phone's width — a frame a 294px parent holds — every builder's
  row holds what it shows, the history and Save in it, and the eye where its
  View takes it, a run and its Stop from there (the showcase's
  `toolbar-fit.spec.ts`). Past its floor the row clips at its end, which no
  width a builder is held to reaches.
- **Shared toolbar items.** The items more than one builder's toolbar takes
  live here, each with a narrower form for a row short of room: the history
  item (`historyToolbarItem`, folding last, to its buttons; its commit reads
  Save in every builder, #1260), the review's batch verbs
  (`reviewToolbarItem`, `./internal`: the summary goes, then the buttons fold
  into one menu — no builder takes it since the Plan's review went, #1260) and
  the key search over a keyed source's `seek`
  (`useKeySearchToolbarItem`: in the row its box is 28px, the search pill's
  height, its input filling it, while the box its popover opens stays the
  design system's 32px field (the combobox recipe's `search` slot, ruled 23
  Oct 2026, #1404); a pick or a step shows its match in the box — the text
  its host gives the row, else its label — its place counted (`3 of 7`), and
  asked again at a new snapshot the box keeps it while the snapshot holds it
  in place; found, its count shows and Enter jumps at once, the popup saying
  `Searching…` until its lines land — a far match's read through its host — or
  why they could not be read, never `No matches` over a range found (#1398,
  CL10); a pick — a match chosen, or Enter in the box — hands the keyboard
  to its host's view, and a step — Previous or Next match — leaves it in the
  box (`KeySearchJump`): the host wraps its source in `usePickHandOff`'s
  `search` (`./internal`) and lands it where its ring lands, once the match
  has landed and the box has let it go — the combobox gives the focus back
  to its input in the frame after a pick — unless the viewer has moved on,
  a key pressed in a control or the focus taken elsewhere; the box folds to
  its icon, which opens it in the edit
  popover — the same box, its query, its matches and its pick kept: the
  toolbar keeps it apart from the item's forms (`keep`), each form showing it
  where it places it — and while a query stands it keeps its form while
  anything else in the row can fold (`foldsLast`), folding to its icon only
  once nothing else can, so a builder's history and Save stay in the row
  (ruled 26 Oct 2026, "Find folds"); a box that folds away holding the focus
  gives it to the icon; while its list is open, or its popover, it keeps its
  form whatever the width; `focusKeySearch` brings
  a host's key for it, the Sheet's ⌘F, to it in either form). A record
  rail's summary (`12 of 69 people`) folds after every step of the rail and
  before a host's own items (`SUMMARY_RANK`, ruled 18 Oct 2026, #1340). Over
  several records it names only the sources a narrowing hides rows of
  (`2 of 30 print job events`), nothing while none does — a source a
  narrowing is in force over keeps its place while its count is read, the
  count pending, so the toolbar never folds again as it lands (#1398, CL1);
  the Filters editor
  heads each source's fields with its count, as a Library tab counts (`6`,
  `2 of 30`), and keeps a line under them only for the sources no heading
  counts (ruled 19 Oct 2026, #1358). Its head counts the rail's own choices,
  each field it lists that holds one (`2 active`) — never a narrowing it
  leaves out: a source's date window, which a builder's navigation writes,
  or a field it does not offer. Every line of the editor wraps within it at
  its spaces — the summary's in the slice's `editor` density
  (`data-density`), where the toolbar's stays one line — never a word cut
  nor a sideways scroll (the showcase's `plan-filters.spec.ts`). Controls
  that fold into one chip (#1229) fold into the shared `ChipMenu`, whose menu
  does what they do: their steps and the chip's share a `bundle`, so the chip
  draws in the step that hides them, and a popover one of them opens hangs
  from the chip (`SliceEditPopover`'s `anchor`), its item `held` while it is
  open — as the SnapGrid editor's View chip and Studio's and the query
  builder's ⋯ chips do. A held item holds its bundles as they stand — applied
  or not — and nothing else: every other member keeps to its side of its step
  of the bundle and takes its other steps as the row's width says, so the row
  folds what is left around the held one (the Schematic's tools fold to their
  chip beside the box Find's query holds, its View held off, #1404); a bundle
  a member is so kept from crossing is held in turn, so none is split. An
  item that joins the row while its bundle is held
  takes the bundle as it stands, folded where the bundle applies, so a
  control appearing beside a held chip never pushes the row past its end (the
  Schematic's steps beside the View Find's query holds, #1395). On a
  coarse pointer a control in the row is a 44px tap target by its box or by its
  halo (`coarseHitArea`, #346), never by growing the row (#1193, #1221): a
  segment whose neighbours sit edge to edge takes the halo on the block axis
  alone (`axis: "block"`), and its strip clips nothing that would cut it; a
  search box is a 44px field, its input filling it.
- **One history over several sessions** (`src/editing/history.ts`, #1194).
  A builder whose sources each keep their own editing session — the Plan's
  event kinds, a record each — puts them under one `EditHistory`: each step
  names the sessions a gesture drafted, so Undo and Redo walk the gestures
  in the order they were made whatever their source, Discard drops every
  session's drafts, and Save applies each session that can, a Retry
  resending only the ones whose answer never came. The history reads as one
  session does, so the history item and the keys take it as they take a
  session; each session keeps its own banners (`SessionBanners`' `name`
  titles them by their source). `useEditHistory` keeps it in the UI store
  per view, beside each source's kept session.
- **A session's drafts, as a preview reads them** (`EditSession.drafts`,
  #1437). The revision of the source the drafts began from, and each entry
  drafted away from its original — its original and its draft as the session
  holds them, and each as the source holds an entry — the same objects until
  a gesture, an Undo, a Redo, a Discard or a confirmed Save replaces one; a
  draft not yet complete is none of them. e3-ui-components' record drafts
  (`shared/records/drafts.ts`) preview each one's Save from it.
- **Drafts carried over a source that moved** (`EditSession.merge`,
  `src/editing/merge.ts`). A source moving under pending drafts carries them
  over to its new base, once each drafted entry is read there (`readIdsAt`, a
  bounded batch a pass): each merged three ways — what both began from, the
  draft, and the source's value now — by East's own patch merge
  (`EntryMerger`). A change of the source's to another part stands beside the
  draft's, and Save sends only what the drafts changed; a part both changed is
  a conflict, the draft's value standing there until a person chooses
  (`settle`), Save waiting; a draft the source now holds whole is a draft no
  more. A conflict the draft leaves by a gesture — its part put at the
  source's value by hand, or the row removed as the source removed it, no
  choice made — began from the source's value once the drafts are carried
  over again (`EntryMerger.began`): the source's next change there is the
  source's to make, never a conflict over a change the person no longer has.
  A choice a Save has taken is no conflict to bring back: Undo past it puts
  back the versions its step moved, nothing of the conflict. A session bound
  `carryOver: false` goes out of date instead (`stale`, Save off). The
  carry-over starts the history over at the drafts. A keyed source's entry
  stands in its key's order whatever version the session makes of it, so the
  other side taken of a row both sessions added is no change of its place
  still to save. A conflict chosen before that reads again — the other side
  taken at one part of an entry that still holds another conflict, then the
  part changed again by a gesture — is chosen as an open one is, over the
  draft as it stands (`settleEach`): put back as it stood before its first
  choice, the draft would lose the change made since. Every conflict chosen
  one way (`settleAll`) turns the earlier choices too, and never brings back
  a row its person removed since: the draft is put back at a part only while
  it still holds the other side there, as its choice left it, and the other
  side is taken at a part of an entry only while the entry is there. Discard
  while the drafts are being carried over — kept drafts restored as a page
  loads, not yet read at the page's revision — leaves the session holding no
  row: put back as they began, they would be the rows of the page before,
  held as the session's own, and a row saved since would show as it stood.
- **What a Save landed, until its rows are read again** (`EditSession.landed`,
  `src/editing/landed.ts`). A Save's confirmation reads its entries by their
  keys. A host whose rows are read apart from it — a paged source's pages, a
  window, a kind's cells — holds them as they stood until they are read again
  at the commit, a round trip a deployed server makes long. Such a host binds
  with `drawsLanded`, draws each landed entry as the Save left it over rows
  read before the Save, and lets it go (`shown`) in the commit that draws rows
  read since, so no frame draws the entry as it stood. Which rows are from
  before a Save is one rule, `readBeforeSave` (`./internal`): read at another
  revision than the one their source reads at now, or their source still at
  the revision the Save was drafted at. A host keeps no rule of its own: a
  revision names content and has no order, and a rule keyed on the revision a
  Save was drafted at lost a rack saved twice before its window was read
  again, drawing it where it stood before either Save. e3-ui-components'
  Schematic windows (`schematic/drafted.ts`) and schedule cells
  (`shared/schedule/cells.ts`) read by it; its Sheet reads its rows by the
  same test, said over its own row positions (`sheet/use-editing.ts`'
  `awaiting`).
- **A Save never stops the editing** (`EditSession`, `src/editing/session.ts`). A session takes gestures, Undo and
  Redo while its request is on its way, while what it saved is read back, while a write has no answer and while its
  drafts are carried over to a source that moved; another view's request for the source holds its Save, never its
  gestures (`writable` says a gesture is taken, `canApply` that a Save can be sent). The request keeps the bytes it
  was sent with. Confirmed, what it left is the original of each entry it held, so what was drafted since is what is
  left to save, each change from what the Save left. A read back that differs — another write beside the Save's —
  keeps those drafts, each merged over the source's value from the version the request sent, a part both changed a
  conflict to choose; what was not drafted since goes with the history, as when the source moves under no drafts.
  Discard stays off until the request resolves. A host that tells a Save's own entries from those drafted since it
  was sent asks `sends(id)` (the Sheet's counts). Over several sessions (`EditHistory`), a session whose drafts fail
  their checks, or that holds a conflict still to choose, holds back its own changes alone: Save sends the others',
  and waits, saying why, only once nothing else can be sent. An entry first drafted while a Save was out began from
  a version read before the revision that Save made: where another write changed the same part of it meanwhile, the
  source refuses the next Save with nothing newer to move to. The session reads a refused Save's entries at its own
  revision too, once (`nameConflicts`), and where a change no longer applies there carries its drafts over at that
  revision, as to one the source moves to — the part both changed a conflict to choose — rather than wait for a
  revision that never comes. A Save refused once its every draft was taken back — Undo while the request was out, or
  while its drafts were carried over — says nothing: no draft is left for a refusal to stand over. A Save the source
  acknowledged is read back at the revision it committed or a later one; once the source has read at that revision,
  an entry it then holds as its edit began was put back by another write — a row the Save added, removed since — and
  is acknowledged so, never waited on for a read that would not come (`Submission.reached`). A session takes its
  snapshot apply (`Editing.apply`) when a snapshot is first applied — one over a source at a revision, as every
  paged record's is, takes none — and an apply is compiled once for the types it applies over, East's own equality
  telling two alike, and kept for every session over them (`transformOver`). What the tab keeps of the drafts through a reload (`keptEntries`, `keep.ts`) counts a
  Save the source has acknowledged as saved, whatever of it is still to be read back: an entry it held began from
  what it left, so one unchanged since is no draft to keep, and one changed since — put back by Undo among them — is
  kept as a change from it. Kept from its original, a saved entry another write then changed came back as a conflict
  over a change already saved, and an Undo made meanwhile was not kept at all. A record slice's Save is prepared
  before it is sent (`prepare`): the request is made as Save is pressed and sent once the preparation is done, so
  nothing done meanwhile goes with it, and one that fails sends nothing and keeps every draft. Over a source read
  whole — its base the collection, with no revision to read at — a Save is read back once any entry of its shows the
  collection was read after it landed (`landedIn`): one commit lands whole, so an entry as the request left it, or as
  neither side of its change — the same part changed again by another write, or the entry removed — says it for
  them all, each acknowledged as the collection holds it. Waited on until every entry read as the request left it, a
  Save another write overtook on the same part before the source was read again waited for good, Save and Discard
  off. And a draft made while that Save was read back, from a row the collection it is acknowledged at no longer
  holds so, is carried over to that collection there and then (`draftedBehind`) — a part both changed a conflict to
  choose — where left as it began its Save was refused over the session's own base, nothing newer to move to and
  nothing to choose. Still open: every part a Save wrote put back exactly as it was by another write, before the
  source is read again, reads as a collection from before the Save, and waits until the page is reloaded — the
  source must say which state it read (as a source at a revision does), which a collection alone cannot.
- **The editing core's proof harness** (`src/editing/model/`, in the unit suite). It runs the code itself through
  what can happen to it, never examples (`explore.test-utils.ts`):
  - **Every ordering to a depth** (`everyOrdering`): each from a fresh model, two operations whose order is no matter
    in one order only, and seeded random runs past the depth — each checked after every operation and again once
    brought to rest (`session-model.test.ts`, `history-model.test.ts`).
  - **Every state** (`everyState`, `states-model.test.ts`): a model whose people are budgeted — so many gestures and
    choices, so many requests, so many of another session's writes — can be in finitely many states. Each is told by
    its print (`fingerprint`): every field the record, the sessions, the history and their people's steps hold,
    private ones too, each object once and what is shared read as shared, ids drawn at random named by their order.
    Every operation is run from every state until none is new, so what the harness holds then holds of every state
    the code can reach under those budgets, however many operations away. A field added to `EditSession` or
    `EditHistory` is in the print unless it is named as no state (`SESSION_NO_STATE`): a cache, or a counter that
    only counts.
  - **One session** (`world.test-utils.ts`, run by `session-model.test.ts`). `record.test-utils.ts` is a small record
    that checks a Save's batch as `Record.onApply` does — East's patch apply a row, a revision a commit, a request id
    answered once — and the world is sessions over it, each with a screen of its own, driven as `useEditSession`
    drives one, with every operation that can meet in one: gestures, an optimiser's result, Undo, Redo, Discard, a
    conflict's choice — one at a time, or every one — a Save prepared before it is sent, its preparation failing, its
    answer, an answer lost and asked again, an automatic Save, the page reloaded with its drafts kept, another
    session's write, a revision heard of before its rows are read, reads landing a row at a time, a screen redrawn
    late — over a source read a revision at a time, or read whole (`inline`), its base the collection itself. It
    holds, of every ordering: a gesture is taken and changes what it names alone; a Save writes what its
    person's screen showed as it was pressed, and changes a field only from a value they had been shown; an automatic
    Save writes the screen as it stood before an optimiser's result no person's Save has taken, and nothing from
    where Undo or Redo left the steps, and is there exactly while it has something it may send; no change is lost,
    and none is sent twice; a conflict is asked only of a
    change still to save, and never again once chosen; Undo then Redo is where it was; and answered, read and
    chosen, every session is idle with its screen the record.
  - **One history over a session a record** (`desk.test-utils.ts`, run by `history-model.test.ts`): one person over
    two records, as the Roster's duties and weeks are — a gesture in one record or across both, an optimiser's
    result in either, Undo, Redo, Discard (the history's, or one record's banner's), Save, an automatic Save, each
    record's request answered, unanswered or lost and asked again, and each record's reads landing late. No one else
    writes there, so what the person should see is known exactly. It holds: one step a gesture, taken back and
    replayed whole, and each session's own steps the history's steps' parts in it; the screen the person's steps,
    through every Save; each record's request what its person saw; an automatic Save stopping at the first result
    that waits in any record, in the order the gestures were made, and there exactly while it has something it may
    send; one request a record at a time; and at rest each record holding what its screen shows.
  - **What it only counts**, and holds nothing of yet: the orderings in which a session's steps went under its
    person as the source moved, those in which a screen went back to an older value, those in which a reload lost a
    change made while a Save's outcome was unknown, or asked of one already saved, and those in which a Save over a
    source read whole waited for good, every part it wrote put back exactly. Each is a fault still to close, never
    a behaviour to keep.
  - **What it does not model yet:** a source that is an ordered list (an Array with an identity field, its entries
    placed before and after one another), ranges settled together, and an entry given a new key.
  - **Using it.** A change to `session.ts`, `history.ts` or `merge.ts` runs it deeper before it lands
    (`EDITING_MODEL_DEPTH=1 EDITING_MODEL_RUNS=20`, some ten minutes, and `EDITING_MODEL_STATES=1`, each family's
    larger budgets, some tens of minutes; `--silent=false --reporter=verbose` shows what each exploration covered). A fault it finds is added to its replays, by name, each proved to fail over the code
    as it stood. A check added to it is proved to bite: the code broken by hand where the check should catch it, the
    harness run, the break put back.
- **An automatic Save** (`src/editing/autosave.ts`, `use-autosave.ts`, `autosave-choice.ts`). Where a builder keeps a
  session or a history (`useEditSession`, `useEditHistory`), the history bar's Save is a split button: its chevron opens
  the choice — one switch, Autosave (ruled 11 Nov 2026: the theme's switch and its one word, never a pair of choices to
  read). It begins where the builder's author says — `useEditSession`'s and `useEditHistory`'s `autosave`, which each
  builder gives its payload's (ruled 11 Nov 2026: a Boolean the author writes or data drives); off, said nothing — and
  follows the author's word as it moves, until its viewer flicks it: the viewer's own choice is then kept for the
  builder in the browser, by its data set (`EditingScope`) and its view, and stands over the author's, so a choice made
  over one data set never saves another's (`autosave-choice.ts`' `beginAutosave`; kept state's `useKeptValue` reads a
  choice as kept, nothing while none is). The switch is within reach in every form of the bar, so an author's on is
  never one nobody can turn off: a phone's row shows the buttons themselves where they fit — Discard, and Save's chevron
  a square on Save's edge — and where it is short of them (ruled 11 Nov 2026) More, an ellipsis square in Discard's
  place, which opens the switch and Discard changes in the frame's bottom panel; the row is its five squares either way
  (`HistoryBar.tsx`' `MoreControl`, the `editHistory` recipe's `whereRowIsShort`). On, the changes are sent a pause (two seconds) after
  the person's last act — a gesture, a key pressed, a pointer let go — one request at a time; never under a held
  pointer, a drag, an open editor (the bar's `editing`) or a run of the optimiser (`locked`); at once as the tab is
  hidden; and what fails is tried again, each wait twice the last up to a minute. One timer a session or history, shared
  by every form of the bar its toolbar draws, there while a bar shows it. It sends through the session itself, never the
  bar's `onAction`, so it commits no open editor. An optimiser's result is never sent by itself
  (`EditSession.heldFrom`): what was changed before it goes, and the result and every change made after it — in any
  session of a history, in the order the gestures were made — wait for a person's Save, which takes every step done so
  far; an Undo of the result ends the wait too. While one waits, the split button — Save and its chevron, one outline —
  wears the Elara ring (`theme/elara-ring.ts`), and Save's tooltip and the panel say why. Nor is an Undo or a Redo
  ever sent by itself (ruled 11 Nov 2026, `EditSession.stepped`): an automatic Save sends only from where the last
  change left the steps, so a person who steps back to look has saved nothing, and one who wants an earlier state
  saved presses Save, which takes where the steps stand as theirs — Save's tooltip says so meanwhile. Back where the
  last change left them nothing waits; the next change is saved with what stands under it; over several sessions the
  step is the history's; and where the history goes, or the page reloads, what Undo left waits as it did. Where the history that held a result goes — a carry-over, a read back beside
  another write, a reload — every draft waits. An automatic Save shows on Save alone, its live dot: its words in the row
  would come and go every few seconds. A collection whose every Save is a person's keeps no choice
  (`useEditSession`'s `manualSave`): the query builder, whose Save asks a new query its name, which an automatic Save
  would pass by — so a host whose Save asks the person something first opts out, never the bar. The chevron is named
  `Automatic saving`: beside Save, no second button holds `Save` in its name, so whoever asks the page for Save by a
  part of its name — a script's `getByRole("button", { name: "Save" })`, a voice — finds Save alone. The two parts
  stand edge to edge, the edge between them the chevron's, and the bar is no wider for the chevron: with the split
  its five squares stand 4 apart in place of 8 and the chevron takes the 16 that leaves (12 where the bar is its
  buttons alone), so no toolbar's row folds sooner than it did — a row may have a few pixels to spare at a width
  that matters, as the Calendar's has at 768. Under a touch pointer each square, and the chevron, takes its target's
  height alone, none a tap meant for the one beside it (`editHistory`). In a phone's frame the chevron is a square of the second row on Save's edge, there
  where the row holds its six squares whole — the recipe's rule over the row's own width (`ROW_HOLDS`: 280px of the
  row's content, the five squares and its own, the eye's 48 more while it is in the row; so from a 308px frame, 356px
  with the eye) — and its choice opens in the frame's bottom panel, as the row's conflicts do. The drafts' count gives
  way to the six until the row holds its room too (`ROW_COUNTS`: 310px; a 338px frame, 386px with the eye): between
  the two widths it is a pixel wide, its words wrapped under its clip, and takes none of the row. Short of the six
  (ruled 11 Nov 2026: the buttons themselves wherever they fit, More only where they do not) there is no room for a
  sixth square of any kind: the chevron is not there, Save is a whole square
  and More stands in Discard's place: one press opens the Autosave switch and Discard changes in the bottom panel, and
  Discard changes discards at its one press — the press of More came first, as the row's own Discard asks first in its
  band. Both forms are in the page and the recipe shows one (`whereRowIsShort`, the exact other side of the chevron's
  width); a bar no row asks its width — outside a frame, or in a page that lays nothing out — draws the buttons
  themselves. Each square's icon stands at its middle on whole pixels: the `iconButton` recipe's glyph is an even 14px
  in its 28px square, and Save's tick and its chevron stand higher by what Font Awesome draws them below their boxes'
  middles. The browser suite holds all of it on the page's e3 (`autosave.spec.ts`, `builder-frame-phone.spec.ts`).
- **The data set editing belongs to** (`EditingScope`, `src/editing/scope.ts`).
  A host whose sources are one data set's names it — e3-ui-components'
  `E3Provider` names the server, repository and workspace — and each
  session, history and draft kept through a reload is held under it, so the
  same view over another data set in the tab, its sources of the same names,
  never takes them. With none named, a page's sources are its own.

## Field form

A builder's inspector shows the selection as a typed form: east-ui's
`Fields.specs(R, hints)` resolves a struct's fields into specs, and
`FieldForm` (`src/forms/field-form/`, #1147) draws each one as the shared
`Field` around the shared input its East type takes (`isTypeEqual`) —
`StringInput`, `IntegerInput` / `FloatInput`, `Checkbox`, `DateTimeInput`,
`Select`, `TagsInput` — a variant of up to four `NullType` cases a
`RadioGroup` instead of a `Select`, in every form (#1473) — each mounted with a payload built from East's
`defaultValue` of its type, never a control of its own. What is typed is one
edit when the focus leaves the field or on Enter, and Esc puts it back; a
choice is an edit at once. A field that differs from `baseline` is tinted
(`data-dirty`; the `fieldForm` recipe lays the fields out). It is a React part
for renderers, as `BuilderFrame` is. Inside a `Field`, the shared date input
takes the field's label and read-only as the Ark inputs do.

Every field is one column (#1220): its label, its control's line — the
input filling it, an Option's Set or Clear at its end (`data-field-line`,
`data-field-side`) — and its help line. Each input is the design system's
Input size, so every kind stands on one 32px line (44px on a coarse
pointer); fields sit 16px apart, a nested struct's head 8px over its first
field. A text, a choice or a printed value longer than its box ends in an
ellipsis, its control titled with the whole (#1250). The showcase's
`inspector-form.spec.ts` measures it in the Sheet's, the Plan's, the
Flowchart's and the Schematic's inspectors.

The shared inputs' sizes are one line each — `theme/field-chrome.ts` ›
`fieldHeights`: `sm` 26px, `md` 32px, `lg` 44px — set on each control's
bordered box (the input, the select's trigger, the number's root, the date's
shell, the tags' control) with what it holds centred. Chakra's default
recipes merge beneath ours and give their sizes a `textStyle` (14px on 20px)
that outranks a size's own `fontSize`: a size variant that sets a font clears
it (`textStyle: "none"`). `field-heights.spec.ts` holds every kind to its
size's line.

## Platform function registration

East programs declare platform functions (e.g. `Clipboard.copy`,
`State.bind`, `Slice.bind`) in `@elaraai/east-ui`'s `src/platform/`. Each
declaration is just a typed signature — the actual side-effecting
implementation lives **here**, in `east-ui-components`, and must be
**registered at module load** before any East IR that calls it gets
compiled.

Without registration the runtime errors with
`Platform function '<name>' is not available`.

### How it works

`src/platform/registry.ts` holds a single list of registered
`PlatformFunction[]`. The IR compiler queries it via
`getRegisteredPlatformImplementations()`. Modules add to the list by
calling `registerPlatformImplementation(...)` at top level — pure module
side-effect, no factory, no provider.

```ts
// src/platform/clipboard/index.ts — minimal pattern
import { type PlatformFunction } from "@elaraai/east/internal";
import { Clipboard } from "@elaraai/east-ui";
import { registerPlatformImplementation } from "../registry.js";

export const ClipboardImpl: PlatformFunction[] = [
    Clipboard.copy.implement((text: unknown) => copyToClipboard(text as string)),
];

registerPlatformImplementation(ClipboardImpl);
```

### Three impl flavours

1. **Pure / browser-API only** — `src/platform/<name>/index.ts`. No
   React, no store. Examples: `clipboard`, `download`, `share`.
2. **Stateful (needs reactive store)** — alongside
   `src/platform/state-runtime.ts`. Pulls in `UIStore` and
   `registerReactiveTracker` so reads register dependencies and writes
   notify subscribers. Reference: `state-runtime.ts`'s `StateImpl`.
3. **UI-bound (needs React component context)** — co-located with the
   component, registered the same way. Reference:
   `src/feedback/toast/index.tsx` (`ToastImpl`) and
   `src/overlays/overlay-manager.tsx` (`OverlayImpl`).

### Ensuring the side-effect runs (TWO re-exports required)

`registerPlatformImplementation` only fires when the containing module
loads, and a module only loads if something in the bundle imports it.
A new platform impl therefore needs **both** re-export hops — missing the
second is the classic *"Platform function 'xxx' is not available"* runtime
error even though the impl file exists:

1. **impl module → `src/platform/index.ts`**

   ```ts
   export { ClipboardImpl } from "./clipboard/index.js";
   ```

2. **`src/platform/index.ts` → `src/index.ts`** (the package barrel) — this
   is the hop that's easy to forget. `src/platform/index.ts` is not itself
   pulled into the bundle; the top-level `src/index.ts` must re-export the
   impl symbol so the module actually loads:

   ```ts
   // src/index.ts
   export {
       StateImpl, StateRuntime,
       SliceImpl, SliceApplyImpl,   // ← add the new impl here too
       ClipboardImpl, DownloadImpl, ShareImpl,
   } from "./platform/index.js";
   ```

**Checklist for any new `*.bind` / platform call:** declare in
`@elaraai/east-ui`'s `src/platform/<name>/` → implement +
`registerPlatformImplementation(...)` here → re-export the impl from
`src/platform/index.ts` → re-export it again from `src/index.ts`. Skipping
the last step compiles fine but fails at render with
`Platform function '<name>' is not available`.

For UI-bound impls inside a component module (`Toast`, `OverlayManager`),
make sure the component is imported from `src/index.ts`.

### Re-registering a pure impl shipped from `@elaraai/east-ui`

Some pure-JS impls live in `@elaraai/east-ui` (e.g. `SliceApplyImpl`).
The shim here just re-exports and registers:

```ts
// src/platform/slice/index.ts
import { SliceApplyImpl } from "@elaraai/east-ui";
import { registerPlatformImplementation } from "../registry.js";

registerPlatformImplementation(SliceApplyImpl);
export { SliceApplyImpl };
```

Then add `export { SliceApplyImpl } from "./slice/index.js"` to
`src/platform/index.ts`. Stateful platforms (e.g. `slice_bind`) still
need a runtime impl written here in the flavour-2 style.

## React best practices

These rules apply to every component in this package. They reflect
React 19 conventions and the patterns established in this codebase.

### Memoization

Every component MUST be wrapped in `memo()` with a custom equality
function using East's `equivalentFor`:

```tsx
const fooEqual = equivalentFor(Foo.Types.Foo);

export const EastChakraFoo = memo(function EastChakraFoo({ value }: Props) {
    // ...
}, (prev, next) => fooEqual(prev.value, next.value));
```

**Why:** East values are immutable, so a structural comparison prevents
re-renders when nothing changed. It must be `equivalentFor`, not
`equalFor` (#809): `equalFor` treats every pair of functions as equal, so
a value whose only change is a callback that captured new data — an
`onClick` over a new selection, a Plan resolver over a new lookup — would
bail here, and the renderer would keep calling the stale closure.
`equivalentFor` compares a function by its IR and its captured values.

Include additional props (e.g. `storageKey`) in the comparator:

```tsx
(prev, next) => fooEqual(prev.value, next.value) && prev.storageKey === next.storageKey
```

#### Data changes vs closure changes

Because the memo lets a closure-only change through, a new `value` does
not mean new data. Anything that RESETS local state or re-derives from the
value's data keys on the DATA, never on `value`'s identity:

- `useValueSync(value, fooDataEqual, sync)` — the interactive-state
  re-sync (below): runs `sync` only when `fooDataEqual` (the type's
  `equalFor`) says the data changed.
- `useDataStable(value, fooDataEqual)` — a value whose identity changes
  only with its data. Key memos, effects and overlay resets on it (read
  only data through it — its closures may be stale).

Callbacks are always taken from `value` itself, so the latest closure runs.

### useMemo

Use for:
- Derived props from East values (`toChakra*` conversions).
- Extracted callbacks from East style options
  (`getSomeorUndefined(style.onFoo)`).
- Computed data (column definitions, date ranges, slot positions).
- Reactive state slices when destructuring consolidated persisted state.

Do NOT use for:
- Simple property access (e.g. `value.items.length`).
- Already-primitive values or stable references.
- Object literals used once in JSX (inline instead).

### useCallback

Use for:
- Event handlers passed to child components or DOM.
- Callbacks that update persisted state.
- Handlers passed to TanStack Table (`onSortingChange`,
  `onColumnSizingChange`).

Wrap East-side callbacks with `queueMicrotask`:

```tsx
const handleClick = useCallback((details: { value: string }) => {
    setPersistedState(prev => ({ ...prev, selectedValue: details.value }));
    if (onClickFn) queueMicrotask(() => onClickFn(details.value));
}, [onClickFn, setPersistedState]);
```

### useState vs usePersistedState

`usePersistedState` (with `storageKey`) for **user layout preferences**
that should survive reloads: sort config, column widths, splitter
positions, expanded/collapsed state.

Plain `useState` for **transient interaction state**: row selection,
hover, loading indicators, drag state, scroll position.

`usePersistedState` accepts a single consolidated state object per
component — avoids sync issues between independent localStorage keys.

### Props pattern

Components receive East values via a `value` prop typed
`ValueTypeOf<typeof Foo.Types.Foo>`. Extract optional style fields with
`getSomeorUndefined`:

```tsx
const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
const onFooFn = useMemo(() => style ? getSomeorUndefined(style.onFoo) : undefined, [style]);
```

### Interactive-state renderer pattern (MANDATORY)

Per `[UI controlled components]` memory. Canonical reference:
`src/forms/input/index.tsx` — every interactive renderer must mirror its
structure (local `useState` + `useValueSync` re-sync + `queueMicrotask`
for callbacks).

```tsx
const fooEqual = equivalentFor(Foo.Types.Foo);   // the memo
const fooDataEqual = equalFor(Foo.Types.Foo);    // the re-sync gate

export const EastChakraFoo = memo(function EastChakraFoo({ value }: EastChakraFooProps) {
    // 1. Local state, initialised from the East value prop.
    const [state, setState] = useState(toInitial(value));

    // 2. External DATA changes push into local state — a closure-only
    //    change never resets it (#809).
    useValueSync(value, fooDataEqual, () => setState(toInitial(value)));

    // 3. Callbacks extracted + memoised.
    const onChangeFn = useMemo(() => getSomeorUndefined(value.onChange), [value.onChange]);

    // 4. Event handler: compute next OUTSIDE any updater,
    //    setState THEN queueMicrotask as two top-level statements.
    const handleChange = useCallback((next: T) => {
        setState(next);
        if (onChangeFn) queueMicrotask(() => onChangeFn(next));
    }, [onChangeFn]);

    return <ChakraFoo value={state} onChange={handleChange} />;
}, (prev, next) => fooEqual(prev.value, next.value));
```

**Six renderer-bug violations PRs MUST NOT land with:**

1. `onXxx` callback exists but no local `useState` for the state it
   drives.
2. `useState` exists but no `useValueSync` re-sync — stale when the
   parent's data changes. (A bare `useEffect(..., [value])` is wrong too:
   it resets on a closure-only change, #809.)
3. Callback fired synchronously (no `queueMicrotask`).
4. `queueMicrotask` (or any side effect) placed **inside** a
   `setState(prev => ...)` updater — StrictMode invokes updaters twice
   and fires the callback twice. Always compute `next` outside the
   updater; `setState(next)` and `queueMicrotask(...)` are separate
   statements.
5. Handler bypasses `setState` and relies solely on
   `callback → State.write → Reactive.Root → new prop → UI update`
   (widget is inert without a bound callback).
6. `onXxx` used bare from `value.onXxx` instead of `useMemo(() =>
   getSomeorUndefined(value.onXxx), [value.onXxx])`.

**For `next = !prev` (Toggle-style):** read `prev` from the closure over
the state variable and add it to the `useCallback` deps. Do not read
prior state inside the updater.

**Applies to:** `Toggle`, `Accordion`, `Tabs`, `Carousel`,
`SegmentGroup`, `Collapsible`, `Disclosure` (show-more), `Steps`,
`OptionList`, every `forms/*` renderer (`Input`, `Select`, `Combobox`,
`Slider`, `Switch`, `Checkbox`, `TagsInput`, `TextArea`, date/time),
`TreeView` (expand/select), `DataList` (selection). Any future
interactive primitive.

### Controlled vs uncontrolled

When adding persistence to Chakra components that support both
`defaultValue` and `value`:

- **Without `storageKey`:** pass through the East value's
  `defaultValue` / `value` as-is (uncontrolled).
- **With `storageKey`:** switch to controlled — pass
  `value={persistedState.x}` and update via `onValueChange`.

```tsx
{...(storageKey
    ? { value: persistedState.selectedValue }
    : { defaultValue: getSomeorUndefined(value.defaultValue) }
)}
```

### A Table's and a Value tree's phone form

At 560 px of its own width or narrower each draws its phone form by itself, no flag (FR10, ruled 4 Nov 2026): the Table pins one column and pages the rest (`collections/table/phone-fit.ts`, pure), no sideways scroll, every word whole; the tree's rows are measured, a branch 44, a field at least 36. The showcase's `visual-invariants.spec.ts` holds both.

### Virtualization (Table, and the Plan and the Sheet in e3-ui-components)

Row virtualization via `@tanstack/react-virtual`:

- The Table's rows: `RowStateManager` tracks loading/loaded/unloaded per row,
  and visible rows trigger loading with a configurable delay (`loadingDelay`)
  — the Table's alone.
- The Plan's and the Sheet's rows not yet read are the shared unloaded run
  (#1398, CL2: `UnloadedRun` over `runRows`, `collections/loading/`, through
  `./internal`): rows at the collection's real pitch, drawn only where the run
  meets the viewport, the virtualizer counting the run as one item. `VirtualRows`
  draws again only as its mounted range moves, so a run follows the view itself
  through what scrolls the frame's rows (`useRowsScroll`, `rows-scroll.ts`): a
  run the frame positions reads its part in view as it renders, from the
  frame's scroll offset and where it placed the run (`useRowTop`,
  `RowsScroll.viewAt`), so a window landing above it draws it there in that
  one commit; one in flow is placed before paint. Either is drawn again only
  as a row comes into the view or leaves it. A region whose items have no known position yet takes
  the shared wash (`LoadingWash`). When a placeholder's fill and the footer's
  loading line show is the builder's one reveal clock (CL4, `LoadingReveal`
  around its frame, read where it shows with `useRevealed`): after 150 ms, held
  at least 300 ms; geometry draws at once, and a shape keeps its footprint,
  unseen, until then (`data-unrevealed`). A failure is said once in place
  (`LoadingFailedLine` in a row, `LoadingFailedBox` where no row can hold
  one, CL11), and a region its read found empty once, only after the read, in
  the failed line's slot and shape (`LoadingEmptyLine`, CL13: one line, its
  hint dropped whole where it does not fit). A builder's toolbar slots held
  from cold load — its status, issues and Publish — take the loading recipe's
  `heldToolbarSlot` (CL1).
- A count that lands before its rows sizes the ledger at the rows' declared
  pitch (`createLedger`'s pitch), never at its starting 32px an element (CL1).
- A scroll draws only the rows it brings into view (#1398, CL9): `VirtualRows`
  draws a mounted row again only as its index or `renderRow` moves, so a
  collection keeps `renderRow` the same function while what its rows show
  holds; a row that says something once, in the first row in view, reads which
  that is itself (`useRowsTop`). A collection whose estimate cannot know its
  rows' heights measures its kinds' first rows on the device-pixel grid the
  frame places them on (`devicePixels`) and lets every row anchor, so a jump
  past rows not drawn is never pulled back as they mount; `rootProps` names a
  bounded frame's scroll element.
- A scroll the frame asks of its virtualizer — a request, its follow, an
  anchor brought back — is reported to the virtualizer at once, read back live
  through its own offset callback as the scroll's event would report it
  (#1398): what mounts before that event arrives — a window landing where the
  view was, its rows measured off their estimate, as every row is on a
  fractional device pixel ratio — is placed from where the view went and never
  takes it back there, nor does a correction the virtualizer held back at the
  scroll's end; and the range reported meanwhile says where the view is. A
  request (`scrollToIndex`) and an anchor brought back (`restoreAnchor`) are
  served in a layout effect of the commit that asks for them, so the rows they
  bring into view are drawn before paint: a builder that lands the keyboard's
  far move with the rows it reads (the Plan's and the Sheet's Home and End)
  never paints a frame of them at the old offset, no rows where the view went.
  The request's effect is declared after its follow's: a requested row is in
  the virtualizer's range at once but mounted, and measured, only in the
  render the scroll asks for, so the follow takes it up from that render's
  commit — settled in its own, a row measured taller than its estimate was
  never brought wholly into view.
- A frame that anchors its own scroll (keyed, given `anchorable`, its rows
  positioned) is the only one to: the browser's scroll anchoring is off on its
  scroll element, or at scale on its root (`overflow-anchor: none`). Left on,
  the browser anchors on the focused element first, and a window landing that
  moved it — a Plan's run not read that a click focused, its rows replacing
  it — moved the view by itself, by as much as the run (#1398).
- A collection that draws the rows it has not read as one run — keyed by the
  rows it stands for, so a window landing in it makes other items — names
  where its rows stand in its runs (`runs`, `RowRuns`; the Calendar's timeline
  over a paged resource kind, #1424): an anchorable run covering the view's top
  anchors the frame on the row inside it there, by the key that row takes once
  read, found again on its own line once its window lands, or in the run that
  then holds it — so the rows landing around it never move it, however their
  heights part from the run's pitch.
- A bounded frame of measured rows sticks the first rows of each of its
  sections under its header (`sections`, `StickySection`, #1568: the Roster's
  People bands with the work requirement under each). Each head row sticks
  under the stuck rows above it, in a rail of its own from its place to where
  the stuck head, whole, meets its section's end (`stuckRows`, pure), so the
  next section's start pushes the head out at once and CSS alone holds it: a
  scroll draws nothing again. A head taller than half the view keeps only its
  rows that do not `yield`, in order, while they fit in that half; the rest
  scroll with the section. The head of the section the view is in stays
  mounted however far in the view goes — the range extractor puts it first,
  so the rows stay in index order — and the next section's head carries its
  rails as soon as it mounts. A row a request brings in at its start lands
  under a stuck head, as it lands under the header — a head row that yields
  too — and so does an element the focus or a scroll into view brings in:
  each place names what covers its row (`--virtual-cover`: the header and the
  stuck rows over it, or above a stuck row), its elements' scroll margin, so
  the keyboard never lands under the head (WCAG 2.4.11) and a stuck row takes
  the focus where it stands. Each row there is two boxes, its place, which the
  frame moves by its `top` — never a transform: a browser sticks a row where
  layout puts it, before its place's transform, which doubled each stuck
  row's offset — and the row, the one measured (`data-index`), so a row that
  comes to head a section, or ceases to, keeps its element. The host's recipe
  paints a stuck row (`[data-virtual-stuck] > [data-index]`), opaque as its
  header is: the Roster's `scroll` slot. An anchoring frame whose anchor went with its section's rows
  keeps the head's first row where it showed: a band folded from its stuck
  place stays at the view's top, the focus on it.
- A row an anchoring commit mounts above the view, measured off its estimate —
  a stuck head's, an overscan row — moves the virtualizer's offset on by as
  much as it grew, and the offset the commit writes is the anchored one with
  that correction (`virtualizer.scrollOffset ?? anchored`), never the render's
  alone, which took the view back by as much as a remount drew it (#1568).
  Every anchoring frame takes it: the Roster's, the Sheet's, the Calendar's and
  the Plan's.

**Persist scroll as a clamped ROW INDEX, never a pixel `scrollTop`.** The
top visible row index survives data changes (restore clamps to the current
row count); a raw pixel offset does not. The `Table` does this via its
consolidated persisted state (`scrollIndex`, restored once on mount — #143).
Do **not** persist a pixel offset.

### Module-level constants

Pre-define equality functions at module scope (outside the component):

```tsx
const fooEqual = equivalentFor(Foo.Types.Foo);   // the memo
const fooDataEqual = equalFor(Foo.Types.Foo);    // a data gate, when one is needed
```

Also define pure conversion functions (`toChakra*`) at module scope.
They're called inside `useMemo` but defined outside the component to
avoid re-creation.

### Exports

All public components and types are exported from `src/index.ts`. When
adding a new component or hook, add it to the appropriate section in the
barrel export.

Two more entries serve the sibling renderer packages, never apps:
`src/internal.ts` (`@elaraai/east-ui-components/internal`) re-exports the
renderers' shared building blocks a component made of the same parts needs
(e3-ui-components' Plan, Sheet, Flowchart and Schematic, #1177, #1179, #1243, #1384), and `src/testing.ts` (`/testing`) the
renderer tests' DOM helpers — React's `act` and the DOM, no test framework —
and the editing words (`editingMessages`), which a browser spec names the
history item's controls by: unlike the package's own entry, it loads in Node.

## See also

- [`../../../../docs/conventions/EAST_TS_INTEROP.md`](../../../../docs/conventions/EAST_TS_INTEROP.md) — `isValueOf`, `compareFor`, `variant` rules
- [`../east-ui/CLAUDE.md`](../east-ui/CLAUDE.md) — East-side component definitions (the IR layer this package renders)
- `src/forms/input/index.tsx` — canonical reference for the interactive-state renderer pattern
- [`../east-ui/STANDARDS.md`](../east-ui/STANDARDS.md) — TypeDoc + testing standards (shared with east-ui)
- `libs/east-ui/app_design_system/` — the East Design System, downloaded read-only (tokens, guidelines, spec cards)
