# Roster People — design

The e3-ui `Roster`'s People layout: its week view drawn as the mock draws it,
a month view beside it, and an optional library of week patterns a planner
drops on a person's week. It is the same `<Roster>` in the same `BuilderFrame`
over the same records (`Builder Interfaces Spec.md` §5). The frame, its
toolbar, banners, inspector and footer stay as they are; this document changes
what main draws for People, adds the month, and adds one library tab.

This document is the design #1406 builds. `Roster People Spec.html` beside
it is the visual design. It is written against PR #1397's branch
(`elaraai/feat/e3-ui-schematic`, `53a9bc3b7`), where the Roster already loads
by #1398's rules. `Roster Spec.md` stays the design of the rest of the Roster;
this document amends its §9.12 (B59–B60). What the mock shows beyond this scope
is listed in §13, not built here.

## 0. The files

| File | What it is |
|---|---|
| `Roster People Spec.html` | The hi-fi mock: Claude Design's "People · Week and Month" export, self-contained but for React 18 (unpkg, loaded by the design runtime), Font Awesome (cdnjs) and the fonts (Google Fonts). Its people and groups are a warehouse's (Inbound, Outbound), every name synthetic; nothing names a client, its trade or its people. |
| `Roster People Spec.md` | This design. |

**Opening the mock.** Open the file in a browser. Its states are reachable by
URL parameter:

| Parameter | Values | Default |
|---|---|---|
| `period` | `week`, `month` | `week` |
| `week` | a week number; W1 is the week of 2 Jan 2028 | `11`, 12–18 March 2028 |
| `theme` | `dark`, `light` | `dark` |
| `palette` | `example`, `time-of-day` (which hues the shifts take) | `example` |
| `density` | `comfortable`, `compact`, `condensed` | `comfortable` |
| `times` | `always`, `different` (when a tile shows its hours) | `always` |
| `letters` | `true`, `false` (whether a month's marks carry the shift's letter) | `true` |

For example `Roster People Spec.html?period=month&theme=light`. The mock opens
on its first issue, selected, with the inspector showing it. An agent measures
the mock in a headless browser, through its DOM; nobody reads a screenshot.

## 1. Summary

- **What.** People shows who works when: a person a row; a day a column for
  the week, or a week a column for the month. A planner reads a person's
  pattern at a glance, assigns a day from an off cell, and drops a week pattern
  from the library on a person's week.
- **Where.** The interface in e3-ui (`libs/east-ui/packages/e3-ui/src/roster/`),
  the renderer in e3-ui-components (`src/roster/views.tsx`, `data.ts`,
  `library.tsx`, `actions.ts`), as the rest of the Roster.
- **What the app declares.** Its week patterns, a record of its own, read
  through `Roster.patterns`, with their tab's name and icon; a shift's colour,
  a typed colour token through an accessor of `Roster.shifts`; the first
  period; whether tiles show the shift's hours; whether a month's marks carry
  letters.
- **Built in.** The week view's tiles and name cell, the off cell's assign
  menu, the month view and its reads, the Patterns tab and the pattern drop.
- **Unchanged.** `BuilderFrame`, the toolbar's items (the Period segment shows
  each layout's own two periods, as it shows Shifts' today), the banners, the
  inspector's Details, the footer's legend and loading line, the Shifts layout.
- **Replaces.** Today's People week: the Shifts layout's chips in a day cell
  (`code · group · flags · times`, wrapped), `Off · assign` as a form, a
  trailing Week hours column, and a 62 px row estimate.

## 2. Decisions

Settled by this design; D3 and D6 were ruled by the user on 25 Oct 2026.

