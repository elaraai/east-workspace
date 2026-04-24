# Design & implementation plans

Each section / subsection of `COMPONENT_AND_PATTERN_GAPS.md` gets one detailed design-and-implementation plan in this folder. The plans are intended to be complete enough for a developer to pick up and deliver the work without going back to the gaps doc for resolution.

## Ownership split

- **`COMPONENT_AND_PATTERN_GAPS.md`** (parent doc) — states *what* changes and *why*. Single source of truth for scope.
- **`design-plans/<id>-<slug>.md`** (these files) — states *how* to build each change: source layout, types, tests, examples, renderer, showcase, a11y, migration, acceptance.

If the plan and the gaps doc disagree, the gaps doc wins; update the plan.

## Type-shape convention

Every component in east-ui follows the same main-type / style-sub-struct split:

- **Main type fields** — *what the component is, what it tracks, what it does*. Includes content (`value` / `children` / `items` / `body` / `trigger` / `header` / `footer` / `label` / `description` / `href` / `src`), state (`checked` / `loading` / `disabled` / `readOnly` / `required` / `indeterminate` / `closable` / `external` / `invalid` / `value` on forms / `defaultValue` / `index` / active flags), config (numeric constraints like `min` / `max` / `step` / `precision` / `maxLength` / `pattern` / `accept`; component-wiring flags like `multiple` / `collapsible` / `autoresize` / `allowCustomValue` / `loop` / `autoplay` / `frozen` / `interactive`), and ALL callbacks (`onClick` / `onChange` / `onBlur` / `onFocus` / `onValueChange` / `onOpenChange` / `onFileAccept` / etc.).
- **`style: OptionType(XxxStyleType)` sub-struct** — *how the component looks*. Holds every visual field for the component: layout / sizing (`width` / `height` / `min*` / `max*` / `flex` / `padding` / `margin` / `gap` / `overflow*`), positioning (`position` / `top` / `right` / `bottom` / `left` / `zIndex`), colour (`color` / `background` / `borderColor` + slot-specific colour overrides like `headerBackground` / `thumbColor` / `trackColor` / `markerColor`), border (`borderWidth` / `borderStyle` / `borderRadius` / `border`), typography (`textStyle` / `fontWeight` / `fontStyle` / `fontSize` / `fontFamily` / `fontVariantNumeric` / `textAlign` / `textDecoration` / `textTransform` / `textOverflow` / `whiteSpace` / `lineHeight` / `letterSpacing`), opacity / motion / shadow (`opacity` / `boxShadow` / `transform` / `transition` / `animation` / `cursor`), visual presets (`variant` / `colorPalette` / `size` / `elevation`), and geometric presentation (`orientation` / `direction` / `align` / `justifyContent` / `alignItems` / `flexDirection` / `flexWrap` / `placement` / `hasArrow` / `hoverIntent` / `curveType`).

The split is **uniform across all 55 components** — typography primitives follow the same rule as layout containers follow the same rule as form inputs. `style` is the single visual-presentation bucket for that component, not a "colour escape hatches only" bucket. A component with one visual preset and nothing else still exposes it as `{ style: { variant } }`, not as a top-level `variant` field.

Chart functional sub-configs (`xAxis` / `yAxis` / `tooltip` / `legend` / `margin` / `brush` / `ReferenceLine|Dot|Area`) are **compound configs, not visual style** — they stay on the main type even though they carry visual fields internally. A chart-chrome-only `style` struct (background, gridColor) may sit alongside them.

