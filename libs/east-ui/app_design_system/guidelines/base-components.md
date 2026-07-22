# Base components — the stdlib recipes

Distilled from the pattern spec (`guidelines/reference/index.html` §1.6,
values verbatim). Each recipe names its production tag in `@elaraai/east-ui`
— design to these so a mock translates 1:1 into East JSX.

## Buttons (`<Button>`) — four roles, never invent a fifth

- **Primary** — commits a patch · `--brand-d` fill · one per surface
- **Default** — non-destructive route · paper fill, rule border
- **Override** — opens reason-capture · `--ink-3` border / `--ink-2` text
  600 · always offered, never the default
- **Link/ghost** — navigation only · `--brand-d` · trailing `→` if onward

**Commit cluster**: `Override · Modify · Apply`, left→right, increasing
commitment — every commit surface, always this order (trains a motor habit).

**Icon buttons**: 32×32 with `aria-label`, toolbars and row-end only; ghost
variant (no border, `--ink-3`) for repeated in-row controls. Labelled
icon+text buttons: icon leading, 8px gap; trailing icons only for onward
navigation (arrow) or disclosure (chevron).

## Keyboard (`<Hotkey>`, `<Kbd>`, `<CommandPalette>`)

`⏎` apply/commit · `⌫` clear selection · `esc` discard dirty · `⌥`+drag
duplicate · `⌘ /` search · `⌘ k` command palette · `j`/`k` queue next/prev ·
`[`/`]` page prev/next · `g`/`G` first/last page.

## Motion

`--dur-fast` 120ms hover/focus · `--dur-base` 200ms panel/accordion/banner ·
`--dur-slow` 360ms run-pulse/diff settle · `--ease-out` enter ·
`--ease-in-out` state-toggle only. Forbidden: springs, bounce, parallax,
scroll-driven. The `.dot.live` pulse is the whole vocabulary for "in motion".

## Field & forms (`<Field>`, `<Input>`, `<Select>`, …)

- **Field** — three slots: label · input · help, in that order. Label
  carries the schema key beneath it (mono 11px `--ink-4`). Input value
  mono · tabular · right-aligned; units as mono suffix outside the field.
  Help = range, unit, default — inline, never a tooltip. Invalid tints
  `--neg` and replaces help with the error. Dirty = `--brand-tint` fill.
- **Fieldset** — 2–6 related fields under one mono-uppercase legend;
  cross-field guardrails render as a banner above, never inline. Beyond
  six fields, split or move behind presets.
- **Number input** — only when there's a natural step; steppers disable at
  bound; `⇧`-click = 10× step. Continuous tunables → slider; precise
  floats → plain field.
- **Select** — >4 mutually-exclusive or dynamic options; trigger is mono
  (ids/versions/paths); dirty trigger picks up `--brand-tint`.
- **Radio group** — form choice from a small set; selected mark `--brand-d`.
- **Segmented control** (`<SegmentGroup>`) — view-state toggle (horizon,
  view-mode): 2–4 options, mono uppercase 11px, active = brand-tint fill +
  `--brand-dd` text, applies immediately, never inside a form.
- **Checkbox** — 14×14 · 3px radius · checked `--brand-d` white tick ·
  indeterminate = `--ink-4` minus (the parent affordance).
- **Switch** — persistent boolean that changes behaviour immediately;
  track `--brand-d` on / `--rule-strong` off (never red).
- **Slider** — never the only control: pair with typed input + tabular
  readout right. Range slider for bounded pairs (cap, band).
- **Tags input** (`<TagsInput>`) — set-valued entry; each value a brand
  chip with trailing `×`; `⏎` commits, `⌫` on empty deletes last;
  paste-comma splits; de-dupes silently.
- **Editable** — the only inline rename: dashed underline + pen in
  preview; `⏎` commits, `esc` discards; renames are journaled.

## Chips & chip rail (`<ChipRail>`)

