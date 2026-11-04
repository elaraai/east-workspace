# Studio on a phone

**Status:** proposal, 4 Nov 2026. **Visual source:** `Studio Mobile.html` (self-contained; every phone is live).
**Applies at:** a builder frame 560 px wide or narrower. Drawn at 390, checked at 324 and 294. Above 560 nothing changes.
**Builds on:** `Mobile Builder Frame Spec.md` (FR1–FR8, R1–R6) and `Mobile Filters Spec.md`, which stand as ruled. Ids below (ST…) are for tests and review. State numbers (01–22) are the phones in the HTML.

## 1 · The four answers

1. **What Studio is for on a phone: reviewing and tweaking.** You check a page as phone users will get it, fix a tile, add a missing one, and publish. Composing a page from a blank grid stays on desktop. The canvas is one column of real tiles in row order, the stack `<Studio.Page>` already draws under 390 px (F4). The 12-column grid stays in the record, the span stepper and each tile's span meter. The canvas no longer draws it (01).
2. **Add, move and resize without dragging: pick, then place.** A card in Components (add) or Move on a selected tile (move) turns the page into its outline, with a dashed slot wherever the tile fits. One tap places it (04–07). Column span is a − / + stepper that only grows into free columns, so no neighbour moves (03). Remove is a draft like any other, and Undo brings it back.
3. **Where the page's actions live.** Preview and Publish stay in the first row. Save as template stays there at 390 and folds into ⋯ below 372 px (12, 13). Zoom goes, because the canvas is drawn at the frame's width. Device moves into Preview as Mobile · Tablet · Desktop (15, 16).
4. **Page or Inspector: both, split by what you need to see.** The tile's bar under the page holds the gestures you would drag on desktop (Move, Column span, Remove), because their result has to stay in view (02). The Inspector is a full view that covers the page. It holds what the tile reads, its configuration, Row, Height and Align, and repeats Column span as desktop does (09).

## 2 · The stack (390 × 844 phone)

| Band | Height | Holds |
|---|---|---|
| Safe area | 47 | device |
| Toolbar | 44 | status · Save as template (≥ 372) · Preview · Publish · ⋯ (< 372) |
| Session row | 56 | summary · Issues · Undo · Redo · Discard · Save (FR6) |
| Main | fills | page head, rows, tiles, Add a component; `--paper-2` |
| Bottom container | content | tile bar 176 · place bar about 100 |
| Notice band | content, about 52 | while a notice stands (frame §7) |
| Pane strip | 44 | Components 7 · Inspector row N (FR4) |
| Safe area | 34 | device |

At rest, main is 575 tall at 390 × 844. It is 573 in the showcase's 324 × 761 frame.

## 3 · Rules

**Toolbar**
- **ST1** One 44 row. The row is padded 16 at the start, and 12 at the end (4 when ⋯ ends the row). Status: an 8 dot plus the word in mono 11/600/0.16em caps `--ink-3`, hollow `--ink-4` for Draft, filled `--pos` for Live.
- **ST2** Buttons are the Button part at md: a 32 box (1 px `--rule-strong`, `--r-md`, Inter Tight 12.5/500, pad 0 12) inside a 44 tap target, 8 apart. This matches the finished builders' first row. ⋯ is a 44 ghost (`fa-ellipsis` 16) and holds `--paper-3` while open.
- **ST3** The ladder works by width. At ≥ 372 the row shows Save as template, Preview and Publish. Below that, Save as template moves into ⋯. At 294 the row needs 272 px.
- **ST4** No control ever changes the row. Menus and popovers open 4 below it, end-aligned, and the row's items keep their places (12).
- **ST5** Preview opens the publish preview on Page. Publish opens it on Changes (15, 17).

**Session row**
- **ST6** As ruled in FR6. The summary shows only when it fits whole (W − 268 px). That is at 390, and not at 324 or 294.
- **ST7** Issues counts open conflicts (`fa-triangle-exclamation` 16 `--warn` + mono 11/600). It opens Inspector · Issues, and Save waits while one is open (21, 22).