| # | Decision |
|---|---|
| D1 | **People has two periods, Week and Month; Shifts keeps Day and Week.** `view.period` takes `"month"`. The existing Period segment shows the layout's own two periods in every toolbar form (it shows none for People today), and each layout keeps its own period, so switching layouts restores the period that layout had (B1). A `view` naming a period its layout does not take is refused at build, naming each layout's periods. |
| D2 | **A month is the weeks that touch it**, four to six, from the configured week start. The date label is the month (`March 2028`) with `W10–W14 · Mar 5 – Apr 1`, and ‹ › step a month, through the shared `TimeNavigator` as it stands. Week → Month opens the month holding the week in view's fourth day; Month → Week opens the selected person-week's week, else the first week of the month in view whose fourth day falls in it. |
| D3 | **Week patterns are the app's rows, and so are their tab's name and icon.** `patterns={Roster.patterns(rows, { name, icon?, label, days, order? })}` reads a keyed record of the app's through accessors, as `Roster.shifts` does; `days` returns seven `Option<String>` shift keys from the week's first day; `name` titles the tab (the mock's `Weeks`, the warehouse's `Patterns`) and `icon` is its cards' Font Awesome icon (`calendar-week` by default), as `Schedule.events`' `name` and `icon` and an author tab's are. `Roster.library.patterns()` lists them under that name. Both props are optional: without them the People layout is as it is. **Ruled 25 Oct 2026:** configurable, label included, as the other declarations are. |
| D4 | **A pattern dropped on a person's week replaces its seven days, one gesture.** A day the pattern leaves as it is keeps its duty as it stands; a day it changes runs the pattern's shift in the person's home group at the shift's own times, position kept, activity kept within the group and cleared across one (B49); an off day removes the person's duties that day (struck through until Save, B56). |
| D5 | **A day cell is a tile per duty**: the shift's label, then its own times where they differ from the shift's, else the group where it is not the person's, else the shift's hours; a warning mark where an issue names the duty. Rows are one line at the density's pitch: a second duty the same day shows as `+1` in the danger tone, and the inspector lists both. |
| D6 | **A shift's colour is the app's, a typed colour token.** east-ui gains `ColorTokenType`: a variant of the theme's hues — `brand`, `gray`, `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `cyan`, `purple`, `pink` — each holding a variant of the shades `50` to `900` (`variant("red", variant("100", null))`; `Style.ColorToken("red", "100")`), beside `ColorSchemeType` and `StatusTokenType` in `style/`, for every component that takes a colour. `Roster.shifts` gains `color?`, an accessor returning `Option<ColorToken>`: the tile's fill, the month's and the pattern cards' marks, resolved through the theme (`{colors.red.100}`), the same in both colour modes, the words on it in the ink the shade takes (`fg` up to 400, the paper's from 500). Without it, tiles are neutral and shifts are told apart by label and letter. The mock's two palettes are its own; the product has no palette prop. **Ruled 25 Oct 2026:** the typed token, type-safe and shared across the app, over a string token; the design system's chart-only rule for the hues yields to a token the app gives for a data fill. The Schematic's `color: Option<String>` (its D14) moves to it in a follow-up (§13). |
| D7 | **Two display props.** `tileTimes`: whether a tile shows the shift's hours always, or only a duty's own times where they differ (`"always"` by default); `letters`: whether a month's marks carry the shift's letter (`true` by default). Props, as the app's choice; the Display menu is not touched here (§13). |
| D8 | **Hours sit in the name cell.** The 232 px name column holds the name, the Agency badge and, right-aligned, the week's hours against the contract (and the cost, with `pay`) over a 56 × 3 px meter. The trailing Week hours column goes. The month's name cells hold the name and badge alone. |
| D9 | **An off day assigns from a menu.** `+ Assign` on an off cell opens a menu of the shifts in the person's home group, each its label, swatch and times; a choice places the person there (`commands.place`). `Elsewhere…` opens today's place form for another group or day. |
| D10 | **Month marks.** A week cell holds seven marks, the shift's letter on each where a day is 13 px or wider and `letters` is on; an off day a faint mark. The cell takes a pattern drop and a click selects the person-week; the week column's header opens that week in Week. |
| D11 | **A person-week selection reads its week.** A click on a name cell (Week) or a week cell (Month) selects the person for that week; the inspector's person Details, as they are today (`PersonFacts`: skills and the seven days), read the selected week rather than the week in view, and a click on one of its days opens that week with the duty selected. No new inspector part. |
| D12 | **Narrow main (below 480 px) keeps People to the week.** Month is not offered there; a persisted month opens on its first week. The phone's People cards gain `Apply pattern…`, a Chooser over the patterns, as every drop has an explicit action on a phone. |
| D13 | **Loading follows #1398.** A month not read draws its weeks, bands and names at once and a placeholder strip in each cell; the footer's line says `Loading W10–W14` through the existing period line; the months either side are read ahead; a step keeps each person's row where it was (CL8); a failed read is said once across the first person's cells (CL11); nothing says `Off` before the read (CL13). The People row pitch #1398 proposed at 52 px becomes the density's row height (36 comfortable, 32 compact). |
| D14 | **Sample data stays the warehouse's**: its 69 staff, three teams and three shifts gain a record of week patterns (the mock's thirteen, synthetic names) and each shift a colour. The mock's twenty people and two groups are illustrative only. |

## 3. The authoring surface

### 3.1 What the app declares

```ts
// records.ts — beside the duties, weeks, cover, staff, shift times, teams, positions and activities of §5.7
import { ArrayType, DictType, IntegerType, OptionType, StringType, StructType, none, some } from "@elaraai/east";
import e3 from "@elaraai/e3";

import { ColorTokenType, Style } from "@elaraai/east-ui";

/** A week pattern, the app's own: its name, its seven days from the week's first day, and where it shows. */
export const WeekPattern = StructType({ label: StringType, days: ArrayType(OptionType(StringType)), order: IntegerType });
export const rosterPatterns = e3.record("roster_patterns", DictType(StringType, WeekPattern), new Map([
    ["early-sun-thu", { label: "Early · Sun–Thu", days: [some("early"), some("early"), some("early"), some("early"), some("early"), none, none], order: 1n }],
    ["forward",       { label: "Forward rotation", days: [some("early"), some("early"), some("late"), some("late"), some("night"), none, none], order: 7n }],
    ["off",           { label: "Off", days: [none, none, none, none, none, none, none], order: 13n }],
]));
/** A shift's colour: a typed colour token, the app's choice — `Style.ColorToken("teal", "500")` in its seed. */
export const WarehouseShift = StructType({ label: StringType, code: StringType, start: Schedule.Types.Clock, hours: FloatType, order: IntegerType, colour: OptionType(ColorTokenType) });
```