**Edge-case calls:**
- `variant` / `colorPalette` / `size` — visual presets → `style`.
- `loading` / `disabled` — runtime state → **main** (even though they *render* a spinner or greyed-out look).
- `multiple` / `collapsible` / `autoresize` / `loop` / `timeout` — behaviour/wiring → **main**.
- `striped` (Table) / `stickyHeader` (Table) — visual presets that alter the layout model → `style` (pragmatic).
- `placement` / `hasArrow` / `hoverIntent` (Tooltip / Popover / HoverCard) — positioning-as-visual → `style`.
- `orientation` / `direction` / `flexDirection` / `flexWrap` — layout-as-visual → `style`.
- `indicator` (Stat) — structured runtime state → **main**.
- Per-item/per-segment/per-row `color` fields on sub-types (e.g. BarStripItem.color, SegmentedMeterSegment.color) — **per-item data**, stays on the item sub-type.

## Index

| ID | Plan | Section in gaps doc | Status |
|---|---|---|---|
| 0 | `0-conventions.md` | §0 Conventions | draft |
| 1.1 | `1.1-global-style-system.md` | §1.1 Global style system (tokens + semantic layer) | draft |
| 1.2 | `1.2-layout.md` | §1.2 Layout (Box, Flex, Stack, Grid, Splitter, Separator, Sticky, ScrollArea) | draft |
| 1.3 | `1.3-typography.md` | §1.3 Typography (Text, Heading, Numeric, Note, Code, CodeBlock, Link, Highlight, Mark, List) | done |
| 1.4 | `1.4-buttons.md` | §1.4 Buttons (Button, IconButton, CopyButton, CloseButton, Toggle, ButtonGroup) | done |
| 1.5 | `1.5-forms.md` | §1.5 Forms (Input suite, Slider, Field, FileUpload, Textarea, TagsInput, Radio*, Date/TimeRange, TimeScaleControl) | draft |
| 1.6 | `1.6-feedback.md` | §1.6 Feedback (Alert, Banner, Progress, ProgressCircle, Skeleton, Spinner, Status, Toast, EmptyState) | done |
| 1.7 | `1.7-display.md` | §1.7 Display (Badge, Tag, Avatar, Stat, Icon, MetricChip, EditableChip, Kbd, Meter, SegmentedMeter, BarStrip, AvatarGroup) | done |
| 1.8 | `1.8-container.md` | §1.8 Container (Card compound + state contract) | done |
| 1.9 | `1.9-disclosure.md` | §1.9 Disclosure (Accordion, Tabs, Carousel, SegmentGroup, Collapsible, Disclosure, Steps, Timeline, OptionList) | done |
| 1.10 | `1.10-collections.md` | §1.10 Collections (Table, DataList, TreeView, Gantt, Planner, Matrix, Pagination) | draft |
| 1.11 | `1.11-charts.md` | §1.11 Charts (cross-cutting upgrades; retire bar-segment/bar-list) | draft |
| 1.12 | `1.12-overlays.md` | §1.12 Overlays (Tooltip, ToggleTip, Menu, Dialog, Drawer, Popover, HoverCard, ActionBar, CommandPalette, InfoAffordance, Tour, CoachMark) | draft |
| 1.13 | `1.13-navigation.md` | §1.13 Navigation (Breadcrumb, NavList, TableOfContents) | draft |
| 1.14 | `1.14-platform.md` | §1.14 Platform (Clipboard, Toast, Download, Share, FocusScope, DnD) | draft |
| 2.1 | `2.1-observe.md` | §2.1 Observe patterns | draft |
| 2.2 | `2.2-explain.md` | §2.2 Explain patterns | draft |
| 2.3 | `2.3-decide.md` | §2.3 Decide patterns | draft |
| 2.4 | `2.4-compare.md` | §2.4 Compare patterns | draft |
| 2.5 | `2.5-configure.md` | §2.5 Configure patterns (inc. AssignmentBoard suite) | draft |
| 2.6 | `2.6-frame-and-trust.md` | §2.6 Frame & trust patterns | draft |
| 2.7 | `2.7-cross-cutting-helpers.md` | §2.7 `Format.*`, `LocaleProvider`, `Timezone`, `ColorScale`, `Provenance` | draft |

## Standard layout (every plan file follows this)