**Canvas**
- **ST8** Page head: the project eyebrow (mono 10/600 caps `--ink-4`) and the page's name (DM Sans 18/700). Pad 16 16 8. It scrolls with the page.
- **ST9** Rows are in order, 16 apart. Each starts with an eyebrow `Row N`, plus `· N columns free` when the row is short. Tiles within a row are 12 apart. On a phone a row's tiles stack in their desktop order (left to right becomes top to bottom).
- **ST10** Each tile has a 24 caption above its frame: the name (12.5/500 `--ink-2`, wraps by word), a span meter (12 cells 4 × 8, 2 apart, its own columns `--ink-4`, the rest `--rule`), and `N / 12` (mono 10.5/500 `--ink-4`).
- **ST11** The tile is the real component at the frame's width, in a Frame (1 px `--rule-strong`, `--r-lg`, `--paper`). A fixed Height applies. Charts with Auto height draw at 200. The column numbers and stripes are not drawn.
- **ST12** Tap a tile to select it: a 2 px `--brand-d` edge (desktop's selection without its handles) and meter cells in `--brand-d`. Tap it again, or tap ⌄, to clear. The page scrolls so the selected tile sits above the bar.
- **ST13** The page ends with **Add a component**: 44 tall, 1 px dashed `--rule-strong`, `--r-lg`, mono 10.5/600 caps `--ink-3`, `fa-plus` 14. It opens Components.

**Tile bar** (bottom container, 02, 03)
- **ST14** It opens on selection. `--paper`, 1 px `--rule-strong` top, pad 0 16 12, gap 8. Head 44: the eyebrow `Row N · Name` (mono 10/600/0.14em caps `--ink`) and ⌄ (44).
- **ST15** Below the head: Move at full width (Default 44, `fa-up-down-left-right` 16 + 12.5/600). Then the Column span stepper (44 · readout 64 min, mono 13/500 · 44) and Remove (Default 44, `fa-trash-can`, fills the rest). Then the consequence line in mono 10.5 `--ink-3`: `Columns 1–4 of 12 · 4 free in row 2` or `row 2 is full`.
- **ST16** − stops at 1. + is disabled once the row has no free columns. A changed span is a dirty value (`--brand-tint`, `--brand-dd`). Consecutive steps on one tile are one undo step.

**Placing** (05–07)
- **ST17** Picking a card, or tapping Move, starts placing. The canvas draws as its outline: each tile is a 44 row (icon 14, name 13/500, meter, span) on `--paper` with `--r-md`. The tile being moved keeps its place with a 1 px `--brand-d` edge and the move icon. Tapping it cancels.
- **ST18** Slots are 44 tall, 1 px dashed `--brand-d`, `--r-md`, labelled in mono 10.5/600 caps `--brand-d`. There is a **New row** slot before, between and after every row, and an **Into row N** slot at every position where the tile's span fits the row's free columns. The tile's own row counts its own span as free. Positions that would leave the tile where it is get no slot.
- **ST19** A row with fewer free columns than the tile's span (but at least 1) labels its slot `narrows to N`, and the tile is placed at N (desktop's "a tile that does not fit shrinks"). A full row gets no slot (§5, D4).
- **ST20** The place bar has a head 44 (`Moving · Name` or `Adding · Name`, then Cancel at 12.5/500 `--brand-d`), a line of 13 `--ink-2`, and `N slots · span S of 12 · a new row always fits`. A slot tap places the tile, ends placing, and selects the tile with its bar open (06).