### 3.2 The People view, by month

```tsx
// Inside the Roster's Reactive body, beside rosterWarehouse's bindings (§5.7).
const weekPatterns = $.let(Data.bind(rosterPatterns));
return <Roster id="rosterPeopleMonth" week={{ start: "sunday" }} slice={{ slice }} inspector
    view={{ layout: "people", period: "month", date: new Date("2028-03-09T00:00:00Z") }}
    tileTimes="different" letters
    events={{ duty: Schedule.events(rota, { … }) }}
    resources={{ people: Schedule.resources(people.read(), { … }), agencies: Schedule.resources(firms.read(), { … }) }}
    periods={Schedule.periods(weeks, { every: "week", status: { field: "state", draft: "open", published: "issued" }, dismissed: "dismissed" })}
    targets={Roster.targets(cover, { day: "day", group: "team", shift: "shift", positions: "heads", hours: "hours" })}
    shifts={Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours, order: s => s.order, color: s => s.colour })}
    groups={Roster.groups(teams.read(), { label: t => t.label, order: t => t.order })}
    positions={Roster.positions(roles.read(), { label: p => p.label, code: p => p.code, lead: p => p.lead, order: p => p.order })}
    activities={Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order })}
    patterns={Roster.patterns(weekPatterns.read(), { name: "Patterns", icon: "calendar-week", label: w => w.label, days: w => w.days, order: w => w.order })}
    rules={{ rest: 10.0 }}
    library={[Roster.library.people(), Roster.library.patterns(), Roster.library.activities()]} />;
```

What changes against today's `rosterPeople`: `period: "month"`, `tileTimes` and
`letters`; `color` on the shifts; `patterns`, with its tab's name and icon, and
the tab. Everything else is
the Roster as it is; a Roster with none of them draws the new week view over
the same declarations it has today.

## 4. The props

### 4.1 New and changed

| Prop | Takes | What it does |
|---|---|---|
| `view` | `{ layout?, period?, date? }` | The first view. Shifts takes `"day"` or `"week"` (`"day"` by default); People takes `"week"` or `"month"` (`"week"` by default). A period its layout does not take is refused at build, naming each layout's periods. Each layout keeps its own period per viewer. |
| `patterns` | `Roster.patterns(rows, { name, icon?, label, days, order? })` | The app's week patterns: the cards of the tab `name` titles, and what a drop on a person's week applies. Omitted, no patterns and no tab; `Roster.library.patterns()` without it is refused, naming `patterns`. |
| `shifts` | `Roster.shifts(rows, { label, code, start, hours, order?, color? })` | `color` returns `Option<ColorToken>` (`Style.ColorToken("teal", "500")`), the tile's and the mark's fill; `none`, neutral. An accessor of another type is refused, naming `ColorTokenType`. |
| `tileTimes` | `"always"`, `"different"` | Whether a tile shows the shift's hours (`06–14`) always, or only a duty's own times where they differ from the shift's. `"always"` by default. |
| `letters` | Boolean | Whether a month's marks carry the shift's letter. `true` by default. |
| `library` | `readonly RosterLibraryTab[]` | Gains `Roster.library.patterns()`. |

Unchanged: `events`, `resources`, `periods`, `targets`, `groups`, `positions`,
`activities`, `proposals`, `pay`, `currency`, `rules`, `check`, `fit`, `slice`,
`inspector`, `week`, `density`, `chipSkills`, `requirements`, `readOnly`, `id`.

### 4.2 `Roster.patterns(rows, config)`

A keyed record of the app's, usually a bound record's `read()`, through
accessors that take the row and its key, in `order` then key order, as the
other lists are (`lists.ts`); `name` and `icon` are the declaration's own
words, plain values.

| Option | Takes | What it gives the roster |
|---|---|---|
| `name` | a string | The tab's title (`Patterns`, `Weeks`): required, as `Schedule.events`' `name` is. |
| `icon` | a string | The cards' Font Awesome solid icon; `calendar-week` by default. |
| `label` | accessor to `String` | The card's name and the drop's words. |
| `days` | accessor to `Array<Option<String>>` | Seven entries from the week's first day (`week.start`): a shift's key, or `none` for an off day. |
| `order` | accessor to `Integer` | Where it shows among the patterns, lowest first; omitted, key order. |

A pattern with other than seven days, or naming a shift the Roster has not
configured, is listed on its card greyed with the reason (`8 days`, `shift
"twilight" isn't configured`) and cannot be dragged or applied.