Each plan is a single markdown file with these sections — in this order — so readers can skim consistently.

```md
# <section id> — <title>

**Gaps-doc reference:** link to the corresponding section in `COMPONENT_AND_PATTERN_GAPS.md`.
**Scope:** one-line summary of what ships after this plan is executed.
**Out of scope for this plan:** anything explicitly deferred.

## 0. Status summary

Table: each component/pattern × { Current status: ✓/⚠/✗ · Change class: new / widen / rename / delete · Breaking? }.

## 1. Dependencies

Libraries introduced or used by this section. Chakra v3 primitives, Radix, Recharts, dnd-kit, kbar/cmdk, etc. Note peer-vs-bundled per `§UI-9 bundle plan` in the gaps doc.

## 2. File plan

Exhaustive list of files that will be created, modified, or deleted, keyed by package:
- `@elaraai/east-ui` — `src/<cat>/<comp>/` (IR) + `test/<cat>/<comp>.{spec,examples}.ts`.
- `@elaraai/east-ui-components` — `src/<cat>/<comp>/index.tsx` (React renderer).
- `@elaraai/east-ui-showcase` — `App.tsx` wiring + any `src/<cat>.ts` example index updates.
- `@elaraai/east-ui-patterns` (when a pattern) — `src/<mode>/<pattern>/` + tests + renderer.

For every file: path, purpose, approximate line count.

## 3. Per-entry design

One subsection per component/pattern in the gaps doc table. Each subsection has:

### 3.N `<ComponentName>`

- **East IR type** — exact `StructType` / `VariantType` shape, split into two parts per the Type-shape convention above:
    - **Main struct** — content + state + config + behaviour fields only.
    - **`XxxStyleType` struct** — all visual fields for the component (layout, sizing, colour, border, typography, opacity/motion/shadow, visual presets, geometric presentation). Referenced from the main struct as `style: OptionType(XxxStyleType)`.
  Call out fields that need special handling (OptionType wrappers, FunctionType callbacks, Recursive nodes).
- **East factory signature** — `ComponentName.Root(contentArgs, { ...behaviour, style?: { ...visual } })`. Include default values and any literal-union unions on variant props. Literal unions on `style` members (e.g. `variant: "solid" | "outline"`) are accepted at the factory layer for ergonomics; the IR shape is the struct.
- **React renderer** — `toChakra<Name>(value)` pure-function contract (input = `ValueTypeOf<typeof ComponentName.Types.X>`, output = Chakra props). `EastChakra<Name>` memo equality function. Chakra v3 components used. Any required portals / providers / context. A11y contract notes (required `aria-*`, focus-trap, keyboard).
- **Style struct members** — enumerate the fields of `XxxStyleType`, mapped to the exact Chakra `css={...}` keys or prop-level overrides. Colour escape hatches are one *category* of entry (alongside layout, sizing, typography, border, opacity/motion, visual presets, and geometric presentation).
- **Tests** — `test/<cat>/<comp>.spec.ts`: list of `test("…", $ => { … })` cases the developer must write (shape, defaults, each variant, each style prop, every callback, every a11y requirement).
- **Examples** (`test/<cat>/<comp>.examples.ts`) — prescribe each example:
  - Name (export identifier — `camelCase`).
  - Keywords (for the example search index).
  - Description (one-line human summary).
  - What the example must demonstrate (prose + the expected composition of primitives).
  - Inputs (usually `[]`; rarely needed).
  - Reference mockup (pointer into `shift-optimiser-mockup.html` or `Nestle CEO Briefing v3.html` if the visual is drawn there — **do not diverge from existing styles**).
- **Showcase entry** — which `east-ui-showcase` page or card the example renders on; cross-link to `App.tsx`.
- **Implementation notes** — React lifecycle concerns, Chakra gotchas, virtualisation, performance.
- **Migration** — if existing, exactly what breaks and how callers update.

## 4. Contract compliance

- **States (§0.1):** default / deviations.
- **A11y (§0.2):** keyboard path, ARIA, focus, hit target.
- **Colour / dichromacy (§0.3):** paired-icon requirement check.
- **Responsive (§0.4):** minimum container width, density integration.
- **Hover intent (§0.5):** if hover-to-open primitives used.
- **Patches (§0.8):** if commit-adjacent, the exact patch typing.

## 5. Acceptance criteria

Bulleted "this plan is done when" list. Must be verifiable in CI where possible.

## 6. Effort estimate

Rough S/M/L sizing per entry + overall.

## 7. Open questions

Things the plan deliberately punts to the implementer or to a future doc.
```