**Panes** (FR4, the PROMPT's full view)
- **ST21** The strip has Components (`fa-shapes`, meta `7`) and Inspector (`fa-sliders`, meta `row N`, shown only when it fits whole). A pane opens as a view over the whole builder below the safe area. Head 44: its tabs, then ⌄⌄ (44). One at a time. Opening one ends placing.
- **ST22** Components has an intro line (13 `--ink-2`, pad 12 20): "Tap a component, then tap where it goes on the page. On desktop you drag it onto the grid." Then search (44) with Group and Filter as 44 ghosts. Cards are min 56: an icon box 32 `--paper-3`, the name 13/600, the reads in mono 10.5 `--ink-4` (with `· on page` once placed, wrapping by word), and the lock. There are no grips. A tap closes the view and starts placing (04).
- **ST23** Pages lists the project's pages as desktop does. The open page is the current item (`--brand-tint`, 1 px `--brand-d`). A tap opens that page and closes the view (08).
- **ST24** Inspector · Details uses desktop's sections at touch size (09): Selected component (DM Sans 18/700 and a mono meta line), Data, Configuration (`--paper-2`, fixed by developer) and Layout. Layout rows are min 52, each with a 44 control: Column span (the ST15 stepper), Row `2 of 3` + Move (starts placing), Height (Select, min 132, value whole) and Align (a 3 × 48 segmented control). The foot reads `Published component · logic immutable`.
- **ST25** Height opens a 220 listbox anchored under the field, end-aligned. Rows are 44, with a `--brand-d` check on the current one. A pick applies as a draft (11).
- **ST26** With nothing selected, the Inspector shows the empty state: ☐, "Nothing selected", and a checklist that says tap (10).

**Menus and popovers**
- **ST27** ⋯ is a Menu 240 wide with 44 items: `Save as template…` (12).
- **ST28** Save as template is a Popover (280, or the frame width − 24) anchored to its trigger. It holds an eyebrow, a Template name field (44), a mono help line, then Cancel (link) and Save template (Default). It has no Primary (13).
- **ST29** Discard confirms on a phone with a popover anchored to Discard (R1, R2), in the frame's copy with the page's name. Cancel and Discard changes are both 44 (14).

**Preview** (15–17)
- **ST30** Preview takes the builder's place, as desktop's takes the canvas's. Head 44: ← (Back to the builder), `Preview` DM Sans 16/700, and `Overview · v3 → v4` in mono 10.5 `--ink-4`. Tabs 44: Page · Changes N.
- **ST31** Page has a 44 segmented control: Mobile · Tablet · Desktop. Mobile draws the page with no builder chrome, drafts included. Tablet and Desktop draw the layout at that device's proportions (frame width ÷ 1,024 or 1,440), each tile by name, with free columns dashed. A name that would not fit whole is left out and its span stays.
- **ST32** Changes lists the changes since v3 (+ Added, ± Resized or Moved, − Removed, with mono meta), then Env (Select 44), Audience and Rollout.
- **ST33** The foot is sticky with a 1 px `--rule-strong` top: the target line in mono 10.5, then Save as draft (Default 44) and Publish v4 to Staging (Primary 44). They sit side by side at ≥ 372 and stack below that.

**Empty, loading, saving, error**
- **ST34** An empty page shows ☐, `No components on <page>`, a two-step checklist, and Add a component (18).
- **ST35** Cold load: the labels, page name and tile frames render, and unknown values are static `--paper-3` bars at their final size. The session summary reads `Reading pages…` (R5). Counts read `…`, never 0. Toolbar buttons are disabled (19).
- **ST36** Saving (FR6.2): the live dot replaces the tick and the summary reads `Saving N changes`. When the batch lands, the notice band shows `Saved N changes` until something moves it (20).
- **ST37** Conflict: the changes that combine save, and the one that meets someone else's save waits. That tile's frame turns dashed `--warn` and its caption shows `● Conflict`. Issues counts it, Save waits, and the band says what happened (21). Inspector · Issues shows the change as mine against theirs, with Keep theirs and Keep mine (Default 44). Either clears it (22).

**Throughout**
- **ST38** Every tap target is 44 or more. No dialogs or modals.
- **ST39** Words show whole or not at all. Names and help wrap by word. Tab metas, the session summary and wireframe labels fold away when they would not fit. No ellipsis anywhere.

## 4 · Width checks

| | 390 | 324 | 294 |
|---|---|---|---|
| Save as template | inline | in ⋯ | in ⋯ |
| Session summary | shown | folded (FR6) | folded |
| Inspector tab meta | `row N` | `row N` | folded |
| Publish foot | side by side | stacked | stacked |
| Toolbar width used | 370 | 302 | 272 |

## 5 · Departures, with reasons

**From desktop**
- **D1** The canvas stacks tiles in row order rather than drawing the 12-column grid, its column numbers and stripes. At 324 a column is 24 px, and tiles drawn at desktop proportions cut words and overlap chart labels. The stack is what `<Studio.Page>` shows phone users (F4). The canvas stacks at every phone width (≤ 560), while the page stacks only under 390.
- **D2** Each tile has a caption with its name and span meter. Desktop names a tile only once it is selected. On a phone, the tiles are the only map of the page.
- **D3** Zoom is gone, and Desktop · Tablet leaves the builder for Preview, where Mobile is added and comes first. The canvas is always the phone's layout, so a device switch there would change nothing.
- **D4** Moving never rebalances a full row. Desktop rebalances on a drop. On a phone a single tap would silently resize up to two neighbours, so a full row gets no slot and the user narrows a tile first. A short row narrows the tile to fit, as desktop does.
- **D5** Selection drops the resize handles and the tile's trash button. Their gestures live in the tile bar instead.
- **D6** The Inspector's Row is a readout with Move, where desktop has a number field. A typed row number has no rule for a full row, and Move shows where the tile will fit.
- **D7** Desktop's Preview and Publish open the same view. On a phone they open its two tabs (Page, Changes), because the page and the aside cannot sit side by side at 390.
- **D8** The Tablet and Desktop previews draw the layout by name, not the tiles. Tiles drawn at 1,440 px and scaled into 358 px could not be read.
- **D9** The Inspector gains an Issues tab, because the frame's Issues button opens Inspector · Issues (FR6.3). Desktop Studio's inspector has one tab.

**From the ruled frame**
- **D10** First-row buttons use a 32 box in a 44 target, not a 44 box. This matches the finished builders as built (the Plan's Filters, the Flowchart's LR · TD).
- **D11** The bottom container is `--paper`, not `--paper-2`. Studio's main is already `--paper-2`, and the bar has to read as chrome.
- **D12** The strip keeps Studio's own label and icon, Components (`fa-shapes`), rather than Library (`fa-layer-group`). `<Studio.Library>` is the page library, a different surface.
- **D13** The Elara eye rule (R4) does not apply, because Studio has no OptimiseButton. The eye ▾ in today's toolbar is the View fold of zoom and device, which goes with D3.

**Kept despite the system**
- **D14** The selected tile keeps desktop's `--brand-d` edge instead of the system's `--ink` canvas selection, so desktop and phone match. Desktop does not change.
- **D15** Discard's popover keeps the frame's Primary, Discard changes (R1). Other popovers carry no Primary.

## 6 · Open

- What switching page does to drafts in the session. The prototype starts the new page clean. Desktop's rule should be confirmed.
- What the palette's Group and Filter offer on a phone. They are drawn closed. Their desktop popovers would anchor under them at 44 rows.
- Height's options. The prototype offers Auto · 120 · 240 · 360 · 480 px. Desktop snaps to the bottom edges of the row's other tiles, and that list should come from desktop.

## 7 · As built (4 Nov 2026)

Built on PR #1481. Where the build differs from the text above:

- **No anchored popovers, as ruled for every builder on a phone.** Save as template and Height open as full views (ST25, ST28), ⋯ goes straight to Save as template (ST27), and Discard asks in the band under the session row (ST29, D15).
- **Conflicts open in the frame's bottom panel**, as every builder's do (`Mobile Builder Frame Spec.md` FR8). So the Inspector has one tab, Details, and no Issues tab (ST7, ST37, D9). The conflict's band stands over the strip, the tile dashed `--warn` with `● Conflict`.
- **− stops at 2**, the model's `MIN_SPAN`, as desktop's does, not 1 (ST16). A row with fewer than 2 free columns offers no slot (ST19).
- **Env is a line, not a Select** (ST32): the builder is given one environment, so there is nothing to choose.
- **Cold load** (ST35) is not drawn by the builder: its host loads what it reads before it mounts.
- **The Inspector's meta line** is `row 2 · columns 1–8`: the component's kind (`Chart.Column`) is not in what the inspector is given.
- **Height's options** are desktop's: Auto, 160, 240, 320, 400, 480 px.