The slice may narrow the tab through a `patterns` source, as the People and
Activities tabs are narrowed (#1342); without one the tab lists the record
whole. A pattern is never written: the Roster reads them.

## 5. The East types

### 5.1 Public: east-ui's `ColorTokenType`, and `Roster.Types`

```ts
// @elaraai/east-ui, style/color.ts (new), beside ColorSchemeType and StatusTokenType: a theme hue, and its shade.
ColorShadeType = VariantType({ "50": NullType, "100": NullType, "200": NullType, "300": NullType, "400": NullType,
                               "500": NullType, "600": NullType, "700": NullType, "800": NullType, "900": NullType });
ColorTokenType = VariantType({ brand: ColorShadeType, gray: ColorShadeType, red: ColorShadeType, orange: ColorShadeType,
                               yellow: ColorShadeType, green: ColorShadeType, teal: ColorShadeType, blue: ColorShadeType,
                               cyan: ColorShadeType, purple: ColorShadeType, pink: ColorShadeType });
Style.ColorToken(hue, shade): ExprType<ColorTokenType>     // Style.ColorToken("red", "100") is variant("red", variant("100", null))

Roster.Types.Pattern = StructType({ key: StringType, label: StringType, days: ArrayType(OptionType(StringType)) });
Roster.Types.Shift   = StructType({ key, label, code, start: Clock, hours: FloatType, color: OptionType(ColorTokenType) });   // gains color
Roster.Types.Period  = VariantType({ day: NullType, week: NullType, month: NullType });                                      // gains month
```

The hues are the theme's palettes (`ColorSchemeType`'s hue cases, which the
theme carries as Chakra palettes: `brand` and `gray` the design system's
scales, the rest Chakra's stock) and the shades the design system's scales'
steps; a renderer resolves a token as `{colors.<hue>.<shade>}`, the same in
both colour modes. Every component that takes a colour takes this type from
here on (§13 lists the first to move).

### 5.2 What the renderer receives: the payload

```ts
RosterPayloadType gains
    patterns: ArrayType(Roster.Types.Pattern),
    library:  ArrayType(VariantType({ people, activities, patterns: StructType({ name: StringType, icon: StringType }), tab: ScheduleAuthorTabType })),
    settings: { …, period: Period (with month), tileTimes: VariantType({ always, different }), letters: BooleanType };
each shift in `shifts` carries `color: OptionType(ColorTokenType)`.
```

## 6. How it relates to the Shifts layout and the Calendar

The People layout is a second drawing of the same week: the same duties, the
same session, the same commands (`actions.ts`), the same drag grammar and the
same inspector. What it adds is read-only configuration (patterns, colours),
two display props, and the month's reads. The Calendar's templates are the
precedent for patterns: records, listed in a tab, applied by a drop; a pattern
is a template of a week. The month's columns are the Calendar's month cells'
cousins — a column a week, not a cell a day — because a roster reads by week.

## 7. Layout in BuilderFrame

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▼filter · Shifts People · Display · Week Month · ‹ Mar 12 – 18, 2028 W11 › · Draft   8 issues · ↶ ↷ · Publish │  unchanged items; Week · Month in the Period slot
├────────────────┬──────────────────────────────────────────────────────────────┬──────────────┤
│ LIBRARY        │ People · Week                 Hours │ SUN 12 · MON 13 · … SAT 18 │ INSPECTOR     │
│ People ·       │ ▾ Inbound · 11 people                                            │ (as today)    │
│ Patterns ·     │ A. Alder          40 / 38 h ▬▬▬▬▬ │[Early 06–14][Early 06–14][+ Assign]… │               │
│ Activities     │ B. Lupin  Agency  32 / 40 h ▬▬▬▬  │[Late 14–22]…                       │               │
│ S M T W T F S  │ ▸ Outbound · 9 people                                            │               │
│ [Early·Sun–Thu]│                                                                  │               │
├────────────────┴──────────────────────────────────────────────────────────────┴──────────────┤
│ footer: as today — the legend and the loading line                                             │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Region | Changes |
|---|---|
| Toolbar | None but the Period segment, which shows Week · Month for People in every form (today it is hidden for People); ‹ › step the period, as today. |
| Banners | None. |
| Start pane | One more tab, titled by `Roster.patterns`' `name`, when the app lists it. |
| Main | The week grid redrawn (§8), the month grid new. |
| End pane | None; a person-week selection reads its week (D11). |
| Footer | None. |

The mock's own chrome (its 44 px toolbar, its last-change banner, its 36 px
rails, its legend of shifts) is either `BuilderFrame`'s already or outside this
scope (§13). Every size below is a slot recipe's, the renderer setting data
attributes and geometry only.

## 8. The views — anatomy, from the mock

Sizes are the mock's at `comfortable`; `compact` takes 4 px off each row and
tile. Tokens are the design system's semantic tokens; the product replaces the
mock's raw accent hues (D6).

**The patterns tab (mock's "Library · Weeks", 272 px).** A 36 px head (icon,
the declaration's `name` in mono `label-sm` 600 uppercase 0.14em, an 18 px
count, collapse); a search band padding 8 px 12 px with a 28 px input in mono
`label-lg` (`Search`); a sticky header `12px minmax(0,1fr)` with the seven day
initials in mono `label-xs` 600 centred; a card per pattern: grid `12px
minmax(0,1fr)`, padding 8 px 12 px, a 10 px grip, the name in `body` 500, the
meta (`5 shifts · 40 h`) in mono `label-sm` `--ink-4`, and an 18 px strip of
seven marks (margin 0 2 px, radius `--r-sm`, the shift's letter in mono
`label-sm` 600, off marks at 7% ink); the dragged card on `--paper-3` with a
dashed brand outline; a footer hint in mono `label-xs`: `Drag one onto a
person's week. It replaces all seven days.`; empty: `Nothing matches "q"` (B28).
In the product: the shared `Library` as the other tabs use it, a card's strip
of marks a card extra in place of its meter, each mark in its shift's token;
no row of day initials — the shared Library has no head between its search
and its cards, and a strip reads Sunday to Saturday as the card's name does
(ruled 26 Oct 2026).