Chips are clickable filters/cohorts/segments — active `.brand`
(brand-tint), dashed = the trailing "+ add" empty slot, operator-set chips
carry `×`. Trust chips are read-only attribution (dot + label + meta),
never filters. A rail is ONE dimension family per line; labeled mode stacks
a mono uppercase caption above each chip when the bare value is ambiguous.
Densities (single knob, never mixed in a rail): compact 15px h / 9px font ·
comfortable 22px / 10px (default) · large 34px / 12.5px (touch).

## Tables (`<Table>`)

**36px row height · 12px vertical padding** · ruled top-only. Selection
fill `--paper-3`, hover `--paper-2` (hover collapses when selected).
Sticky header, mono 10px / 600 / 0.16em uppercase. Numeric columns tabular
right-aligned; identifiers left; status = dot + word. One selected row per
surface unless explicitly multi-select (leading checkbox column + batch
bar). Lists >50 rows paginate (`<Pagination>`: "Showing N–M of T" + per-page
stepper) — never infinite scroll, it kills attribution and counters.

## Breadcrumb (`<Breadcrumb>`)

Part of the app bar, never freestanding. Mono 11px / .06em; `/` separator
`--ink-4` (never a chevron); current page non-link `--ink` 600; trailing
run anchor (`| run #42`) pins to a trust stamp.

## Tabs (`<Tabs>`)

Underline style only — no pill-tabs, no boxed-tabs. Mono uppercase 11px /
600 / 0.16em; active = `--ink` text + 2px `--ink` underline. Tabs partition
views of the same data — never navigation (that's the sidebar). Counts as
mono numerals, never tinted pills.

## Badge & progress (`<Status>`, `<Progress>`)

Status is dot + word. Tinted pills ONLY for counts (`--paper-3`) and NEW
callouts (`--brand-d`). Progress bars 6px, `--brand-d` on `--paper-3`,
always paired with a mono percent.

## Overlays (`<Tooltip>`, `<Popover>`, `<HoverCard>`, `<Menu>`, `<Dialog>`)

- **Tooltip** — text only: definition, formula, n. Affordance is a 14px
  `ⓘ` ring in `--ink-4`, never coloured. Dark bg (`--ink`), mono 11px.
- **Popover/HoverCard** — structured content, links, actions; same chrome
  as Menu (paper · rule-strong · `--shadow-md` · radius 6) + 12px arrow;
  width 240–360px. Trust chip → full stamp is the canonical popover.
- **Menu** — secondary/tertiary actions; kebab trigger (`fa-ellipsis`);
  group headers mono uppercase; destructive items `--neg` at the bottom
  after a hairline; accelerators right-aligned mono.
- **Dialog** — the ONLY modal: irreversible commits (publish, archive,
  delete). Mono eyebrow naming the irreversibility · brand 20px title ·
  concrete consequence in human terms · exactly Cancel + the named commit
  verb. No close-X. **Toast is forbidden** — transient feedback is a
  Banner in the originating surface. Drawer is only the Rail's mobile
  presentation.
- **Accordion** — long Configure surfaces only; headers carry eyebrow +
  field count + dirty count right-aligned mono; never auto-collapse on save.

## File upload (`<FileUpload>`)

Dashed 1.5px dropzone on `--paper-2`; every upload shows its checksum in
mono (provenance is non-negotiable); errors in the help slot, not a toast.

## Icons

Font Awesome 6 free, `fa-solid` only — 14px inline, 16px in buttons. Icon
colour inherits `currentColor`; only the three state icons carry semantic
colour (warn `triangle-exclamation`, neg `circle-exclamation`, pos
`check`). Every icon has an accessible label. No `fa-regular`/`fa-brands`,
no SVG, no emoji.

## Spacing & surfaces

4px scale — use the rung, never arbitrary px. Radii: `r-sm` 4px chips/kbd ·
`r-md` 6px buttons/controls · 10px frames/modals. Shadows only on true
overlays (menu/popover `--shadow-md`, dialog `--shadow-lg`).