## How to use

1. Pick the next plan from the index.
2. Read the corresponding section of `COMPONENT_AND_PATTERN_GAPS.md`.
3. Fill in the standard layout. Aim for the plan to be complete enough that a mid-level dev can execute without asking further scope questions.
4. Set the Index status to `draft`; update to `ready` once reviewed and to `done` when the code is merged.

## Consistency rules

- Never introduce new design tokens or component styles in the plan — everything traces back to the gaps doc.
- Never diverge from the Chakra v3 theme in examples. The reference mockups (`shift-optimiser-mockup.html`, `Nestle CEO Briefing v3.html`) describe the *composition* we want, not the *styles*. The theme is owned by the consuming app.
- Every component and pattern follows the type-shape convention: content / state / behaviour on the main type, all visual presentation inside a single `style: OptionType(XxxStyleType)` sub-struct. No exceptions for "small" components.
- Never put callbacks (`onClick`, `onChange`, etc.), runtime state (`loading`, `disabled`, `checked`, `indeterminate`, `closable`), or component-wiring flags (`multiple`, `collapsible`, `autoresize`, `timeout`) inside `style`. Those are main-type fields.
- Never propose a colour-only `style` struct — the `style` struct is the whole-visual bucket (colour is one category inside it).
- Every pattern plan must cite the `Mode` / `Question` from the gaps doc in its §3 heading so reviewers can trace intent.
- Every example must be reproducible by a developer in < 20 lines of East code.
- Tests and examples must not share source — tests import examples, not the other way round (per existing `badge.spec.ts` pattern).
- **Every public export carries TypeDoc to the gold-standard level codified in [`STANDARDS.md`](../../STANDARDS.md#typedoc-documentation-standards) — no exceptions, no shortcuts when migrating existing code:**
    - **Namespace object** (e.g. `Button`, `IconButton`, `Toggle`): front-matter `@remarks` describing purpose + usage pointer to `Xxx.Root(...)`.
    - **`Xxx.Root` (factory) property**: full block with `@param`, `@returns`, `@remarks`, **and** `@example` using `East.function()`. The example lives verbatim in the property JSDoc — not behind a `@see` reference — so it shows on hover and is picked up by TypeDoc's HTML output.
    - **`Xxx.Types.*` properties** (`Button`, `Style`, `Variant`, etc.): front-matter summary + `@remarks` + `@property` tag for every field / variant tag. TypeDoc cannot see inline comments inside `StructType({ ... })` arguments, so the `@property` tags on the exported const are load-bearing.
    - **Private factory function** (e.g. `createButton`): full block matching the `Xxx.Root` property — STANDARDS.md §Factory Functions. When a plan migrates an existing component, preserve the existing TypeDoc (`@param` / `@returns` / `@remarks` / `@example` / `@property`) and update bodies for the new shape — do not delete the doc blocks.
    - **TypeScript interfaces** (`XxxStyle`, `XxxOptions`): front-matter summary + per-property inline JSDoc on each field so editor hover descriptions are available at call sites.
    - **East types** (`StructType` / `VariantType`): front-matter summary + `@remarks` + `@property` for every field/variant tag (load-bearing — TypeDoc can't read inline struct comments).