**The week grid (mock).**
- A sticky 36 px header: `232px minmax(0,1fr)`; `People · Week` and `Hours`
  in mono `label-sm` 600 uppercase 0.16em `--ink-4`; seven day columns
  separated by 1 px of `--rule`, each `SUN 12` (`MON 13`, `1 MAR` on a
  month's first day), the number in `--ink-2`. In the product: the existing
  `headerGutter` and `shiftHead` slots with `timeHeaderText`.
- A group band 36 px on `--paper-2`: a 12 px chevron, the name in
  `--font-brand` `title-xs` 700, `11 people` in mono `label-sm` `--ink-4`
  (the shared `GroupHeading`).
- A person row 36 px (`232px minmax(0,1fr)`), a 1 px rule under it:
  - the name cell, padding 0 12 px 0 20 px: the name in `body` 600, an
    `AGENCY` badge 16 px bordered in mono `label-xs` 600 uppercase, and at the
    right the hours `40 / 38 h` in mono `label-md` 500 (`--warn-text` over
    the contract) over a 56 × 3 px meter (`--paper-3`, fill `--brand-d`, or
    `--warn` over);
  - seven day cells, padding 0 4 px, on `--brand-tint` when the day is
    drafted, `--paper-3` when selected;
  - a tile fills its cell at 24 px (the row less 12): padding 0 6 px, gap 6
    px, radius `--r-sm`, a 1 px border; the shift's label in `body-sm` 500,
    then in mono `label-md` the hours (`06–14`), or a duty's own times
    (`07–15`) in 600, or the group (`OUTBOUND`) in `label-sm` 600 uppercase;
    a 10 px warning triangle at the end where an issue names the duty; the
    selected tile outlined 1 px `--ink`;
  - an off cell: `+ Assign` in mono `label-sm` 600 uppercase on a 7% ink
    wash, its words transparent until hover, focus or selection; it opens
    the assign menu, 196 px wide, padding 4 px: a header `ASSIGN · THU 16` in
    mono `label-xs` 600 uppercase, then a 28 px item a shift: a 12 px
    swatch, the label in `body-sm`, the times in mono `label-md` `--ink-3`;
  - the row's day cells outlined 1 px `--ink` when the person-week is
    selected, 1 px dashed `--brand-d` while a pattern hovers it, its tiles
    then the pattern's, dashed.

**The month grid (mock).**
- A sticky header, `168px repeat(N, minmax(0,1fr))`, two rows of 24 and 32
  px: `People · Month`; per week a column with `W10` in `--ink-2` and `Mar 5
  – 11` in mono `label-sm` 600 uppercase, over seven ticks each the day's
  initial in mono `label-xs` 600 `--ink-4` and its number in `label-sm` 500
  `--ink-2`. A click on a column opens that week in Week.
- The same group bands; a person row 36 px: the name cell (name, Agency), and
  a cell a week holding seven marks (height 24, margin 0 2 px, radius
  `--r-sm`), each the shift's letter where a day is 13 px or wider and
  `letters` is on; off marks at 7% ink; the cell on `--brand-tint` where any
  of its days is drafted, `--paper-3` when selected, outlined as the week's
  row is; a pattern hovering it previews its seven marks dashed.

**The inspector.** Unchanged. The mock's day editor is the duty's Details
(B34: its Shift segment moves the duty, Remove is `Off`); its person-week card
is `PersonFacts` reading the selected week (D11); its `Nothing selected`
checklist is the Roster's summary (B33).

**The footer.** Unchanged: the coverage legend and the loading line. The mock's
legend of shifts is §13's.

## 9. Behaviour

Every interaction of the mock within this scope, numbered, with the owner and
the test (e3-ui-components `src/roster/` unless said). Rules marked *product*
are not in the mock.

### 9.1 Periods and navigation

- **P1.** The Period segment shows the layout's own periods — Day · Week for
  Shifts, Week · Month for People — in the expanded, folded and combined
  toolbar forms; each layout keeps its period, so Shifts → People → Shifts
  returns to the Shifts period it had. (`toolbar.tsx`, `window.ts`; DOM.)
- **P2.** ‹ and › step a week in Week, a month in Month; `[` and `]` step the
  same unit; the date label reads `Mar 12 – 18, 2028 · W11`, or `March 2028 ·
  W10–W14 · Mar 5 – Apr 1`. The picker's Weeks and Days choices pick a date as
  today; in Month, a week chosen opens Month on its month. (`toolbar.tsx`,
  the shared `TimeNavigator` as it stands; DOM.)
- **P3.** Week → Month opens the month holding the week in view's fourth day;
  Month → Week opens the selected person-week's week, else the week Month was
  opened from while the month in view still holds it (ruled 26 Oct 2026: a
  viewer toggling the two keeps their place), else the first week of the
  month in view whose fourth day falls in it. (`window.ts`; DOM.)

### 9.2 The week grid

- **P4.** A row per person, under their group's band, in the library's order
  (leads, then associates, then agency staff); an `Agency requests` row per
  group, last, holding the group's requests as tiles (`AG`, the shift). A
  band's fold is shared with the Shifts layout and the phone's cards, as
  today. (`views.tsx`; DOM.)
- **P5.** The name cell: the name, the Agency badge, the week's hours against
  the contract and, with `pay`, the cost; the meter fills to the contract and
  turns warning past it. A click selects the person-week (D11). (DOM.)
- **P6.** A day cell holds a tile per duty the person has that day, in time
  order; the tile's words are D5's; `tileTimes` decides whether the shift's
  hours show. Two duties on one day show the first tile and `+1` in the
  danger tone; the inspector lists both. (DOM, both `tileTimes`.)
- **P7.** A tile's look: drafted (added or moved) dashed brand, edited brand
  tint, removed struck through on the warning wash with ↺, a hard breach a
  danger border, another breach a warning border, selected a 1 px ink
  outline, while dragged 40% (B13). Its fill is the shift's colour token where
  the app gives one (D6), its words in the ink the shade takes, else
  `--paper-3`. (`rosterBuilder.ts`; responsive, both themes.)
- **P8.** An off cell shows `+ Assign` on hover, focus or when selected; it
  opens the assign menu (D9): a shift chosen places the person on it in their
  home group that day, one gesture; `Elsewhere…` opens today's place form. A
  published or read-only week offers neither. (`controls.tsx`; DOM.)
- **P9.** A drafted day's cell is tinted; a drafted person-week's name cell
  is not. (DOM.)
- **P10.** A click selects: a tile its duty; an off cell the person and the
  day; the name cell the person-week; a band folds. Esc clears the selection
  or closes the menu; Delete removes the selected duty (B16). (DOM.)
- **P11.** A tile drags to another day of the same person's row — a move on
  the same shift and group (B60); a person card from the People tab onto a
  day rosters them on the shift they usually work, else the first shift
  (B60); drops follow §9.10 of `Roster Spec.md`. A tile dropped on another
  person's row is refused: `A duty moves along its own row.` (`drag.ts`;
  DOM.)

### 9.3 The month grid

- **P12.** A column per week touching the month, four to six; its header is
  the week's number and range over its seven day numbers; a click opens that
  week in Week, the period kept per layout (P1). (DOM.)
- **P13.** A cell's seven marks are the days' duties (the first duty's shift
  where there are two); the letter shows where a day is 13 px or wider and
  `letters` is on; an off day is a faint mark; a day of another group draws
  its shift's mark (the group is the tile's and the inspector's to say).
  (DOM; responsive at 1024 and 768 for the 13 px rule.)
- **P14.** A click on a cell selects the person-week (D11); the selected cell
  is on `--paper-3` and outlined; a drafted week's cell is tinted. (DOM.)
- **P15.** A pattern dropped on a cell applies to that week (P17); the cell
  previews the pattern's marks dashed while the pattern hovers it. (DOM.)
- **P16.** The month's name cells hold the name and the Agency badge only: no
  hours, no cost. (DOM.)

### 9.4 Patterns and drops

- **P17.** A pattern dropped on a person's week (its row in Week, its cell in
  Month) replaces the seven days as D4 says, one step of the history named
  `Apply pattern`; the person-week is selected after it, the panes left as
  they are (B54). (`actions.ts`; DOM: one undo step, Save, remount.)
- **P18.** A pattern that leaves every day as it is applies nothing; the
  shared caption says so while it hovers: `Already matches Early · Mon–Fri`.
  (DOM.)
- **P19.** While a pattern hovers a person's row or cell, the row's tiles (or
  the cell's marks) show the pattern's days dashed in the brand tone, the
  cells of the days it changes tinted; the shared caption (B53) names the
  pattern, the person and the first warning: `Early · Mon–Fri → A. Alder · 6
  h rest`. Warned and allowed: rest (B52). Refused, the caption in the danger
  tone: a published or read-only week (`This week is not available to
  edit.`), the Agency requests row (`Drop a pattern on a person's week.`), a
  pattern naming a shift not configured (`Choose a configured shift.`).
  (`drag.ts`; DOM.)
- **P20.** The patterns tab, titled by the declaration's `name` and its cards
  marked by its `icon`, lists the patterns in their order, each card as §8
  draws it, no row of day initials over them; its search matches the label;
  the tab follows the slice's
  `patterns` source where there is one and counts what it shows (#1342); its
  footer hint is §8's. (`library.tsx`; DOM.)
- **P21.** A pattern's card carries no drop onto a duty or a Shifts cell:
  dropped there, the caption refuses (`Drop a pattern on a person's week.`).
  (DOM.)
- **P22.** *Product.* On a phone's People card, `Apply pattern…` opens a
  Chooser over the patterns; the choice applies as P17. (DOM at 390.)
- **P23.** *Product.* A malformed pattern (§4.2) is listed greyed with its
  reason and dragged by no one. (DOM.)

### 9.5 The inspector

- **P24.** A person-week selected shows the person's Details as today —
  `PersonFacts`' skills and seven days — over the selected week; a click on a
  day opens that week in Week with the duty selected, or the person where the
  day is off. (`inspector.tsx`; DOM, from Month.)
- **P25.** A tile selected shows the duty's Details (B34) as today. (DOM.)

### 9.6 Loading (#1398)

- **P26.** A month not read draws its header, bands, names and badges at once
  and a strip of seven placeholder marks in each cell; its reads are the
  month's span of duties (plus twelve hours either side), the weeks' rows and
  the targets, swapped at once (CL7); the months either side are read ahead
  once it lands, so a step to one shows it at once. (`data.ts`; DOM with a
  slowed worker, request log.)
- **P27.** A week not read in Week draws as today (#1398's Roster table): the
  name cell's contract real, the worked hours a bar, each day cell a tile
  placeholder, never `+ Assign` or `Off` (CL13). (DOM.)
- **P28.** The footer's existing line reads `Loading W10–W14` in Month,
  `Loading 12–18 Mar` in Week; a failure is said once across the first
  person's cells in view with Retry (CL11); the toolbar's slots are held as
  today (CL1); a period step keeps each person's row where it was (CL8).
  (DOM.)
- **P29.** A pattern card is real from cold load (the record is read whole,
  or through its source); a tab the slice narrows counts `…` until its count
  lands. (DOM.)
- **P30.** The row pitch is the density's (36, 32), every row one line, so
  nothing moves as a week lands; #1398's 52 px People pitch and its `+N`
  overflow proposal are settled so. (Responsive: row heights.)

### 9.7 Narrow main

- **P31.** Below 480 px of main, People shows the phone's cards as today, by
  week only: the Period segment offers Week alone, and a persisted month opens
  on its first week; each card gains `Apply pattern…` (P22); no drag source or
  target is registered. (DOM at 390.)
- **P32.** Tiles, marks and the Patterns tab register drag sources and
  targets only on a wide main, as every Roster drop does. (DOM.)

## 10. Patterns, as data

A pattern is `{ key, label, days }`: seven `Option<String>` from the week's
first day. The Roster reads them and writes nothing to them. A drop writes
duties: a new duty runs its shift from the shift's start on its day for the
shift's hours (`rosterNewDuty`), in the person's home group, at the position
`positionFor` gives them, with no activity; a moved duty takes the pattern's
shift at the shift's own times (`rosterMove`, then its start and end reset to
the shift's), its position kept, its activity kept within the group and
cleared across one; a removed duty is the session's removal, restorable until
Save (B56). Nothing of the pattern is stored.

## 11. Drag and drop, as a table

| Drag | Onto | Does | Refused, or warned |
|---|---|---|---|
| A pattern card | a person's week row (Week) or week cell (Month) | Replaces the seven days (P17) | Refused: a published or read-only week; the Agency requests row; a shift not configured. Warned: rest. Nothing to change: the caption says so (P18). |
| A pattern card | a day cell, a tile, a Shifts cell | — | Refused: `Drop a pattern on a person's week.` |
| A tile | another day of the same row | Moves the duty to that day, same shift and group (B60) | B49's refusals. |
| A tile | a cell of another person's row | — | Refused: `A duty moves along its own row.` |
| A person card | a day cell | Rosters them on their usual shift, else the first (B60) | B48. |
| An activity card | a tile | Sets the duty's activity (B51) | B51. |

All of it runs on the shared drag grammar (`LibraryRef`, `CellRef`,
`DragEvent`). A person-week target's `CellRef` names the person and the week's
first day (`row` the person's key, `slot` the East-printed `{ person, start }`);
a day cell's is today's (`rosterCoord`).

## 12. Where the product differs from the mock

| The mock | The product | Why, and what is lost |
|---|---|---|
| Two groups, twenty people, three fixed shifts of 8 h, contracts in days | The warehouse's records: three teams, 69 staff, the shifts' own hours, contracts in hours | The app's data. Nothing is lost. |
| Tiles tinted with the chart accent hues (`--blue-500` …), two palettes | A shift's `color`, a typed colour token the app gives; neutral without | The token is the app's and type-safe (D6, ruled). The palettes are lost. |
| A library of "Weeks" | A tab titled by the app's `name` — `Weeks` is one choice, the warehouse says `Patterns` | The app's words (D3, ruled). Nothing is lost. |
| Apply into an applied layer, then Publish | Save, in the shared history; Publish writes the status | One editing session (Roster Spec §12). The applied-but-unsaved layer is lost. |
| Over contract in shifts a week | Hours against the contract in the name cell | Contracts are hours (`contract`). |
| Week numbers from 2 Jan 2028 | ISO weeks (`isoWeekUTC`) | One week arithmetic. |
| No Agency requests row; agency people as rows | Agency people as rows, and the group's Agency requests row | Requests have no person (Roster Spec decision). |
| Panes collapsing at fixed widths; a 1600 px frame | `BuilderFrame`, by its own width; phone cards below 480 px | The frame's rule. |
| A Filter button | The rail's chips (`Slice.bindRecords`) | One rail (#1342). |
| The mock's toolbar, banner, inspector cards, legend and densities | Unchanged, or §13 | Outside this scope. |

## 13. Seen in the mock, not in this issue

The frame, its toolbar, banners, inspector and footer do not change here.
The mock shows each of these; each is a follow-up of its own if wanted:

| In the mock | What it would be |
|---|---|
| `‹ 3 of 8 issues ›` in the toolbar, stepping to each issue's subject | An issue stepper on the Roster's issues item, both layouts. |
| The last-change banner (`A. Alder · W11 → Early · Mon–Fri · 1 new issue · 2 resolved`, Undo) | A gesture's effect said once under the toolbar; #1398 kept banners for Save problems. |
| Three densities (36 / 32 / 28 px rows) | `density: "condensed"` and a third Display choice, as the design system's row rule asks. |
| Quick return across a week's edge, `N days in a row`, `Over contract` | `rules.streak`, `rules.contract`, over contract in `Roster.check`, and a `Roster.sequence(R)` over consecutive weeks (Roster Spec decision 11 revisited). |
| The person-week card in the inspector (the seven days with swatches, `Not applied · from "Early · Mon–Fri"`, the total against the contract) | A redrawn person Details; today's `PersonFacts` carries the facts. |
| A legend of the shifts, Off, Part of an issue, Own times, Shift in another group, Changed, Drop preview | The footer's legend per layout. |
| Display choices for the tile's times and the month's letters | Display menu items beside the two props (D7). |
| — | The Schematic's `color: Option<String>` (its D14) and every other string colour prop move to `ColorTokenType`, so one typed token serves every component. |

## 14. Wires

- **UI.** east-ui gains `ColorTokenType` and `ColorShadeType`, public types;
  the `Roster` extension's payload gains `patterns`, the `patterns` library
  tab with its name and icon, `tileTimes` and `letters` in its settings,
  `month` in its period, and `color` on each shift — package-borne; its
  `WIRE_MIGRATION.md` line.
- **Stored state.** None: the Roster stores nothing in a shape of its own
  (#1365); a pattern is the app's row, read.
- **Viewer state.** The Roster's persisted view gains a period per layout; a
  view kept under the old shape reads as the defaults.

## 15. Tests

- **east-ui specs and examples**: `ColorTokenType`, `ColorShadeType` and
  `Style.ColorToken` — the value, its print and its parse — with an `example()`
  for the index.
- **e3-ui specs** (`test/roster/`): the refusals — `view.period` against its
  layout, `Roster.library.patterns()` without `patterns`, `Roster.patterns`
  without `name`, a `color` accessor of another type naming `ColorTokenType`,
  a `days` accessor of another type; `Roster.patterns`' order, keys, name and
  icon; the payload's new fields on the wire (`roster-payload.spec.ts`).
- **e3-ui-components DOM tests** (`src/roster/*.dom.test.tsx`, on e3-web):
  the week grid's tiles and their words under both `tileTimes`, the `+1`, the
  hours in the name cell, the assign menu; the month grid's columns, marks,
  letters and column click; the period per layout and P1's segments in every
  toolbar form; a pattern drop as one undo step in Week and in Month, its
  preview, each refusal and warning, P18; a person-week selection from Month in
  the inspector; #1398's rules on the month (geometry first, placeholders, no
  `Off` before the read, anchoring on a step, the failure line once, the
  read-ahead of the neighbouring months); the phone's `Apply pattern…` and
  Week only.
- **Showcase responsive specs** (`tests/responsive/roster*.spec.ts`): the
  week and month grids at 1440/1024/768/390/360 in both themes, the tiles'
  computed colours from the shifts' tokens and the ink on them, a pattern
  dropped through a real
  e3 Save and remount, the month's read-ahead and a far step's placeholders
  with a slowed worker, row heights at both densities.
- **Examples** (`test/roster/roster.examples.tsx`): `rosterPeople` gains the
  patterns, the colours and `tileTimes`; `rosterPeopleMonth` opens on the
  month; the index is regenerated.
- **Docs**: `Roster Spec.md` §9.12 points here; the east-ui `SKILL.md`'s Style
  table (`ColorTokenType`, `Style.ColorToken`); the e3-ui `SKILL.md` Roster
  table (`patterns`, `color`, the periods, `tileTimes`, `letters`); e3-ui and
  e3-ui-components `CLAUDE.md` (People's periods; the People pitch);
  `WIRE_MIGRATION.md`.

## 16. How it lands

One PR, based on `elaraai/feat/e3-ui-schematic` (PR #1397, where the Roster's
#1398 loading rules already stand), this spec and the mock its first commit.
In order: east-ui's `ColorTokenType`, then the types and lists
(`Roster.patterns`, `color`, the periods and the payload), then the renderer (the week grid's tiles, name cell and assign menu;
the month grid and its reads; the Patterns tab and the drop; the person-week
selection), then the examples, the showcase, the responsive specs, the skill
and the docs. Each gate green: `make build`, `make test`, `make lint` in
`libs/east-ui`, `make test-responsive`, the plugin index regenerated, version
drift clean.
