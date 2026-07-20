---
name: east-ui
description: "Type-safe UI component library for the East language, authored as JSX tags. Use when writing East programs that define user interfaces. Triggers for: (1) Authoring `.tsx` component trees with `@elaraai/east-ui` tags, (2) Layout with <Box>, <Flex>, <Stack>/<VStack>/<HStack>, <Grid>, <Splitter>, <ScrollArea>, <Sticky>, <Expandable>, <Dock>, <AlignedStack>, (3) Forms with <Input>, <Textarea>, <Select>, <Combobox>, <Checkbox>, <Switch>, <Slider>, <RadioGroup>, <RadioCardGroup>, <TagsInput>, <FileUpload>, <Field>, <DateRangeInput>, <TimeRangeInput>, (4) Data display with <Table>, <TreeView>, <ValueTree>, <DataList>, <Deck>, <Gantt>, <Planner>, <Matrix>, <Calendar>, <Schematic>, <Map>, <Library>, <Roster>, <Board>, <Blend>, <Slice.Rail>, <Pagination>, <ChipRail>, <Trace>, (5) Charts with <Chart layers={Chart.Line/Column/Bar/Area/Scatter/Band(...)}/> (Column = vertical, Bar = horizontal) plus Chart.refLine/refBand/refDot, <Sparkline>, (6) Overlays with <Dialog>, <Drawer>, <Popover>, <Menu>, <Tooltip>, <HoverCard>, <ToggleTip>, <ActionBar>, <CommandPalette>, <Hotkey>, (7) Feedback with <Banner>, <Status>, <Progress>, <Skeleton>, <EmptyState>, (8) Disclosure with <Tabs>, <Accordion>, <Carousel>, <Collapsible>, <SegmentGroup>, <OptionList>, <Story>, (9) Navigation with <Breadcrumb>, <NavList>, route-stack page switching (Navigation.config / Navigation.bind / <Pages>, plus <Route> to host a remounting per-route slot anywhere), and <App> — the whole application shell (collapsible rail + breadcrumb + logo + routed body from one nav handle, with an east-ui-components AppProvider for host-injected app-bar chrome), (10) Reactive UI via <Reactive>{$ => …}</Reactive> + State.bind, and conditional hosting of stateful components via <Match on cases> (remounts the active variant case on tag change), (11) Shared value formatting — one Chart.format.* spec reused by chart axes, Slice fields, <Stat>, <Numeric> and Deck metrics, (12) Status colour vocabulary — the five status tokens, the Deck.statuses registry, Library.status, rowStatus tints and tone props."
---

# East UI

A type-safe UI component library for the East language. The public surface is
**JSX tags** — capitalized, React-style components that desugar to East IR. No
React at runtime: a `<Button>` evaluates to the identical
`ExprType<UIComponentType>` value, which serializes and renders anywhere.

## Quick Start

```tsx
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { VStack, HStack, Text, Button, UIComponentType } from "@elaraai/east-ui";

const MyComponent = East.function([], UIComponentType, (_$) => (
    <VStack gap="4" padding="6">
        <Text textStyle="heading-md" fontWeight="bold">Hello, World!</Text>
        <HStack gap="2">
            <Button variant="outline">Cancel</Button>
            <Button variant="solid" colorPalette="blue">Save</Button>
        </HStack>
    </VStack>
));

const ir = MyComponent.toIR();
```

Three things make a file JSX-capable:
1. The per-file pragma `/** @jsxImportSource @elaraai/east-ui */` (first line).
2. One tag import line from `@elaraai/east-ui`.
3. A `.tsx` extension.

**Tags vs factories.** Each tag desugars 1:1 to a factory call —
`<Button variant="solid">Save</Button>` builds the same IR as
`Button.Root("Save", { variant: "solid" })`. The factories are an implementation
detail under `@elaraai/east-ui/internal` (used by renderers/tests). **Author with
tags**; props are exactly the factory's flat options bag.

## Decision Tree: Which Tag to Use

Every public tag is listed with its purpose, its **Props** (each marked
required / optional) and its **Factories** — the `Component.xyz(…)` builders
that construct that component's config values. Props are the factory's flat
option bag — no nested `style` object. Children are always UI components;
non-UI sub-structures (columns, layers, cells, header fields) are **config
props or typed callbacks**, never child sub-tags.

Two shared prop bags recur; a Props list references them by name instead of
re-listing each member's description:

- **BOX bag** (all optional) — `width`, `height`, `minWidth`, `minHeight`,
  `maxWidth`, `maxHeight`, `padding`, `margin`, `overflow`, `overflowX`,
  `overflowY`, `opacity`. CSS sizing/box-model pass-throughs (see the Sizing
  pattern below for the string spellings).
- **COLOR overrides** (all optional) — `color`, `background`, `borderColor`.
  Explicit escape hatches over the palette / variant defaults; take semantic
  tokens (`fg.muted`, `bg.subtle`) or CSS colours.

```
Task → Which tag?
│
├─ Layout (arrange content)
│   ├─ <Box> — generic block container
│   │   └─ Props:
│   │       ├─ children (required) — the boxed content
│   │       ├─ display (optional) — CSS display (block / flex / grid / …)
│   │       ├─ flexDirection / justifyContent / alignItems / gap (optional) — flex props when display is flex
│   │       ├─ flex / flexGrow / flexShrink (optional) — behaviour as a flex CHILD
│   │       ├─ fill (optional) — boolean shorthand for "fill remaining space" (flex:1 + min-height:0)
│   │       ├─ scroll / scrollX / scrollY (optional) — boolean shorthands for a styled scroll region
│   │       ├─ position / top / right / bottom / left / zIndex (optional) — positioning; zIndex is a token
│   │       ├─ borderRadius / border / borderColor / borderWidth (optional) — border styling
│   │       ├─ boxShadow / transform / transition / cursor / animation (optional) — presentation extras
│   │       ├─ fontFamily / fontVariantNumeric (optional) — inherited text styling for the subtree
│   │       ├─ density (optional) — provides "condensed"|"compact"|"comfortable" to densified descendants
│   │       └─ …plus BOX bag + COLOR overrides
│   ├─ <Flex> — flexbox container
│   │   └─ Props:
│   │       ├─ children (required) — flex items
│   │       ├─ direction (optional) — row | column (+reverse)
│   │       ├─ wrap (optional) — nowrap | wrap | wrap-reverse
│   │       ├─ justifyContent / alignItems / gap (optional) — main/cross alignment + spacing
│   │       ├─ density (optional) — density provider (as Box)
│   │       └─ …plus the same flex-child / position / border / presentation props as <Box>, BOX bag, COLOR overrides
│   ├─ <Stack> / <VStack> / <HStack> — flex with stacking defaults (VStack = column, HStack = row)
│   │   └─ Props:
│   │       ├─ children (required) — stacked items
│   │       ├─ direction (optional, <Stack> only) — stacking axis
│   │       ├─ gap (optional) — spacing token between items
│   │       ├─ align / justify (optional) — cross/main-axis alignment
│   │       ├─ wrap (optional) — allow wrapping
│   │       ├─ density (optional) — density provider (as Box)
│   │       └─ …plus fill/scroll shorthands, flex-child, position, border, presentation props, BOX bag, COLOR overrides
│   ├─ <Grid> — CSS grid container
│   │   ├─ Props:
│   │   │   ├─ children (required) — grid items (wrap one in Grid.Item to place it)
│   │   │   ├─ templateColumns / templateRows / templateAreas (optional) — grid templates ("repeat(auto-fit, minmax(240px, 1fr))" reflows to 1 column on phones)
│   │   │   ├─ gap / columnGap / rowGap (optional) — grid spacing
│   │   │   ├─ justifyItems / alignItems / justifyContent / alignContent (optional) — item + track alignment
│   │   │   ├─ autoColumns / autoRows / autoFlow (optional) — implicit-track sizing + placement
│   │   │   ├─ density (optional) — density provider
│   │   │   └─ …plus BOX bag (width/height/min*/max*/padding)
│   │   └─ Factories:
│   │       └─ Grid.Item(children, { colSpan?, rowSpan?, colStart?, colEnd?, rowStart?, rowEnd?, area? }) — explicit cell placement for one child
│   ├─ <Splitter> — resizable panel group
│   │   ├─ Props:
│   │   │   ├─ panels (required) — array of Splitter.Panel(…) values
│   │   │   ├─ defaultSize (required) — initial size percentages, one per panel
│   │   │   ├─ children (required) — one body per panel, in order
│   │   │   ├─ orientation (optional) — horizontal | vertical
│   │   │   ├─ collapseBelow (optional) — container px width below which the panels stack vertically
│   │   │   └─ onResize / onResizeStart / onResizeEnd (optional) — drag lifecycle callbacks (sizes payload)
│   │   └─ Factories:
│   │       └─ Splitter.Panel({ id, minSize?, maxSize?, collapsible?, defaultCollapsed? }) — one panel: id (required), min/max size as percentages, collapsibility
│   ├─ <Separator> — 1px rule
│   │   └─ Props:
│   │       ├─ orientation (optional) — horizontal | vertical
│   │       ├─ variant (optional) — subtle | brand | dashed | strong
│   │       ├─ label (optional) — inline label on the rule (string or UIComponent)
│   │       └─ align (optional) — label placement along the rule
│   ├─ <ScrollArea> — styled-scrollbar scroll container
│   │   └─ Props:
│   │       ├─ children (required) — scrollable content
│   │       ├─ orientation (optional) — vertical (default) | horizontal
│   │       ├─ scrollbarStyle (optional) — overlay (default) | classic
│   │       └─ thumbColor / trackColor / background (optional) — scrollbar + viewport colours
│   ├─ <Sticky> — position-sticky wrapper
│   │   └─ Props:
│   │       ├─ children (required) — the stuck content
│   │       ├─ offset (optional) — CSS length sticky offset (default "0")
│   │       ├─ boundary (optional) — stick to the parent scroll ancestor (default) or the viewport
│   │       └─ background / borderColor / shadowColor (optional) — styling applied while stuck
│   ├─ <Expandable> — region expands in place to fill the app container (CSS takeover, no remount); Esc collapses
│   │   └─ Props:
│   │       ├─ children (required) — the expandable region
│   │       ├─ expanded (optional) — controlled expanded state
│   │       ├─ onExpandedChange (optional) — fn(Boolean) => Null on user toggle
│   │       ├─ label (optional) — accessible toggle name ("Expand ‹label›")
│   │       ├─ zIndex (optional) — stacking level of the expanded surface (default 900, below Chakra floating tiers)
│   │       └─ background (optional) — expanded-surface background (default bg.canvas)
│   ├─ <Dock> — inline panel that collapses along an axis to an icon rail, staying in flow (siblings reflow; never overlays) — a source panel beside a drop target (Library beside Planner); Esc does NOT collapse
│   │   └─ Props:
│   │       ├─ children (required) — the docked panel body
│   │       ├─ orientation (optional) — collapse axis: horizontal (default) | vertical
│   │       ├─ side (optional) — edge the rail pins to: start (default) | end
│   │       ├─ expandedSize / railSize (optional) — size along the axis expanded (px or %) / collapsed (default 44px)
│   │       ├─ icon / label / badge (optional) — rail + header icon (FA name), title, count chip
│   │       ├─ collapsed (optional) — controlled collapsed state
│   │       ├─ defaultCollapsed (optional) — uncontrolled initial state (default false)
│   │       ├─ onCollapsedChange (optional) — fn(Boolean) => Null on user toggle
│   │       ├─ persist (optional) — where the uncontrolled state persists (default none)
│   │       ├─ keepMounted (optional) — keep the body mounted while collapsed (default true)
│   │       ├─ lazy (optional) — mount the body only on first expand (default false)
│   │       └─ animated (optional) — animate the rail↔expanded size change (default false)
│   └─ <AlignedStack> — vertical stack that pins every lane child to ONE shared plot gutter (#147) so a Chart over a Planner over a Trace line up on a common x-axis
│       └─ Props:
│           ├─ children (required) — the stacked, gutter-aware lanes (Chart / Planner / Gantt / Table / Calendar / Trace)
│           ├─ gutter (optional) — "auto" (measure the widest lane) or an explicit { left, right } px gutter
│           ├─ gap (optional) — vertical spacing between lanes
│           ├─ density (optional) — density imposed on every lane child (a child's own density wins)
│           └─ width / height / minHeight (optional) — stack sizing
│
├─ Typography (display text)
│   ├─ <Text> — inline/block text
│   │   ├─ Props:
│   │   │   ├─ children (required) — the text (an East string — see the Text pattern below)
│   │   │   ├─ textStyle (optional) — typographic preset token (body-md, heading-sm, …)
│   │   │   ├─ fontWeight / fontStyle / fontFamily (optional) — face overrides (fontFamily: sans | serif | mono)
│   │   │   ├─ fontVariantNumeric (optional) — e.g. tabular-nums for aligned digits
│   │   │   ├─ textAlign / textDecoration / textTransform (optional) — alignment + decoration + casing
│   │   │   ├─ textOverflow / whiteSpace (optional) — ellipsis / wrapping control
│   │   │   ├─ lineHeight / letterSpacing (optional) — rhythm overrides
│   │   │   ├─ borderWidth / borderStyle (optional) — text-block border (with borderColor)
│   │   │   └─ …plus BOX bag + COLOR overrides
│   │   └─ Factories:
│   │       ├─ Text.Presets.Eyebrow(text, style?) — mono uppercase eyebrow (section labels, status words)
│   │       ├─ Text.Presets.EyebrowSm(text, style?) — smaller eyebrow tier
│   │       ├─ Text.Presets.MonoLabel(text, style?) — mono label (sidebar items, dense frame headers)
│   │       ├─ Text.Presets.MonoSm(text, style?) — small mono annotation
│   │       ├─ Text.Presets.MetaSm(text, style?) — small muted meta line
│   │       └─ Text.Presets.MonoKpi(text, style?) — 24px mono tabular-nums KPI number
│   ├─ <Heading> — display heading
│   │   └─ Props:
│   │       ├─ children (required) — the heading text
│   │       ├─ as (optional) — rendered element h1…h6
│   │       ├─ textStyle (optional) — heading preset token
│   │       ├─ fontWeight / fontStyle / fontFamily (optional) — face overrides
│   │       ├─ textAlign / textDecoration / lineHeight / letterSpacing (optional) — alignment + rhythm
│   │       └─ …plus BOX bag + COLOR overrides
│   ├─ <Link> — hyperlink
│   │   └─ Props:
│   │       ├─ href (required) — target URL
│   │       ├─ children (required) — link text
│   │       ├─ external (optional) — open in a new tab
│   │       ├─ variant (optional) — underline-on-hover presets
│   │       ├─ colorPalette (optional) — hue theming
│   │       ├─ hoverColor / visitedColor (optional) — state colours
│   │       └─ …plus textDecoration / lineHeight / letterSpacing, BOX bag, COLOR overrides
│   ├─ <Code> — inline code token
│   │   └─ Props:
│   │       ├─ children (required) — the code text
│   │       ├─ variant (optional) — visual preset
│   │       ├─ colorPalette / size (optional) — hue + size
│   │       └─ …plus textDecoration / lineHeight / letterSpacing, BOX bag, COLOR overrides
│   ├─ <CodeBlock> — multi-line code block
│   │   └─ Props:
│   │       ├─ children (required) — the source text
│   │       ├─ language (optional) — syntax-highlight language
│   │       ├─ showLineNumbers / highlightLines (optional) — gutter numbers + highlighted line list
│   │       ├─ showCopyButton (optional) — corner copy affordance
│   │       ├─ wordWrap (optional) — soft-wrap long lines
│   │       ├─ title (optional) — header caption
│   │       ├─ headerBackground / lineNumberColor / highlightBackground (optional) — chrome colours
│   │       └─ …plus BOX bag + COLOR overrides
│   ├─ <List items={…}> — bulleted / numbered list
│   │   └─ Props:
│   │       ├─ items (required) — the entries (strings or nested components — a config prop, not JSX children)
│   │       ├─ variant (optional) — ordered | unordered | dot
│   │       ├─ marker / markerIcon / markerColor (optional) — marker glyph styling
│   │       ├─ colorPalette / gap (optional) — hue + item spacing
│   │       └─ …plus BOX bag + COLOR overrides
│   ├─ <Highlight> — tints query substrings inside its text
│   │   └─ Props:
│   │       ├─ children (required) — the full text
│   │       ├─ query (required) — substrings to highlight
│   │       └─ color / background (optional) — highlight ink + wash, plus BOX bag
│   ├─ <Mark> — semantic <mark> span
│   │   └─ Props:
│   │       ├─ children (required) — the marked text
│   │       ├─ variant (optional) — severity preset
│   │       └─ colorPalette + COLOR overrides + BOX bag (all optional)
│   ├─ <Note> — inset callout / quote
│   │   └─ Props:
│   │       ├─ children (required) — note content
│   │       ├─ variant (optional) — visual preset
│   │       ├─ emphasis (optional) — brand | warn | danger
│   │       ├─ accentColor (optional) — the callout stripe colour
│   │       └─ width / maxWidth / padding / margin / opacity + COLOR overrides (all optional)
│   └─ <Numeric> — tabular-num number with sentiment (shares the Formats vocabulary)
│       └─ Props:
│           ├─ value (required) — the raw number
│           ├─ format (optional) — a shared Chart.format.* spec (see the Formats branch)
│           ├─ sentiment (optional) — positive | negative | neutral colouring
│           ├─ showSign (optional) — always render the +/− sign
│           ├─ textStyle (optional) — typographic preset
│           └─ signColor / color / background / opacity (optional) — ink overrides
│
├─ Buttons (user actions)
│   ├─ <Button> — the standard action button
│   │   └─ Props:
│   │       ├─ children (required) — label text
│   │       ├─ variant (optional) — solid | subtle | outline | ghost | plain
│   │       ├─ colorPalette / size (optional) — hue + size token
│   │       ├─ onClick (optional) — East.function([], NullType) handler
│   │       ├─ startIcon / endIcon (optional) — leading / trailing icon ({ prefix, name })
│   │       ├─ loading / loadingText / loadingIcon (optional) — spinner state + swapped label/icon
│   │       ├─ disabled (optional) — blocks interaction
│   │       └─ hoverBackground + COLOR overrides (optional) — palette escape hatches
│   ├─ <IconButton> — icon-only button
│   │   └─ Props:
│   │       ├─ prefix / name (required) — Font Awesome icon ("fas", "chevron-right")
│   │       ├─ label (required) — accessible aria-label
│   │       ├─ variant / colorPalette / size (optional) — as Button
│   │       ├─ onClick / loading / loadingIcon / disabled (optional) — as Button
│   │       ├─ badge (optional) — superscript count text ("99+", "" = dot-only)
│   │       ├─ badgeColorPalette (optional) — badge hue (default red)
│   │       ├─ attention (optional) — "pulse" blinks the badge, "ring" rings the button
│   │       └─ hoverBackground + COLOR overrides (optional)
│   ├─ <CloseButton> — × dismiss button
│   │   └─ Props: variant / size / label (aria, default "Close") / disabled / onClick / hoverBackground + COLOR overrides (all optional)
│   ├─ <CopyButton> — copies to clipboard with ✓ feedback
│   │   └─ Props:
│   │       ├─ value (required) — the text copied
│   │       ├─ label (optional) — text next to the copy icon
│   │       ├─ timeout (optional) — "Copied!" duration ms
│   │       ├─ successColor (optional) — confirmation glyph tint
│   │       └─ variant / colorPalette / size / disabled / hoverBackground + COLOR overrides (optional)
│   ├─ <Toggle> — pressable on/off button (NOT a form toggle — see <Switch>)
│   │   └─ Props:
│   │       ├─ pressed (required) — current state (Toggle has no internal state)
│   │       ├─ children (required) — label
│   │       ├─ onChange (optional) — fn(Boolean) => Null
│   │       ├─ icon (optional) — leading icon
│   │       ├─ pressedBackground / pressedColor (optional) — pressed-state colours
│   │       └─ variant / size / disabled + COLOR overrides (optional)
│   └─ <ButtonGroup> — row/col cluster of buttons
│       └─ Props:
│           ├─ children (required) — the buttons
│           ├─ attached (optional) — join into one control with shared borders
│           └─ gap / borderColor (optional) — spacing when not attached; shared border colour when attached
│
├─ Forms (user input)
│   ├─ <Input> — typed text inputs (namespace tag)
│   │   ├─ Nested tags: <Input.String> <Input.Integer> <Input.Float> <Input.DateTime> — value-typed variants
│   │   └─ Props (shared unless noted):
│   │       ├─ value (required) — current value (String / Integer / Float / DateTime respectively)
│   │       ├─ onChange (optional) — fn(newValue) => Null (typed per variant)
│   │       ├─ onBlur / onFocus (optional) — focus lifecycle
│   │       ├─ variant (optional) — outline | subtle | flushed
│   │       ├─ size (optional) — xs | sm | md | lg
│   │       ├─ disabled (optional) — blocks input
│   │       ├─ autoFocus (optional) — focus on first mount
│   │       ├─ String: placeholder / maxLength / pattern (optional) — text constraints
│   │       ├─ Integer & Float: min / max / step (optional); Float: precision (decimal places)
│   │       ├─ DateTime: min / max / precision (date|time|datetime) / format (token list) (optional)
│   │       └─ focusBorderColor / placeholderColor + COLOR overrides (optional)
│   ├─ <Textarea> — multi-line input
│   │   └─ Props:
│   │       ├─ value (required) — current text
│   │       ├─ onChange / onBlur / onFocus / onValidate (optional) — edit + focus callbacks
│   │       ├─ placeholder / rows / maxLength / autoresize (optional) — sizing + constraints
│   │       ├─ resize (optional) — none | vertical | horizontal | both
│   │       ├─ disabled / readOnly / required / invalid (optional) — form state
│   │       └─ variant / size / focusBorderColor + COLOR overrides (optional)
│   ├─ <Select> — single/multi-select dropdown
│   │   ├─ Props:
│   │   │   ├─ value (required) — selected value ("" = none)
│   │   │   ├─ items (required) — array of Select.Item(…)
│   │   │   ├─ onChange (optional) — fn(String) => Null (single)
│   │   │   ├─ onChangeMultiple (optional) — fn(Array<String>) => Null (multi)
│   │   │   ├─ multiple / placeholder / disabled / size (optional) — behaviour + chrome
│   │   │   ├─ onOpenChange (optional) — dropdown open/close callback
│   │   │   └─ COLOR overrides (optional) — trigger colours
│   │   └─ Factories:
│   │       └─ Select.Item(value, label, { disabled? }) — one option
│   ├─ <Combobox> — typeahead / filter select
│   │   ├─ Props:
│   │   │   ├─ value (required) — current input / selected value
│   │   │   ├─ items (required) — array of Combobox.Item(…)
│   │   │   ├─ onChange / onChangeMultiple (optional) — selection callbacks (single / multi)
│   │   │   ├─ onInputValueChange (optional) — fires as the user types
│   │   │   ├─ allowCustomValue (optional) — accept values not in the list
│   │   │   ├─ multiple / placeholder / disabled / size / onOpenChange (optional) — as Select
│   │   │   └─ COLOR overrides (optional)
│   │   └─ Factories:
│   │       └─ Combobox.Item(value, label, { disabled? }) — one option
│   ├─ <Checkbox> — boolean checkbox
│   │   └─ Props:
│   │       ├─ checked (required) — current state
│   │       ├─ onChange (optional) — fn(Boolean) => Null
│   │       ├─ label (optional) — trailing text
│   │       ├─ indeterminate (optional) — partial-selection dash
│   │       ├─ disabled / colorPalette / size (optional)
│   │       └─ fillColor / checkColor / borderColor (optional) — slot colours
│   ├─ <Switch> — form on/off toggle (binds a boolean)
│   │   └─ Props:
│   │       ├─ checked (required) — current state
│   │       ├─ onChange (optional) — fn(Boolean) => Null
│   │       ├─ label / disabled / colorPalette / size (optional)
│   │       └─ onColor / offColor / thumbColor (optional) — track + knob colours
│   ├─ <Slider> — range slider
│   │   └─ Props:
│   │       ├─ value (required) — current value
│   │       ├─ onChange (optional) — fires during drag; onChangeEnd (optional) — fires on release
│   │       ├─ min / max / step (optional) — range (defaults 0–100)
│   │       ├─ orientation / variant / colorPalette / size / disabled (optional)
│   │       └─ trackColor / fillColor / thumbColor / markColor (optional) — slot colours
│   ├─ <RadioGroup> — single-select radio list
│   │   └─ Props:
│   │       ├─ value (required) — selected value ("" = none)
│   │       ├─ items (required) — [{ value, label?, disabled? }]
│   │       ├─ onChange (optional) — fn(String) => Null
│   │       ├─ orientation / name / disabled / required / colorPalette / size (optional)
│   │       └─ color / fillColor / borderColor (optional) — ink + radio colours
│   ├─ <RadioCardGroup> — radios rendered as picker cards
│   │   └─ Props:
│   │       ├─ value (required) — selected card value
│   │       ├─ items (required) — [{ value, label, description?, disabled? }]
│   │       ├─ onChange (optional) — fn(String) => Null
│   │       ├─ orientation / name / disabled / required / colorPalette / size (optional)
│   │       └─ color / descriptionColor / cardBackground / selectedCardBackground / selectedBorderColor (optional)
│   ├─ <TagsInput> — typeahead chip input
│   │   └─ Props:
│   │       ├─ defaultValue (optional) — initial tags
│   │       ├─ onChange (optional) — fn(Array<String>) => Null with the new tag set
│   │       ├─ suggestions (optional) — autocomplete list (free entry still allowed)
│   │       ├─ max / maxLength / allowOverflow (optional) — tag-count / length constraints
│   │       ├─ editable / delimiter / addOnPaste / blurBehavior (optional) — editing behaviours
│   │       ├─ onInputChange / onHighlightChange (optional) — typing + highlight callbacks
│   │       ├─ label / placeholder / disabled / readOnly / invalid (optional) — chrome + state
│   │       ├─ variant / size / colorPalette (optional)
│   │       └─ tagBackground / tagColor / tagBorderColor + COLOR overrides (optional) — per-chip colours
│   ├─ <FileUpload> — drop-zone file picker
│   │   └─ Props:
│   │       ├─ onFileAccept (optional) — fn(files) => Null; onFileReject (optional) — fn(rejections) => Null
│   │       ├─ accept / maxFiles / maxFileSize / minFileSize (optional) — acceptance constraints
│   │       ├─ directory / allowDrop / capture (optional) — folder upload, drag-drop, mobile camera
│   │       ├─ label / dropzoneText / triggerText / orientation (optional) — copy + layout
│   │       ├─ disabled / required / name (optional) — form state
│   │       └─ variant / size / dropzoneBackground / dropzoneBorderColor / activeBackground + COLOR overrides (optional)
│   ├─ <Field> — form-field wrapper (label + control + helper/error)
│   │   └─ Props:
│   │       ├─ label (required) — the field caption; children (required) — the control
│   │       ├─ helperText / errorText (optional) — descriptive + validation lines
│   │       ├─ required / disabled / invalid / readOnly (optional) — form state
│   │       ├─ orientation (optional) — label/control layout
│   │       └─ labelColor / helperTextColor / errorColor / warningColor / infoColor / requiredIndicatorColor (optional)
│   ├─ <DateRangeInput> — start–end date pair with preset chips
│   │   └─ Props:
│   │       ├─ startValue / endValue (required) — the range (UTC DateTime pair)
│   │       ├─ onChange (optional) — fn(start, end) => Null
│   │       ├─ min / max / precision (optional) — bounds + picker precision (date|minute|second)
│   │       ├─ presets (optional) — [{ label, start, end }] preset rows above the inputs
│   │       ├─ disabled (optional)
│   │       └─ variant / size / focusBorderColor + COLOR overrides (optional)
│   └─ <TimeRangeInput> — start–end time pair (minutes since midnight)
│       └─ Props:
│           ├─ startValue / endValue (required) — minutes 0–1439
│           ├─ onChange (optional) — fn(startMin, endMin) => Null
│           ├─ min / max / step (optional) — bounds + picker step (default 15)
│           ├─ presets (optional) — [{ label, start, end }]
│           ├─ disabled (optional)
│           └─ variant / size / focusBorderColor + COLOR overrides (optional)
│
├─ Collections (display data sets) — structured data on `data=` / `columns=` / `items=` props
│   ├─ <Table data={rows} columns={…} /> — sortable / pinnable / virtualized data grid; generic pass-through (column/cell inference preserved)
│   │   ├─ Props:
│   │   │   ├─ data (required) — array of row structs
│   │   │   ├─ columns (required) — keyed config: ["a","b"] or { a: { header, width, value?, render?, aggregate?, aggregateRender?, … } }; column `render` is an East fn ({rowIndex, columnKey, cellValue} → UIComponent) called per VISIBLE cell — full-row access = capture the data array + index it (($, ctx) => { const row = $.let(rows.get(ctx.rowIndex)); … }); render/on* fns may capture only data + bind-handles — never a UIComponentType value (beast2 can't serialize it)
│   │   │   ├─ groupBy (optional) — [accessor | { value, collapsed? }] nested collapsible group header rows (#317); groups keep first-appearance DATA order (never alphabetized), sort is group-scoped; columns with aggregate:"sum"|"mean"|"min"|"max"|"count" show subtotals ON the group row (a collapsed group reads as its subtotal line); aggregateRender formats them (East fn over the aggregated cell value — a group row has no rowIndex); grand totals stay in footerRows
│   │   │   ├─ columnGroups (optional) — column-group heading row (type-checked columnKeys)
│   │   │   ├─ footer / footerRows (optional) — one / many footer rows, keys narrowed to the table's columns
│   │   │   ├─ expandedContent (optional) — fn(rowIndex) => UIComponent expandable row detail (UNSLICED row index — stable under sorting AND pagination)
│   │   │   ├─ frozen (optional) — column keys pinned left (visible during horizontal scroll)
│   │   │   ├─ height / maxHeight (optional) — uniform sizing (#320): pin or cap the table; chrome-inclusive, rows scroll within
│   │   │   ├─ variant / size / striped / interactive / stickyHeader / showColumnBorder (optional) — grid chrome
│   │   │   ├─ density (optional) — row rhythm preset; rowHeight (optional) — explicit px override (fed to the virtualizer)
│   │   │   ├─ virtualization / columnResize (optional) — row virtualization + header drag-resize
│   │   │   ├─ selection (optional) — { mode, selected, onChange } embedded row-selection state
│   │   │   ├─ pagination (optional) — { pageSize, page, onPageChange } embedded pager
│   │   │   ├─ onCellClick / onCellDoubleClick / onRowClick / onRowDoubleClick / onRowSelectionChange / onSortChange (optional) — interaction callbacks
│   │   │   ├─ rowStatus (optional) — fn(rowIndex) => StatusToken row tint (see the Statuses branch)
│   │   │   ├─ review / reviewStatus / reviewApproval (optional) — pinned-right Decision column + commitBar foot BELOW the pager; rowIndex is the UNSLICED index
│   │   │   ├─ slice + affordances (optional) — bound slice chrome (default ["filter","search"]); filtering flows through the slice interface
│   │   │   ├─ plotGutter (optional) — shared plot gutter (#147); frozen columns fill `left` (usually supplied by <AlignedStack>)
│   │   │   └─ colorPalette + headerBackground / headerColor / zebraBackground / hoverBackground / selectedBackground / selectedBorderColor / footerBackground / borderColor (optional) — chrome colours
│   │   └─ Factories: (columns/footers are plain config objects; no builders)
│   ├─ <DataList items={…} /> — label/value pairs
│   │   └─ Props:
│   │       ├─ items (required) — [{ label: String, value: UIComponent }] (plain structs — no builder needed)
│   │       ├─ orientation / size / variant (optional) — pair layout + chrome
│   │       └─ labelColor / valueColor / background / borderColor (optional)
│   ├─ <TreeView nodes={…} /> — expandable hierarchical tree with selection
│   │   ├─ Props:
│   │   │   ├─ nodes (required) — array of TreeView.Item / TreeView.Branch values
│   │   │   ├─ selectionMode (optional) — selection cardinality
│   │   │   ├─ defaultExpandedValue / defaultSelectedValue (optional) — initial expansion / selection
│   │   │   ├─ onExpandedChange / onSelectionChange / onFocusChange (optional) — interaction callbacks
│   │   │   ├─ size / variant / animateContent / label (optional) — chrome
│   │   │   └─ itemColor / itemHoverBackground / selectedBackground / selectedColor / caretColor / connectorColor (optional)
│   │   └─ Factories:
│   │       ├─ TreeView.Item(value, label, indicator?) — leaf node (indicator = FA icon + style)
│   │       └─ TreeView.Branch(value, label, children, indicator?, disabled?) — expandable node
│   ├─ <Gantt data={rows} columns={…} rowSpec={row => ({ tasks: … })} /> — table + time-bar timeline
│   │   ├─ Props:
│   │   │   ├─ data / columns (required) — the left table (same column config family as <Table>); frozen (optional) pins keys left
│   │   │   ├─ rowSpec (required) — per-row accessor returning { tasks?: [Gantt.Task(…)], milestones?: [Gantt.Milestone(…)], status?, approval? } (status/approval feed the Decision column — only rendered when `review` is set)
│   │   │   ├─ axis (optional) — { range?: {min,max}, format?: date pattern ("MMM YYYY"), tier?: header granularity } — omit to fit the domain to the data
│   │   │   ├─ showToday (optional) — the now-line
│   │   │   ├─ dragStep / durationStep (optional) — drag / resize snapping steps
│   │   │   ├─ height / maxHeight (optional) — uniform sizing (#320)
│   │   │   ├─ variant / size / striped / stickyHeader / showColumnBorder (optional) — table chrome
│   │   │   ├─ density / rowHeight (optional) — rhythm (rowHeight overrides, flows to virtualizer + bars)
│   │   │   ├─ rowStatus (optional) — fn(rowIndex) => StatusToken row tint
│   │   │   ├─ review (optional) — shared Decision column + commitBar foot ({rowIndex} events, identical to Planner's)
│   │   │   ├─ onCellClick / onCellDoubleClick / onRowClick / onRowDoubleClick / onSortChange (optional) — table callbacks
│   │   │   ├─ onTaskClick / onTaskDoubleClick / onTaskProgressChange / onMilestoneClick / onMilestoneDoubleClick (optional) — timeline callbacks
│   │   │   ├─ id + sources + onDrag + canDrop (optional) — DnD target (ONE grammar funnel: Library `add` lands proposed(added) bars at the dragStep-snapped instant; task-body drags = `move`, edge drags = `resize`; row = row index key, slot = snapped ISO instant, event = t<i>/m<i>) + canDrop veto (⊘, pointer-resolved); progress-handle drag stays bespoke (onTaskProgressChange — not a spatial drag)
│   │   │   ├─ slice + affordances (optional) — bound slice chrome (default ["filter","search","range"]; the timeline header doubles as a brush)
│   │   │   └─ plotGutter (optional) — shared gutter (#147); frozen table columns fill `left`
│   │   └─ Factories:
│   │       ├─ Gantt.Task({ start, end, label?, progress?, state?, status?, popover? }) — one bar; `state` is the SHARED lifecycle (PlannerStateType via Gantt.Types.State: "committed"|"added"|"model"|"removed"|"rejected" — committed solid, proposals dashed/ghost/struck, rejected greyed; only proposed bars drag/resize); `status` is the orthogonal risk tint (Gantt.Types.Status — "danger" = the old atRisk); popover = click-triggered rich body
│   │       └─ Gantt.Milestone({ date, label?, kind?, popover? }) — diamond marker; kind: interim (amber) | release (brand teal, default)
│   ├─ <Planner.Point …> / <Planner.Span …> — discrete rows × ordered-slot scheduler (Point = instant events, Span = ranges)
│   │   ├─ Props:
│   │   │   ├─ data (required) — row structs; axis (required) — a Planner.axis.* declaration
│   │   │   ├─ columns (required) — [{ key, header?, width?, frozen?, align?, value, sublabel? }] left-side columns (value/sublabel are row accessors)
│   │   │   ├─ events (required) — per-row accessor returning Planner.event(…) values
│   │   │   ├─ markers (optional) — per-row accessor returning Planner.marker(…) values
│   │   │   ├─ groupBy (optional) — per-row group-head label accessor
│   │   │   ├─ now (optional) — explicit committed/proposed divider slot
│   │   │   ├─ height (optional) — pin the plan area (header pinned, body scrolls, like Table stickyHeader); maxHeight (optional) — cap; absent ⇒ content-sized; slotMinWidth (optional) — drives horizontal slot scroll
│   │   │   ├─ density (optional) — row/header rhythm
│   │   │   ├─ status / approval + review (optional) — per-row Approve/Reject Decision column + commitBar batch foot (clean ⇒ approved, flagged ⇒ pending via deriveApproval; {rowIndex} events)
│   │   │   ├─ onSelectRow / rowHover (optional) — selection callback + row hover affordance
│   │   │   ├─ id + sources + onDrag + canDrop (optional) — opt-in DnD target (#269): a Planner without onDrag is exactly click-only; PROPOSED tiles drag (committed history inert; tiles need an authored event key), drops land proposed(added); slot keys compose the bucket in ("wed" / "wed:am"); Span edges resize via the shared runtime
│   │   │   └─ plotGutter (optional) — shared gutter (#147); frozen channel columns fill `left`
│   │   └─ Factories:
│   │       ├─ Planner.axis.time({ resolution?, format?, range?, buckets? }) — calendar axis (#309): resolution "hour"|"day"|"week"|"month"|"quarter"|"year" sets the column unit; omitted, a PINNED range ≤ 14 days infers day columns (else month). A pinned range is half-open [min, max), interpreted in UTC (#326 — East DateTime is a UTC instant, so columns are timezone-independent) and authoritative (events outside are culled, never grow the axis). {Mar 30 … Apr 6} at day resolution = Mon 30 … Sun 05, and a sibling Chart pinning the same [min, max] time domain lines its day ticks up cell-for-cell under an AlignedStack gutter. format uses the Chart date tokens ("ddd DD" → Mon 30, in UTC); day default "ddd DD". Drag slot keys stay period-start ISO instants
│   │       ├─ Planner.axis.number({ range?, buckets?, format? }) — numeric slot axis
│   │       ├─ Planner.axis.ordinal({ range?, buckets?, format? }) — explicit ordered slot list
│   │       ├─ Planner.event({ key?, slot, endSlot?, bucket?, label, state, popover?, hovercard?, stretch?, content?, tone?, colorPalette?, color?, animation? }) — one tile; state = audit lifecycle ("committed"|"added"|"model"|"removed"|"rejected"); tone = semantic status tint; popover/hovercard = rich click / hover bodies
│   │       └─ Planner.marker({ slot, status?, message }) — cell status ring (status defaults "danger"; message surfaces as tooltip)
│   ├─ <Matrix data={…} columns={…} cell={(r, col) => Matrix.cell({…})} /> — rows × columns of status-coloured segment bars
│   │   ├─ Props:
│   │   │   ├─ data (required) — row structs; columns (required) — array of Matrix.column(…) (data-drivable with .map)
│   │   │   ├─ cell (required) — (row, column) => Matrix.cell(…) builder
│   │   │   ├─ rowHeader (optional) — header label for the left identity column
│   │   │   ├─ orientation (optional) — default segment orientation
│   │   │   └─ legend (optional) — explicit legend entries [{ fill, label }] (omitted ⇒ auto-derived)
│   │   └─ Factories:
│   │       ├─ Matrix.column({ key, label? }) — one x-axis column
│   │       ├─ Matrix.cell({ segments?, markers?, orientation?, slot?, popover? }) — one cell (slot = arbitrary UIComponent; popover = click body)
│   │       ├─ Matrix.segment({ fill?, weight, label?, color?, min?, max?, step? }) — one segment of the cell bar
│   │       └─ Matrix.marker({ status?, message, at?, label? }) — corner status marker
│   ├─ <Calendar data={days} cell={d => ({…})} /> — day-of-week × week HEATMAP (8-step teal ramp, theme-aware; cols always Mon–Sun); viz-only (no events / drag). Hover cross-highlights the row + column; click selects (footer + onSelect)
│   │   ├─ Props:
│   │   │   ├─ data (required) — day rows; cell (optional) — row mapper to { week, day, value, text?, compare?, summary? } (omit when data is already Calendar.Types.Cell). `compare` is the footer baseline (e.g. last year) → drives the delta chip
│   │   │   ├─ values (optional) — print the number in each cell (default true; false = pure heat read)
│   │   │   ├─ scale (optional) — Calendar.scale({…}) heatmap ramp / bucket count
│   │   │   ├─ domain (optional) — explicit intensity { min, max } (default observed)
│   │   │   ├─ totals (optional) — Calendar.totals({…}) the Σ-wk rail (per-WEEK aggregation)
│   │   │   ├─ aggregateRow (optional) — Calendar.aggregateRow({…}) the trailing row (per-WEEKDAY aggregation, e.g. mean)
│   │   │   ├─ footer (optional) — Calendar.footer({…}) the selection footer (value / compare / delta chip + gradient legend)
│   │   │   ├─ actionLabel + onAction (optional) — footer drill affordance (receives the selected cell)
│   │   │   ├─ onSelect (optional) — cell-click callback
│   │   │   ├─ density / height / maxHeight (optional) — rhythm (comfortable=large / compact / condensed=tight) + uniform sizing (#320)
│   │   │   └─ plotGutter (optional) — shared gutter (#147); `left` = the week-label column (drops the totals/mean/footer chrome to keep the day axis aligned)
│   │   └─ Factories:
│   │       ├─ Calendar.scale({ ramp?, steps? }) — heatmap colour scale (ramp = low→high CSS colours, absent = default teal ramp; steps = bucket count)
│   │       ├─ Calendar.totals({ aggregate?, label?, bar? }) — the weekly rail (aggregate sum/mean/min/max/count — SAME vocabulary as Table; label "Σ wk"; bar = proportion bar)
│   │       ├─ Calendar.aggregateRow({ aggregate?, label? }) — the per-weekday row (aggregate default "mean", label "mean")
│   │       └─ Calendar.footer({ valueLabel?, compareLabel?, legend? }) — selection footer labels + the low→high gradient legend (legend: true | { low, high })
│   ├─ <Schematic items={rows} extent={{width,height}} item={r => ({…})} /> — 2D world-coord canvas: items / zones / links / nets from flat tables
│   │   ├─ Props:
│   │   │   ├─ items + extent (required) — item rows + world bounds (canvas scales to fit)
│   │   │   ├─ item (optional) — row mapper to { key, x, y, label, sublabel?, icon?, status?, meter?{value,max}, metric?, width?, footprint?, tone?, color?, bg?, fillOpacity?, weight?, excluded?, layer? } (omit when already Schematic.Types.Item)
│   │   │   ├─ zones + zone (optional) — zone rows + mapper to { key, label, x, y, width, height, pattern?, geometry?, tone?, color?, bg?, fillOpacity?, weight?, layer? }
│   │   │   ├─ links + link (optional) — link rows + mapper to { key, from, to, label?, metric?, style?, route?, via?, layer? }
│   │   │   ├─ nets + net (optional) — manifold/bus rows (ONE row = many sources → many destinations) + mapper to { key, sources, destinations, label?, metric?, style?, route?, via?, layer? }; drawn P&ID-style — a header BAR spans each multi-endpoint side with a stub per endpoint, the trunk runs bar → via… → bar (junction dots ONLY where a tap 3-way joins a bar)
│   │   │   ├─ selectionMode (optional) — "single" (default) | "multiple" | "range"; multiple ⇒ marquee tool (drag-box multi-select w/ live preview + count; plain box/tap replaces, Shift extends)
│   │   │   ├─ onSelect / onSelectionChange (optional) — item click (key) / full selection-set events ({key?, selected, selectedKeys, additive, region?}); works in every tool (grab/zoom/marquee)
│   │   │   ├─ onSelectZone / onZoneSelectionChange (optional) — zone click-select (items win hit-test; innermost zone wins; Shift extends) reporting the zones AND their childItemKeys
│   │   │   ├─ selectZoomFocus (optional) — a canvas selection also moves the camera (tap flies, marquee fits)
│   │   │   ├─ onItemOpen (optional) — double-click drill-in (background double-click keeps Fit/reset)
│   │   │   ├─ onViewportChange (optional) — debounced viewport-settled reporting ({zoom, minX, minY, maxX, maxY}) for sync / lazy-load / persist
│   │   │   ├─ linkMode (optional) — connect-gesture mode: "draw" (adds locally, form-input style) | "connect" (event-only, repeatable: plan operations); Shift+drag ADDS to the session
│   │   │   ├─ onCreateLink / onSelectLink / onEditLink / onDeleteLink (optional) — link lifecycle ({link, links, additive, existing} on create; click-select key; endpoint re-target; Del delete)
│   │   │   ├─ canConnect (optional) — fn(from, to) => Bool vetoes pairs BEFORE they resolve (the draft never snaps; one rule covers links, Shift-session/net extensions, and re-targets; a throwing validator fails OPEN)
│   │   │   ├─ onEditNet (optional) — net membership edits: trunk/bar click selects the WHOLE net, a STUB click selects ONE leg (Del removes just that endpoint; onEditNet reports membership AFTER; a side emptying deletes the whole net via onDeleteLink). Shift-session gestures keep ONE bus (a member never flips sides); with a LINK selected, Shift-drag from its endpoint SEEDS the session with that link (onCreateLink.absorbed lists absorbed keys — delete those rows when upserting); with a NET selected, Shift-drag out of a member adds the target as a leg; a Shift connect-session commits as a net (onCreateLink.net = {key, sources, destinations}, stable session key — upsert by net.key)
│   │   │   ├─ readOnly / readOnlyLinks / readOnlyItems (optional) — flattened per-domain edit gates
│   │   │   ├─ onMoveItem (optional) — move tool (readOnlyItems off): drags items to new positions; a selected item moves the WHOLE selection rigidly, local-first; fires once per gesture ({key, x, y, keys, dx, dy})
│   │   │   ├─ itemHover / zoneHover / linkHover (optional) — East fn key => UIComponent lazy hover cards (charts in a card over a tank / pipe); any camera or edit gesture closes them; hover ignores readOnly + locked layers
│   │   │   ├─ slice + affordances (optional) — bound slice chrome (default ["search"]); flat effect props sliceHidden / sliceOpacity / sliceDesaturate / sliceDot / sliceEmphasis:"halo"|"pulse" / sliceFrame / sliceFrameFit keep filtered-OUT items as ghost/desaturate/dot context + emphasise the remainder instead of hiding — feed the FULL set (Slice.partition) and mark item.excluded (e.g. t.matched.not())
│   │   │   ├─ sliceSelectField (optional) — bound-slice fieldId a marquee/tap selection writes an `in` filter of selected item keys into (one-directional selection→slice) — pair with the ghost effect (not a Slice.rows feed on the same slice)
│   │   │   ├─ layers (optional) — [{ key, label, tone?, visible?, locked?, opacity? }] + tag items/zones/links with layer:"key"; a canvas layer button opens a show/hide/solo/lock panel (persists per panel); lock ⇒ non-selectable (click-through), opacity dims
│   │   │   ├─ scaleUnit / grid / navigator / minimap (optional) — scale bar unit, metric grid (default on), zones→items TOC (default when zones exist), minimap (default 25+ items)
│   │   │   └─ height / maxHeight (optional) — uniform sizing (#320); default aspect-driven, capped 75vh
│   │   └─ Factories:
│   │       ├─ Schematic.circle(r) / .polyline(verts, {width}) / .polygon(verts) / .rect() — item footprints + zone geometry
│   │       ├─ Schematic.outline() / .hatch() — zone boundary patterns
│   │       └─ Schematic.solid() / .dashed() — link / net stroke styles
│   ├─ <Map markers={…} center={Map.at(lat,lng)} zoom={n} /> — interactive geographic basemap; read-only / selection-only
│   │   ├─ Props:
│   │   │   ├─ markers + center + zoom (required) — marker rows + initial camera
│   │   │   ├─ marker / area / line / label (optional) — row mappers for each table (omit when rows are already Map.Types.* values)
│   │   │   ├─ areas / lines / labels (optional) — the additional overlay tables
│   │   │   ├─ hexes (optional) — H3 lattice + per-cell detail (Map.hex(…))
│   │   │   ├─ overlays (optional) — positioned East children (Map.overlay(child, { align }))
│   │   │   ├─ tiles (optional) — basemap (default Map.carto("positron"))
│   │   │   ├─ minZoom / maxZoom / lodZoom / fitBounds (optional) — zoom clamps, detail-LOD threshold, camera framing
│   │   │   ├─ onAreaClick / onMarkerClick / onZoom / onSelect (optional) — interaction callbacks
│   │   │   └─ scrollWheelZoom / attributionPrefix / height (optional) — chrome
│   │   └─ Factories:
│   │       ├─ Map.at(lat, lng) — a coordinate; Map.point(…) / Map.bounds(…) — flyTo targets
│   │       ├─ Map.carto(style) / Map.osm() / Map.tile(url, …) — basemaps
│   │       ├─ Map.hexDisk(…) / Map.cells(…) / Map.polygon(…) — H3 shapes; Map.hex(…) — the hex layer
│   │       ├─ Map.marker(…) / Map.area(…) / Map.line(…) / Map.label(…) — overlay values
│   │       ├─ Map.solid() / Map.dashed() — line styles
│   │       └─ Map.overlay(child, { align }) — a positioned East child
│   ├─ <Library id="people" data={rows} item={r => ({…})} /> — draggable palette (DnD source; targets list its id in their `sources`)
│   │   ├─ Props:
│   │   │   ├─ id (required) — DnD source identity
│   │   │   ├─ data (required) — item rows
│   │   │   ├─ item (required) — row mapper to { key, label, sublabel?, icon?, status?, draggable?, filtered? }
│   │   │   ├─ hint (optional) — header-right caption (absent ⇒ no header band)
│   │   │   ├─ dimensions + defaultDimensions (optional) — toolbar-toggleable card facts ({ kind: "meter" | "chips" | "text", … }); initially-visible keys (default first two)
│   │   │   ├─ groupBy (optional) — [{ key, label, value, summary? }] GROUP BY options (omit for flat)
│   │   │   ├─ search (optional) — filter-text accessor; unmatched cards hide (footer shows hidden count + Show all)
│   │   │   ├─ addLabel + onAdd (optional) — footer action
│   │   │   ├─ slice + affordances (optional) — bound slice chrome (default ["filter","search"])
│   │   │   └─ style (optional) — { height, maxHeight, virtualization }
│   │   └─ Factories:
│   │       └─ Library.status(label, tone) — a card status chip (tone = a status token; see the Statuses branch)
│   ├─ <Deck data={rows} statuses={Deck.statuses({…})} card={r => ({ key, title, status, metrics, fill })} /> — grouped mini-card board (display, NOT a drag source — that's Library); every card carries an EXPLICIT status colour from the deck's STATUS REGISTRY (solid tag + dot, faint face wash, fill-bar colour); two card states: the LIST face + a VIEW state in an anchored POPOVER CARD whose head is inherited from the face
│   │   ├─ Props:
│   │   │   ├─ data (required) — array of rows to project into cards
│   │   │   ├─ card (required) — accessor r => face fields: key (required; identity reported by onCardClick/onOpen) · title (required; identity line) · sublabel (muted mono-uppercase second line) · icon (FA solid name) · status (a KEY into `statuses` — paints the tag/wash/fill) · metrics ([Deck.metric(…)] raw-value strip) · fill ({ value, max, format? } status-coloured bar; format = shared spec over value OR (value, max) => String accessor; omitted → percentage) · facts ([Deck.meter/chips/text(…)]) · filtered (render dimmed — the Slice.partition "keep the excluded" feed)
│   │   │   ├─ statuses (optional) — the status registry, Deck.statuses({…}); card `status` fields reference entries by key
│   │   │   ├─ groupBy (optional) — [{ key, label, value, summary? }] named GROUP BY toolbar + None; grouping by the status accessor decorates group heads with the registry swatch + hint
│   │   │   ├─ layout (optional) — "grid" (default; wrap auto-fill minmax(minCardWidth,1fr) → one phone column) | "list" (full-width rows)
│   │   │   ├─ onClick (optional) — r => <…/> the STICKY popover's BODY (tap opens; Esc / outside / × close); the head — title, sublabel, icon, status tag + wash — is INHERITED from the card face
│   │   │   ├─ onHover (optional) — r => <…/> the transient hover peek's body (hover-capable pointers only, intent-delayed)
│   │   │   ├─ onOpen (optional) — fn(key) => Null; fires when a card's popover opens
│   │   │   ├─ onClose (optional) — fn() => Null; fires once per popover close (Esc / outside / ×)
│   │   │   ├─ onCardClick (optional) — fn(key) => Null; cards are tap targets even without popover content
│   │   │   ├─ render (optional) — r => <…/> fully custom card body beneath the structured face
│   │   │   ├─ footer (optional) — [{ label, value }] board-foot key/value stats
│   │   │   ├─ legend (optional) — boolean; renders the registry legend (swatch + label + hint)
│   │   │   ├─ slice + affordances (optional) — slice={handle} + affordances (default ["filter","search"] — brush/legend/breakdown rejected) mounts the rail + count footer; feed data via Slice.rows (remove) or Slice.partition → filtered (dim); filtering/search flow through the slice interface like Table — no bespoke search
│   │   │   └─ style (optional) — { height, maxHeight, minCardWidth, virtualization }; height/maxHeight make the board its own (virtualized) scroll region, flat AND grouped
│   │   └─ Factories:
│   │       ├─ Deck.statuses({ key: { label, color, pulse?, hint? } }) — build the status registry; color is a standard status token "success"|"warning"|"danger"|"info"|"neutral" OR any custom CSS colour (the faint face tint is derived); pulse animates the tag dot (active states); hint feeds the legend + group heads
│   │       ├─ Deck.metric(label, value, { format?, warn? }) — one metric cell: the RAW Float (or Option Float) value plus a shared format — a Chart.format.* spec or a v => String accessor (same vocabulary as chart axes); a none value renders "—"; warn paints the value in the danger tone
│   │       ├─ Deck.Readout([{ label, value, format?, unit?, warn? }]) — popover readout rail: a bordered grid of big mono values with unit suffixes (raw values + shared format, like Deck.metric)
│   │       ├─ Deck.Rows([{ label, value }]) — popover key/value detail rows (mono-uppercase keys, body-voice values)
│   │       ├─ Deck.Note(text) — popover dashed-top mono footnote
│   │       ├─ Deck.meter(label, value, max, text) — card-face meter fact (utilisation bar + right-aligned reading)
│   │       ├─ Deck.chips(label, values) — card-face chip-set fact
│   │       └─ Deck.text(label, text) — card-face dim text fact
│   ├─ <ValueTree value={anyEastValue} /> — editable tree of ANY East value, materialized from its STATIC type at authoring time (structs/arrays/dicts/options/variants → branches; primitives → typed editable leaves; sets/blobs/vectors/matrices/refs/fns → read-only summaries; non-string-keyed dicts browsable read-only)
│   │   ├─ Props:
│   │   │   ├─ value (required) — the East value to render; omit every callback for a read-only inspector
│   │   │   ├─ onUpdate (optional) — fn([T], Null) whole-value handler: receives the WHOLE value with the edit applied (the factory rebuilds it for you); sync or async
│   │   │   ├─ at (optional) — [ValueTree.at(T, probe, fn)] scoped subtree handlers; deepest matching scope wins, unmatched edits bubble to onUpdate
│   │   │   ├─ onEdit (optional) — RAW path callback (escape hatch; overrides per event): fn(path, leaf) => Null leaf edit
│   │   │   ├─ onInsert (optional) — RAW append/insert: array append paths end with an `append` step, dict adds carry the new `key`
│   │   │   ├─ onRemove (optional) — RAW remove with the element/entry path
│   │   │   ├─ onTag (optional) — RAW variant switch + option set/clear ("some"/"none")
│   │   │   └─ style (optional) — { height, maxHeight }; bounded trees virtualize rows
│   │   └─ Factories:
│   │       ├─ ValueTree.at(T, p => p.machines.entry("m1"), fn([SubT], Null)) — a typed scope: struct fields as properties, .item(i), .entry(k), .some()
│   │       ├─ ValueTree.zero(T) — the default element for inserts (delegates to East defaultValue)
│   │       └─ ValueTree.Types.{Root, Node, Path, Step, Leaf, Style} — the East types for RAW callbacks
│   ├─ <Roster people={…} shifts={…} id person={…} shift={…} /> — people × days-of-week shift grid; joins the two flat tables by person key
│   │   └─ Props:
│   │       ├─ people + shifts + id (required) — the two tables + DnD target identity
│   │       ├─ person (optional) — row mapper to { key, label, sublabel? } (omit when already Roster.Types.Person)
│   │       ├─ shift (optional) — row mapper to { key, person, day, hours|label, state } (state is a PlannerStateType — Roster.Types.State)
│   │       ├─ mode (optional) — published (default) | edit
│   │       ├─ days (optional) — day columns in order (default Mon–Sun)
│   │       ├─ personHeader / personWidth (optional) — frozen column header (default "Operator") + CSS width (default 150px)
│   │       ├─ sources + onDrag + canDrop (optional) — DnD target (add/move/remove funnel); canDrop = fn(DragEvent) => Bool IR veto (⊘ over vetoed cells); a remove-capable drag raises the shared trash sink (drop = remove/trash)
│   │       ├─ onSelect / onAccept / onAddAt (optional) — cell click / ghost-shift accept / empty-cell add (CellRef payloads); granularity contract: onAccept(CellRef) resolves ONE ghost, review.onApprove({rowIndex}) signs off the LINE (interplay host-owned)
│   │       ├─ review (optional) — row-level Decision column + foot (+ person status/approval fields)
│   │       ├─ summary (optional) — status-strip text (dirty / ghost counts)
│   │       └─ density / height / maxHeight (optional) — rhythm + uniform sizing (#320)
│   ├─ <Board areas={…} shifts={…} people={…} assignments={…} id … /> — single-day areas × shifts assignment grid; cells stack MULTIPLE person chips, faces joined to people by person key
│   │   └─ Props:
│   │       ├─ areas + shifts + people + assignments + id (required) — the four tables + DnD target identity
│   │       ├─ area / shift / person (optional) — entity row mappers to { key, label, sublabel? }
│   │       ├─ assignment (optional) — row mapper to { key, person, area, shift, state }
│   │       ├─ requirements + requirement (optional) — coverage rows + mapper to { area, shift, required } (n/required numerals + ⊕ open-slot placeholders, under/over tones)
│   │       ├─ mode (optional) — published (default) | edit
│   │       ├─ areaHeader / areaWidth (optional) — frozen column header (omit = blank; zero baked copy) + CSS width (default 150px)
│   │       ├─ maxVisible (optional) — per-cell chip cap before the +N overflow popover
│   │       ├─ sources + onDrag + canDrop (optional) — DnD target (add/move/remove); canDrop = fn(DragEvent) => Bool veto (⊘ while dragging; duplicate-person guard stays built in)
│   │       ├─ canAssign (optional) — DEPRECATED sugar fn(person, area, shift) => Bool the factory compiles into canDrop
│   │       ├─ onSelect / onAccept / onAddAt (optional) — cell click / ghost accept / open-slot click (CellRef payloads)
│   │       ├─ review (optional) — { summary?, onApproveAll, onRejectAll, onRerun? } batch commitBar foot only (per-row fields unused in v1, the factory warns); ghost onAccept unchanged
│   │       ├─ summary (optional) — status-strip text (open / proposed counts); toolbar chrome is page composition
│   │       └─ density / height / maxHeight (optional) — rhythm + uniform sizing (#320)
│   ├─ <Blend targets={…} config={{…}} /> — blend / batch assembly surface; pairs with a Library; target count picks the mode: 1 single | 2 compare (derived diff / Δ table) | 3+ portfolio
│   │   ├─ Props:
│   │   │   ├─ targets + id (required) — target rows + DnD target identity
│   │   │   ├─ target (optional) — row mapper to Blend target fields (omit when already Blend.Types.Target)
│   │   │   ├─ sources (optional) — Library ids accepted for add-drops
│   │   │   ├─ diff (optional) — compare mode: metric keys for the foot table (default all); verdict (optional) — compare verdict line
│   │   │   ├─ onDrag + canDrop (optional) — add/remove drag funnel + IR drop veto (⊘)
│   │   │   ├─ onAmountChange (optional) — allocation amount edits
│   │   │   └─ onAction (optional) — panel actions; the action foot rides the shared commitBar (Apply = approve-primary, Discard = reject-danger, Reset plain — apply/discard are the panel-scope review verbs)
│   │   └─ Factories:
│   │       ├─ Blend.allocation({ source, amount, pinned?, state? }) — one allocation line
│   │       └─ Blend.metric({ key, label, value, numeric?, model?, band? }) — one target metric
│   ├─ <Slice.Rail slice={slice} affordances={[…]} /> — shared narrowing chrome over one bound dataset; feed consumers via Slice.rows
│   │   ├─ Props:
│   │   │   ├─ slice (required) — the bound handle from Slice.bind
│   │   │   ├─ affordances (optional) — ["filter","search","range","breakdown","cohort","presets","brush","legend"]; legends are explicit-only (list "legend" or compose <Slice.Legend>)
│   │   │   ├─ persist (optional) — "local" | "session" | "url" opts the state into reload-surviving / shareable-link storage
│   │   │   └─ brush (optional) — the brush strip is rich by default (the range field's format drives the axis labels; a self-excluding count histogram shows the row distribution); brush={{ axis?, count?, buckets? }} opts down to the bare track. The applied window is a full brush selection: drag its body to slide (width preserved), an edge to resize, empty track to draw (also on the Gantt timeline header)
│   │   ├─ Nested tags: <Slice.Filter/Search/Range/Breakdown/Legend/Cohort/Presets/Summary slice={slice} /> — per-affordance chrome; <Slice.Cohort mode="toggle"|"manage" allowCreate?> (cohorts toggle on chip click; <Slice.Presets> = toggle-only preset bar); <Slice.Legend> = facet bar (click = in-set multi-select over self-excluding slice.facetGroups(); mode="visibility" = eye rail); Summary/Filter footers read "N of M"
│   │   └─ Factories:
│   │       ├─ Slice.bind([Row], key, config, initialState, data, searchMatcher?) — bind a dataset to a slice key (searchMatcher = optional Option of a per-row match fn; pass `none` for the config-driven default)
│   │       ├─ Slice.config(Row, { fields, rangeFieldId?, searchFieldIds?, breakdownFieldIds? }) — fields: { id: { label, hints?, format? } }; format reuses the shared Chart.format vocabulary (see the Formats branch)
│   │       ├─ Slice.state({…}) — the initial slice state
│   │       ├─ Slice.rows([Row], slice) — the narrowed feed (excluded rows gone)
│   │       ├─ Slice.partition([Row], slice) — the FULL set tagged [{value, matched}] (the "keep the excluded" feed — drive a de-emphasis effect from `matched`)
│   │       ├─ Slice.apply.where / .matches / .breakdown — the pure filter engine (string ops eq/neq/in/notIn/contains/matches/startsWith/endsWith/isEmpty/isNotEmpty; integer in; datetime between)
│   │       └─ slice.toggleFilter(pred) — idempotent single-predicate toggle for custom wiring; Range picker presets anchor to the DATA's date extent (clamped to now for live data) and pin concrete windows; an All chip clears the range; programmatic datetimePreset seeds stay rolling/wall-clock
│   └─ <Pagination> — page-number control
│       └─ Props:
│           ├─ page / pageSize / count (required) — current page, rows per page, total rows
│           ├─ onPageChange (required) — fn(newPage) => Null
│           ├─ siblings / boundaries (optional) — ellipsis control
│           └─ size / variant / activeBackground / activeColor + COLOR overrides (optional)
│
├─ Charts (visualize data) — layers are a config array of factory values, never child tags
│   ├─ <Chart layers={…} /> — assemble mark + annotation layers; x-scale inferred from the x accessor type (String → band, number → linear, DateTime → time)
│   │   ├─ Props:
│   │   │   ├─ layers (required) — array of Chart.Line/Column/Bar/Area/Scatter/Band/refLine/refBand/refDot/Series values
│   │   │   ├─ x / y / y2 (optional) — axis options: { label?, format? (shared spec — see the Formats branch), domain?, scale?, numTicks?, tickValues?, hideTicks?, hideLine?, tickStyle?, titleStyle?, titleGap? }
│   │   │   │     tickValues (#318): floats on a linear axis ([0,1,2,…] to line up with a Planner) or DateTime[] on a time axis (pin ticks to exact instants, rendered through the date format); Date ticks on y/y2 are a build-time error
│   │   │   │     tickStyle/titleStyle (#315): { fontSize?, fontFamily?: "sans"|"serif"|"mono", fontWeight?, color?, letterSpacing? } — restyle ticks/captions over the spec chrome
│   │   │   │     titleGap (#327): px between ticks and caption — widens that axis's OWN margin band, never the shared AlignedStack gutter, so nudging a title can't shift a stacked plot lane
│   │   │   ├─ height (optional) — px or "fill"; width (optional) — px (omit for responsive)
│   │   │   ├─ grid / legend / tooltip (optional) — background gridlines (default on) / colour-matched legend / hover tooltip
│   │   │   ├─ stackOffset (optional) — "none" | "expand" (percent stacking)
│   │   │   └─ slice + affordances (optional) — bound slice chrome (default ["breakdown","range"]; the brush sets the slice's range)
│   │   └─ Factories:
│   │       ├─ Chart.Line / Chart.Column / Chart.Area / Chart.Scatter(rows, encoding, style?) — marks; encoding: { x, y } · { x, y, by } (split) · { x, columns: { Name: r => r.field } } (wide)
│   │       ├─ Chart.Bar(rows, { x: numeric, y: category }, style?) — HORIZONTAL bars (band y-axis, linear x; flips the whole frame; same { x, y, by } / { y, columns } splits; can't mix with vertical marks)
│   │       ├─ Chart.Band(rows, { x, low, high }, style?) — filled range (e.g. confidence band)
│   │       ├─ mark style (all optional) — { key (legend label), color, curve, width, dash, dots, fillOpacity, opacity, legend, tooltip, stack (group id — layers sharing one stack accumulate), axis: "left"|"right", order (draw order) }; Scatter adds size (uniform px radius; a per-point size accessor overrides)
│   │       ├─ Chart.refLine({ y }|{ x }, label?, dash?) — reference line
│   │       ├─ Chart.refBand({ y: [lo, hi] }|{ x: [lo, hi] }, label?) — reference band
│   │       ├─ Chart.refDot({ x, y, label? }) — reference marker
│   │       ├─ Chart.format.{ number, currency, percent, compact, date, time, datetime } — the SHARED format specs (see the Formats branch)
│   │       └─ Chart.Series(slice, { x, value, mark? }) — a slice-bound layer (x/value are slice field ids; mark: "line"|"bar"|"area"|"scatter", default line)
│   └─ <Sparkline> — inline trend beside a <Stat>
│       └─ Props:
│           ├─ data (required) — the values
│           ├─ type (optional) — line | area
│           └─ color / height / width (optional)
│
├─ Display (show information)
│   ├─ <Badge> — mono uppercase micro-label (status / taxonomy); stays a tier smaller than tags
│   │   └─ Props: variant (solid|subtle|outline) / colorPalette / size / density / borderRadius / borderWidth / borderStyle / justifyContent / alignItems + BOX bag + COLOR overrides (all optional; children required)
│   ├─ <Tag> — operator-set keyword / filter pill (body font)
│   │   └─ Props:
│   │       ├─ children (required) — the tag text
│   │       ├─ closable + onClose (optional) — × affordance + callback
│   │       └─ variant / colorPalette / size / density / borderRadius / borderWidth / borderStyle + BOX bag + COLOR overrides (optional)
│   ├─ <Avatar> / <AvatarGroup> — user avatar / overlapping cluster with "+N more"
│   │   └─ Props:
│   │       ├─ Avatar: src (image URL) / name (initials fallback) / variant / colorPalette / size / density / borderRadius + BOX bag + COLOR overrides (all optional)
│   │       └─ AvatarGroup: children (required) — the avatars; max (optional) — overflow threshold (+N after); size / density / borderColor (optional)
│   ├─ <Image> — raster/vector image or logo
│   │   ├─ Props:
│   │   │   ├─ source (required) — Image.url(u) | Image.dataUri(s) | Image.blob(bytes, "png"|"svg"|…)
│   │   │   ├─ fit (optional) — object-fit: contain | cover | fill | none | scaleDown
│   │   │   ├─ aspectRatio / alt / borderRadius / background (optional) — framing + accessibility
│   │   │   └─ …plus BOX bag
│   │   └─ Factories:
│   │       ├─ Image.url(u) — hosted image
│   │       ├─ Image.dataUri(s) — self-contained base64
│   │       └─ Image.blob(bytes, format) — raw BlobType bytes → revocable object URL
│   ├─ <Icon> — FontAwesome icon
│   │   └─ Props:
│   │       ├─ prefix / name (required) — FA icon identity
│   │       ├─ variant (optional) — solid | regular | light | thin | brands
│   │       ├─ size (optional) — xs…2xl; label (optional) — accessible name
│   │       └─ colorPalette / borderRadius + BOX bag + COLOR overrides (optional)
│   ├─ <Kbd> — keyboard-shortcut chip (⌘ K)
│   │   └─ Props: children (required); variant / size / density / colorPalette / shadowColor + COLOR overrides (optional)
│   ├─ <Stat> — metric tile with label / value / change indicator
│   │   └─ Props:
│   │       ├─ label (required) — metric caption; value (required) — the raw value (Float / Integer / String)
│   │       ├─ format (optional) — a shared Chart.format.* spec over a numeric value (see the Formats branch)
│   │       ├─ helpText (optional) — caption beneath the value
│   │       ├─ baseline / delta / info (optional) — secondary line / change pill / ⓘ ToggleTip trigger (UIComponents)
│   │       ├─ indicator (optional) — "up"|"down"|"flat" or { direction, sentiment?: positive|negative|neutral, icon? }
│   │       ├─ density / size (optional) — rhythm + size preset
│   │       └─ valueColor / labelColor / helpTextColor / indicatorColor (optional)
│   ├─ <MetricChip> — compact mono delta chip
│   │   └─ Props:
│   │       ├─ children (required) — the value text; tone (required) — positive | negative | neutral | info (drives the palette)
│   │       ├─ unit (optional) — suffix ("%", "ms"); icon (optional) — leading icon
│   │       ├─ emphasis (optional) — subtle | solid | outline
│   │       └─ density / size / borderRadius / iconColor + COLOR overrides (optional)
│   ├─ <Meter> — horizontal capacity bar with sentiment colour (never a bare bar — value text on by default)
│   │   └─ Props:
│   │       ├─ value (required) — current value; max (optional) — full-bar value (default 100)
│   │       ├─ tone (optional) — a status token driving the fill (see the Statuses branch)
│   │       ├─ label (optional) — UIComponent beside the bar; showValue (optional) — trailing mono percent (default true)
│   │       └─ density / thickness / borderRadius / fillColor / trackColor / labelColor (optional)
│   ├─ <SegmentedMeter> — multi-segment meter (e.g. decomposed confidence)
│   │   └─ Props:
│   │       ├─ segments (required) — [{ value, tone?, color?, label? }]
│   │       ├─ caption (optional) — UIComponent beside the bar; max (optional) — total reference (default sum)
│   │       ├─ labels (optional) — inside | outside | none
│   │       └─ density / thickness / borderRadius / trackColor / captionColor / labelColor (optional)
│   ├─ <BarStrip> — ranked horizontal-bar list (axis-free; fits inside a <Stat>)
│   │   └─ Props:
│   │       ├─ items (required) — [{ label (UIComponent), value, tone?, color?, trailing? }]
│   │       ├─ showValues (optional) — trailing value text (default true)
│   │       ├─ sort / maxItems (optional) — factory-time sort + row cap
│   │       └─ density / orientation / thickness / borderRadius / trackColor / labelColor / valueColor (optional)
│   ├─ <EditableChip> — chip whose text becomes inline input on click
│   │   └─ Props:
│   │       ├─ children (required) — chip text
│   │       ├─ onClick (optional) — activation callback; trigger (optional) — trailing icon (default chevron)
│   │       └─ disabled / density / size / borderRadius / triggerIconColor + COLOR overrides (optional)
│   ├─ <ChipRail> — horizontal rail of mixed chip-shaped children (<Tag>/<Badge>/<MetricChip>/<Avatar>/…); provides its density to the children
│   │   └─ Props:
│   │       ├─ children (required) — the chips
│   │       ├─ separator (optional) — dot | line; labels (optional) — per-chip labels
│   │       ├─ overflow (optional) — behaviour when the rail can't fit every chip (⋯ menu)
│   │       └─ density / separatorColor / overflowTriggerColor / background (optional)
│   └─ <Trace> — read-only inline heatmap (tracks × steps) with a now-line; sits flush beside a <ChipRail> at the same density in table cells
│       └─ Props:
│           ├─ tracks (required) — [{ name, values }] (heat normalises per track's own min/max)
│           ├─ now (optional) — step index of the now-line; [0, now) measured, [now, end) predicted; omit for measured-only
│           ├─ scale (optional) — heat colour encoding; future (optional) — how predicted steps are distinguished
│           ├─ axis (optional) — per-step labels (ruler at comfortable density, tooltips always)
│           ├─ density / brandColor / nowLineColor / labelWidth (optional) — rhythm + colour + name-gutter width
│           └─ plotGutter (optional) — shared gutter (#147): pins the step lane so a Trace stacked under a Chart lines up (left supersedes labelWidth; usually supplied by <AlignedStack>)
│
├─ Feedback (status & async signals)
│   ├─ <Banner> — page-spanning notice
│   │   └─ Props:
│   │       ├─ status (required) — info | warning | success | error | neutral | change | guard | stale
│   │       ├─ title (required) — string or UIComponent
│   │       ├─ description / actions (optional) — body + trailing actions
│   │       ├─ icon / showIcon (optional) — explicit icon override / hide the paired icon
│   │       ├─ dismissible + onDismiss (optional) — close affordance
│   │       └─ variant / size / iconColor / accentColor + COLOR overrides (optional)
│   ├─ <Status> — dot + uppercase label (no fill)
│   │   └─ Props:
│   │       ├─ label (required) — string or UIComponent
│   │       ├─ value (optional) — success | warning | danger | info | neutral (default neutral; see the Statuses branch)
│   │       ├─ pulsing (optional) — animate the dot
│   │       ├─ icon / showIcon (optional) — icon override / hide
│   │       └─ size / dotColor + COLOR overrides (optional)
│   ├─ <Progress> — linear progress bar
│   │   └─ Props:
│   │       ├─ value (required) — current value
│   │       ├─ min / max (optional) — range (defaults 0–100)
│   │       ├─ indeterminate (optional) — unknown-% mode
│   │       ├─ label / valueText / showValue (optional) — captions
│   │       ├─ estimatedDuration / startedAt (optional) — drive an ETA display
│   │       ├─ tone (optional) — brand | pos | neg (bsys-restricted fill tone)
│   │       └─ variant / size / striped / animated / trackColor / fillColor / labelColor (optional)
│   ├─ <Skeleton> — shimmer placeholder
│   │   └─ Props:
│   │       ├─ shape (required) — text | rect | circle
│   │       ├─ lines (optional) — line count (text shape); count (optional) — repeat in a VStack
│   │       └─ width / height / fontSize / background / shimmerColor (optional)
│   └─ <EmptyState> — zero-data state
│       └─ Props:
│           ├─ title (required) — string or UIComponent
│           ├─ glyph (optional) — spec-preferred mono glyph ("·   ·   ·"; takes precedence over icon)
│           ├─ icon (optional) — FA icon escape hatch
│           ├─ description / actions (optional) — body + action row
│           └─ size / iconColor + COLOR overrides (optional)
│
├─ Disclosure (reveal / switch content) — item metadata is config, not child tags
│   ├─ <Tabs items={…}> — content-panel switcher
│   │   ├─ Props:
│   │   │   ├─ items (required) — array of Tabs.Item(…)
│   │   │   ├─ value / defaultValue (optional) — controlled / initial selected tab
│   │   │   ├─ onValueChange (optional) — fn(String) => Null
│   │   │   ├─ variant (optional) — line | plain; size — sm | md | lg
│   │   │   ├─ orientation / activationMode / fitted / justify (optional) — layout + keyboard behaviour
│   │   │   ├─ lazyMount / unmountOnExit (optional) — panel mount policy
│   │   │   └─ colorPalette / listBackground / indicatorColor / activeTriggerColor / inactiveTriggerColor / contentBackground (optional)
│   │   └─ Factories:
│   │       └─ Tabs.Item(value, title, body, { disabled? }) — one tab
│   ├─ <Accordion items={…}> — single/multi-open sections
│   │   ├─ Props:
│   │   │   ├─ items (required) — array of Accordion.Item(…)
│   │   │   ├─ multiple / collapsible (optional) — allow multiple open / allow all closed
│   │   │   ├─ value / defaultValue / onValueChange (optional) — controlled expansion
│   │   │   └─ variant / size / triggerBackground / triggerHoverBackground / contentBackground + COLOR overrides (optional)
│   │   └─ Factories:
│   │       └─ Accordion.Item(value, trigger, children, { meta?, disabled? }) — one section (meta = right-aligned header caption)
│   ├─ <Carousel> — paginated slide carousel
│   │   └─ Props:
│   │       ├─ children (required) — the slides
│   │       ├─ index / defaultIndex / onIndexChange (optional) — controlled slide position
│   │       ├─ slidesPerView / slidesPerMove / spacing (optional) — layout
│   │       ├─ loop / autoplay / allowMouseDrag (optional) — behaviour
│   │       ├─ showIndicators / showControls (optional) — dots + prev/next chrome
│   │       └─ orientation / padding / indicatorColor / activeIndicatorColor / controlColor / controlBackground (optional)
│   ├─ <Collapsible> — single show/hide section
│   │   └─ Props:
│   │       ├─ trigger (required) — always-visible header (string or UIComponent); children (required) — the body
│   │       ├─ defaultOpen / onOpenChange (optional) — initial state + toggle callback
│   │       └─ triggerColor / contentColor + COLOR overrides (optional)
│   ├─ <SegmentGroup items={…}> — compact single-select mode switcher (no panels)
│   │   ├─ Props:
│   │   │   ├─ value (required) — selected segment; items (required) — array of SegmentGroup.Item(…)
│   │   │   ├─ onChange (optional) — fn(String) => Null
│   │   │   └─ size / colorPalette / orientation / activeBackground / activeColor / inactiveColor + COLOR overrides (optional)
│   │   └─ Factories:
│   │       └─ SegmentGroup.Item(value, label, { disabled? }) — one segment
│   ├─ <OptionList> — keyboard-navigable single-select list (rows + description)
│   │   ├─ Props:
│   │   │   ├─ options (required) — array of OptionList.Option(…)
│   │   │   ├─ selectedId (optional) — currently-selected row; onSelect (optional) — fn(id) => Null
│   │   │   └─ itemColor / itemHoverBackground / selectedBackground / borderColor / impactColor (optional)
│   │   └─ Factories:
│   │       └─ OptionList.Option(id, label, { description?, trailing?, disabled? }) — one row (trailing = e.g. impact chip)
│   ├─ <Story.Root steps={…}> — scroll-driven narrative; prose rail + sticky stage keyframes
│   │   ├─ Props:
│   │   │   ├─ steps (required) — array of Story.Step(…)
│   │   │   ├─ layout (optional) — rail-left | rail-right | stacked
│   │   │   ├─ stepLength (optional) — compact | default | long (scroll runway per step)
│   │   │   ├─ stageHeight / height (optional) — stage sizing
│   │   │   ├─ active / progress (optional) — State.bind bindings for narrative position + within-step scrub
│   │   │   ├─ activeStep (optional) — static override: render one deterministic keyframe by step id
│   │   │   ├─ title (optional) — renders the Story.Progress chrome row
│   │   │   └─ onStepEnter / onStepExit (optional) — step activation callbacks (step id)
│   │   └─ Factories:
│   │       ├─ Story.Step(body, { id, eyebrow?, title?, stage? }) — one beat (stage = its sticky keyframe)
│   │       └─ Story.Progress({ count, active?, title? }) — standalone dots / counter / prev-next chrome
│   └─ <Disclosure> — "Show more / Show less" toggle
│       └─ Props:
│           ├─ children (required) — the truncatable text
│           ├─ lines (optional) — visible lines before truncation
│           ├─ moreLabel / lessLabel (optional) — trigger copy
│           └─ color / triggerColor (optional)
│
├─ Navigation
│   ├─ <Breadcrumb items={…}> — ancestor trail with '/' separators
│   │   └─ Props:
│   │       ├─ items (required) — [{ label, current (Option Bool), onClick (Option fn) }] trail entries
│   │       ├─ leadingSeparator (optional) — adds a leading '/' so it reads as a path (/ workspace / page)
│   │       └─ runAnchor (optional) — trailing run stamp pinned after a vertical rule
│   ├─ <NavList sections={…}> — sidebar nav
│   │   └─ Props:
│   │       ├─ sections (required) — [{ label?, items: [{ key, label, icon?, badge?, active? }] }]
│   │       ├─ onSelect (optional) — fn(key) => Null
│   │       ├─ surface (optional) — "card" (default, bordered) | "shell" (drops the card chrome so the list reads as one surface with a host app-shell rail)
│   │       └─ background (optional) — surface background token (bg.subtle)
│   ├─ <Pages nav={nav} pages={{…}}> — route-stack page host (first-class navigation)
│   │   ├─ Props:
│   │   │   ├─ nav (required) — the binding from Navigation.bind, bound in the enclosing <Reactive>
│   │   │   └─ pages (required) — one body per route: { route: ($, payload, nav) => <…/> }; renders ONLY the active route (leaf-only) and remounts on change; the nav handle fixes the route types
│   │   └─ Factories:
│   │       ├─ Navigation.config({ route: { value: T, label, icon?, section?, badge? } }) — typed registry (config.Route variant type, config.Page.<route>(payload) constructors); icon `{ prefix, name }` / section / badge drive the <App> rail row (single source of truth)
│   │       └─ Navigation.bind(config, key, [config.Page.home()]) — reactive path-stack handle { path, current, depth, canPop, pop, go.<route>(payload), navigateTo([…]) } — go/navigateTo are typed per route (the Record.bind pattern); pair <Breadcrumb>/<NavList> on the same key to drive/derive chrome from nav.path()
│   ├─ <Route nav={nav} routes={{…}}> — <Pages> generalized to any slot (#333)
│   │   └─ Props:
│   │       ├─ nav (required) — the same nav handle
│   │       └─ routes (required) — one body per route; renders only the active route's body and REMOUNTS it on navigation, but placeable anywhere (a header widget, a sidebar, a drawer body). The body <Pages> and any number of <Route> slots bind the SAME nav handle — lockstep, each remounts its own slot. Use it to swap a STATEFUL component (its own <Reactive>/binds) by route; each case is self-contained and rebuilds fresh. For a non-route key use <Match>
│   └─ <App nav={nav} config={routes} pages={{…}}> — the application shell (#367): composes the primitives into one surface — a collapsible nav rail (from the config), a breadcrumb app bar (from nav.path()), an optional brand logo, app-bar slots, and the routed body. Author it INSIDE the <Reactive> that binds nav.
│       ├─ Props:
│       │   ├─ nav (required) — the Navigation.bind handle (drives rail + breadcrumb + body)
│       │   ├─ config (required) — the Navigation.config value (labels / rail icon / section / badge — the handle carries no labels)
│       │   ├─ pages (required) — one body per route (same registry <Pages> takes)
│       │   ├─ title (optional) — header surface title / wordmark (also the logo alt)
│       │   ├─ logo / logoCollapsed (optional) — ImageSource (Image.url / Image.dataUri / Image.blob); the shell renders + sizes the <Image>
│       │   ├─ collapsible (optional, default true) — rail collapses (`[` hotkey + chevron above the list)
│       │   ├─ themeToggle (optional) — built-in dark/light app-bar button (pure-East surfaces; hosts normally inject via AppProvider)
│       │   ├─ density (optional, default comfortable) — app-bar density: comfortable (2 rows) | compact (tighter 2 rows) | condensed (breadcrumb + title on ONE row, ~40px shorter); only the app bar changes (rail + body constant); falls back to inherited density
│       │   └─ barStart / barEnd (optional) — app-bar UIComponent nodes (leading / trailing)
│       └─ Rail: routes with a `section` become rail rows (grouped, icon + badge, active = current route, click → navigate); routes WITHOUT a section are reachable but hidden (deep pages). Host React apps inject chrome (avatar / theme / logout / search) via the east-ui-components `AppProvider` (barStart/barCenter/barEnd/logo/railFooter/bannerTop React slots)
│
├─ Overlays (floating content) — `trigger` is a UIComponent prop; body is children
│   ├─ <Dialog> — modal dialog
│   │   └─ Props:
│   │       ├─ trigger (required) — the opening UIComponent; children (required) — the body
│   │       ├─ eyebrow / title / description (optional) — header copy (eyebrow = mono uppercase, e.g. "Confirm · cannot be undone")
│   │       ├─ size / placement / scrollBehavior / motionPreset / role (optional) — presentation
│   │       ├─ open / defaultOpen / onOpenChange (optional) — controlled state
│   │       ├─ modal / closeOnInteractOutside / closeOnEscape / preventScroll / trapFocus (optional) — behaviour
│   │       ├─ lazyMount / unmountOnExit (optional) — mount policy
│   │       └─ onExitComplete / onEscapeKeyDown / onInteractOutside (optional) — lifecycle callbacks
│   ├─ <Drawer> — side panel
│   │   ├─ Props:
│   │   │   ├─ trigger (required) — the opening UIComponent; children (required) — the body
│   │   │   ├─ placement (optional) — start | end | top | bottom; size — panel size; contained — render within the parent container
│   │   │   ├─ eyebrow / title / description (optional) — header copy
│   │   │   ├─ bodyPadding / flush (optional) — body padding control (flush = full-bleed so a Table/Planner fills)
│   │   │   ├─ fillBody (optional) — the body becomes a definite-height flex column so a single height:100% child fills + owns its scroll
│   │   │   ├─ stacked + stackIcon (optional) — (#328) while a deeper drawer is open, this drawer collapses to a labeled vertical icon rail (instead of hiding behind) — click the rail to pop the stack back to it; Esc pops one level
│   │   │   ├─ open / defaultOpen / onOpenChange / onExitComplete (optional) — controlled state + lifecycle
│   │   │   └─ closeOnInteractOutside / closeOnEscape / lazyMount / unmountOnExit (optional) — behaviour + mount policy
│   │   └─ Factories:
│   │       └─ Drawer.open(OpenInput) — open one programmatically (nests/stacks by depth)
│   ├─ <Popover> — click-triggered floating panel
│   │   └─ Props:
│   │       ├─ trigger (required); children (required) — the panel body
│   │       ├─ title / description (optional) — header copy
│   │       ├─ size / placement / hasArrow / gutter (optional) — positioning + chrome
│   │       ├─ open / defaultOpen / onOpenChange (optional) — controlled state
│   │       └─ modal / closeOnInteractOutside / closeOnEscape / autoFocus / lazyMount / unmountOnExit (optional)
│   ├─ <HoverCard> — hover preview card
│   │   └─ Props:
│   │       ├─ trigger (required); children (required) — the card body
│   │       ├─ title / description (optional) — mono eyebrow header (same as Popover)
│   │       ├─ openDelay / closeDelay (optional) — hover timing
│   │       └─ size / placement / hasArrow / open / defaultOpen / onOpenChange / lazyMount / unmountOnExit (optional)
│   ├─ <Tooltip> — hover tooltip (content is a string)
│   │   └─ Props: trigger (required) / content (required) / placement / hasArrow (optional)
│   ├─ <ToggleTip> — click-toggle tooltip (sticky)
│   │   └─ Props: trigger (required) / children (required) / placement / hasArrow / open / defaultOpen / onOpenChange / closeOnInteractOutside / closeOnEscape (optional)
│   ├─ <Menu trigger={…} items={…}> — dropdown / context menu
│   │   ├─ Props:
│   │   │   ├─ trigger (required) — the opening element; items (required) — array of Menu.Item / Menu.Separator
│   │   │   └─ placement (optional) — position relative to the trigger
│   │   └─ Factories:
│   │       ├─ Menu.Item(value, label, { disabled?, icon?, command?, destructive? }) — one action (icon = FA solid name; command = right-aligned mono accelerator "⌘D"; destructive renders in the negative ink)
│   │       └─ Menu.Separator() — a group divider
│   ├─ <CommandPalette commands={…}> — ⌘K palette with search + groups
│   │   └─ Props:
│   │       ├─ commands (required) — [{ id, label, icon?, shortcut?, group?, keywords?, action }] (action = fn() => Null)
│   │       ├─ placeholder / triggerKey (optional) — search copy + global open chord ("mod+k")
│   │       ├─ open / onOpenChange (optional) — controlled state
│   │       └─ size / inputBackground / inputColor / itemColor / selectedBackground / selectedColor / groupLabelColor + COLOR overrides (optional)
│   ├─ <Hotkey chord="mod+k" onTrigger={fn}> — invisible keydown listener (no render)
│   │   └─ Props:
│   │       ├─ chord (required) — modifiers mod/ctrl/cmd/shift/alt + key
│   │       └─ onTrigger (required) — East.function([], NullType); pair with Reactive + State.bind to drive open state on CommandPalette/Dialog/Drawer
│   └─ <ActionBar items={…}> — sticky bottom bulk-action bar
│       ├─ Props:
│       │   ├─ items (required) — array of ActionBar.Item(…)
│       │   ├─ selectionCount / selectionLabel (optional) — "N items selected" copy
│       │   ├─ open / defaultOpen / onOpenChange (optional) — controlled state
│       │   ├─ onSelect (optional) — fn(actionValue) => Null when an action is chosen
│       │   └─ closeOnInteractOutside / closeOnEscape (optional)
│       └─ Factories:
│           └─ ActionBar.Item(value, label, disabled?) — one action button
│
├─ Container
│   └─ <Card> — chrome-bearing content card (vs <Box> which is structural-only)
│       └─ Props:
│           ├─ children (required) — the body
│           ├─ header (optional) — { eyebrow?, meta?, title?, description? } strict option object composed into the header strip
│           ├─ footer (optional) — { content?, actions? } footer strip (actions = trailing button row)
│           ├─ state (optional) — "ready" | "loading" | "empty" | "error" | "stale" | "disabled" | "permission-denied" runtime state
│           ├─ variant (optional) — elevated | outline | subtle
│           ├─ density (optional) — density provider for the body
│           ├─ bodyPadding / flush (optional) — body padding (default "18px 20px"); flush = full-bleed so a Planner / Table / Chart fills
│           ├─ accentColor / headerBackground / footerBackground (optional) — chrome colours
│           ├─ height / minHeight / maxHeight / width / minWidth / maxWidth / flex / overflow (optional) — sizing (a sized Card becomes a flex column constraining its body — see the Sizing pattern)
│           └─ background / borderColor (optional)
│
├─ Formats (shared value formatting — pick ONE spec, reuse it everywhere; #190)
│   ├─ The contract: every format-bearing prop takes the SAME `ValueFormatType` spec, built with Chart.format.* — a chart axis, a Slice field, a Stat, a Numeric and a Deck metric all format one way. Payloads keep the RAW value; formatting happens at render.
│   ├─ Factories:
│   │   ├─ Chart.format.number() — locale-grouped plain number
│   │   ├─ Chart.format.currency({ code?, compact? }) — currency; compact ⇒ $1.2M
│   │   ├─ Chart.format.percent() — 0.42 → 42%
│   │   ├─ Chart.format.compact() — 12400 → 12.4K
│   │   └─ Chart.format.date(pattern) / Chart.format.time(pattern) / Chart.format.datetime(pattern) — date-token patterns
│   ├─ Where the SAME spec plugs in:
│   │   ├─ <Chart> x/y/y2 { format } — axis tick labels
│   │   ├─ Slice.config fields { format } — filter chips, brush axis labels, range summaries (string shorthands "number"|"percent"|"compact"|{currency:{code?,compact?}}|{date|time|datetime: pattern} also accepted)
│   │   ├─ <Stat format> and <Numeric format> — KPI values
│   │   ├─ Deck.metric / Deck.Readout cells / card fill { format } — board metrics
│   │   └─ Gantt axis { format } and Planner.axis.time { format } — timeline headers (date-pattern strings, same token vocabulary)
│   ├─ Accessor alternative: Deck metric/fill format props ALSO accept a text accessor ((value) => String / (value, max) => String) — reified at authoring time into a pre-rendered `text` field; the raw value still ships, and a `none` value renders "—"
│   ├─ Date tokens: East's date tokens incl. weekdays — dd/ddd/dddd; "ddd DD" → Mon 30. All date rendering is UTC (East DateTime is a UTC instant), so ticks and Planner columns are timezone-independent
│   └─ tickValues (#318): pin chart ticks to exact floats / DateTime instants (rendered through the date format) to line a Chart up with a Planner's columns under an <AlignedStack>
│
├─ Statuses & tones (the shared five-token status vocabulary)
│   ├─ The tokens: "success" | "warning" | "danger" | "info" | "neutral" (StatusTokenType / StatusValueType) — the ONE semantic palette for state colour across the library; theme-mapped, never raw hex
│   ├─ Registries (define states ONCE, reference by key):
│   │   └─ Deck.statuses({ key: { label, color, pulse?, hint? } }) — color is a standard token OR any custom CSS colour; one entry drives the card tag + dot/pulse, face wash, fill bar, group-head swatch + hint, and legend
│   ├─ Where a bare token / status value plugs in:
│   │   ├─ Library.status(label, tone) — palette card status chip
│   │   ├─ Table / Gantt rowStatus — fn(rowIndex) => StatusToken row tint
│   │   ├─ Schematic item { status } (Option token dot) and { tone } (brand|ink|muted|success|warning|danger stroke override)
│   │   ├─ Planner.marker { status } (default danger) and Planner.event { tone } — cell rings + tile tints
│   │   ├─ Gantt.Task { status } — risk tint ("danger" = the old atRisk), ORTHOGONAL to `state`
│   │   ├─ Matrix.marker { status } — corner markers
│   │   ├─ <Status value> — dot + word; <Banner status> uses the wider notice set (info|warning|success|error|neutral|change|guard|stale)
│   │   └─ <Meter tone> / BarStrip item { tone } / SegmentedMeter segment { tone } — bar fills
│   ├─ Sentiment (value direction, NOT state): <MetricChip tone> positive|negative|neutral|info · <Numeric sentiment> positive|negative|neutral · <Stat indicator.sentiment> positive|negative|neutral · <Progress tone> brand|pos|neg
│   ├─ state ≠ status: PlannerStateType ("committed"|"added"|"model"|"removed"|"rejected") is the AUDIT LIFECYCLE shared by Planner events, Gantt tasks, Roster shifts and Board assignments — committed solid, proposals dashed/ghost/struck, rejected greyed; only proposed items drag. A status token is the ORTHOGONAL semantic tint layered on top
│   └─ tone vs colorPalette: tone/status/sentiment = the semantic vocabulary above (meaning-bearing, theme-stable); colorPalette = decorative hue theming (Chakra palettes) for buttons/badges/tags where the colour carries no state meaning
│
├─ Reactive (state-driven re-render)
│   ├─ <Reactive>{$ => { …State.bind reads…; return <…/>; }}</Reactive> — re-renders when read State keys change
│   │   └─ Props:
│   │       └─ children (required) — a builder function ($ => UIComponent); all State.bind reads live inside it
│   └─ <Match on={bind.read()} cases={{…}}> — hosting slot over a variant (#333), the component-level twin of variant.match
│       └─ Props:
│           ├─ on (required) — the variant expression selecting the active case; pass the READING expression (bind.read()) — a $.let snapshot freezes the slot
│           └─ cases (required) — one handler per case name, exhaustive; each gets that case's typed payload. Mounts ONLY the active case and REMOUNTS it on tag change (same-tag payload churn re-renders in place) — use it to swap a STATEFUL component (its own <Reactive>/binds) at one slot; a plain variant.match over mounted components keeps the first one mounted (function-blind reconciliation). A nav-route key is <Route>
│
└─ State (typed reactive store)
    └─ State.bind([T], key, defaultValue) → { read, write, has } closures;
       read() tracks the dependency so <Reactive> re-renders when the value changes
```

## Key Patterns

### Reactive interactivity — builder children

`<Reactive>` takes a **builder function** `{$ => …}` (not a nested
`East.function`). All `State.bind` reads live inside it so the component
re-renders when the bound key changes.

```tsx
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType } from "@elaraai/east";
import { VStack, Text, Button, Reactive, State, UIComponentType } from "@elaraai/east-ui";

const counter = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const count = $.let(State.bind([IntegerType], "count", 0n));
        const value = $.let(count.read());
        const inc = $.const(East.function([], NullType, $ => {
            $(count.write(count.read().add(1n)));
        }));
        return (
            <VStack gap="3">
                <Text textStyle="body-lg">{East.str`Count: ${value}`}</Text>
                <Button onClick={inc}>+1</Button>
            </VStack>
        );
    }}</Reactive>
));
```

### Two callback families

- **Build-time accessors** — `(row) => SubtypeExprOrValue<Scalar>` for chart
  encodings (`x`/`y`/`by`/`columns`) and table column `value`. Passed through
  verbatim; they return field expressions used while building the IR.
- **East-function handlers** — `onClick`, `onChange`, per-row builders. Pass an
  `East.function(...)` value or a typed arrow; the factory lifts it.

### Text is East, not JSX text nodes

Children are `SubtypeExprOrValue<StringType>` — interpolate East-side, never with
JSX braces between text:

```tsx
<Text>{East.str`Hello ${name}`}</Text>   // correct
// <Text>Hello {name}</Text>             // wrong — not East
```

### Conditionals are East

Use `cond.ifElse(<A/>, <B/>)` (a `UIComponentType`), never JS `{cond && <El/>}`
or ternaries returning `null` — those aren't East values.

### Data-driven components keep data on config props

Tables, charts, matrices, lists and item-parents take structured data on
`data=` / `columns=` / `items=` / `layers=` props; per-row builders are typed
callbacks returning factory values (`cell={(r, col) => Matrix.cell({…})}`).
Non-UI sub-structures are never child sub-tags.

```tsx
// Table — columns config, inference preserved
<Table
    data={[{ name: "Alice", role: "Admin" }, { name: "Bob", role: "User" }]}
    columns={{ name: { header: "Name" }, role: { header: "Role" } }}
    striped variant="line"
/>

// Chart — layers config array
<Box height="220px" width="100%">
    <Chart
        layers={[
            Chart.Column(rows, { x: r => r.month, y: r => r.revenue }, { key: "Revenue", color: "teal.solid" }),
            Chart.Line(rows, { x: r => r.month, y: r => r.profit }, { key: "Profit", color: "purple.solid", dots: true }),
        ]}
        y={{ format: Chart.format.currency({ compact: true }) }}
        legend grid tooltip
    />
</Box>
```

### Sizing — one string prop, parsed everywhere

Every size prop is a **plain string** and every renderer parses it the same
way (`parseCssSize`). Four spellings, uniform across data components (`<Table>`,
`<Gantt>`, `<Planner>`, `<Matrix>`, `<Board>`, `<Roster>`, `<Calendar>`,
`<Library>`, `<Schematic>`) and layout primitives (`<Box>` / `<Flex>` /
`<Stack>` / `<Grid>` / `<Card>`):

| Value | Means |
|---|---|
| `"fill"` | fill the parent box (`100%`) |
| `"240"` | a bare number → pixels (`240px`) |
| `"50%"` / `"calc(100vh - 4rem)"` | any CSS length passes through |
| `"18px"` | explicit units pass through |
| `"min(420px, 100%)"` / `"clamp(240px, 50%, 420px)"` | fluid sizes pass through — the mobile-safe way to say "420px, but never wider than the container" |

**Fluid layouts** (desktop + mobile from one definition): prefer
`width="min(<ideal>px, 100%)"` over a bare pixel width; a `<Grid>` with
`templateColumns="repeat(auto-fit, minmax(240px, 1fr))"` reflows cards to
1 column on phones; `<Splitter collapseBelow={480}>` stacks its panels
vertically when its container is narrower than 480px.

```tsx
// height bounds the whole component and it scrolls within; maxHeight caps
// it but stays content-sized until the cap is hit.
<Table data={rows} columns={cols} height="fill" />      // fills its parent
<Planner …  maxHeight="420" />                           // content up to 420px, then scrolls

// Layout primitives add boolean shorthands so you never hand-write the
// flex:1 + min-height:0 + overflow incantation for a scroll region:
<Card height="fill">
    <Box fill scrollY>       {/* fill remaining space, scroll vertically */}
        <Table data={rows} columns={cols} height="fill" />
    </Box>
</Card>
```

A `<Card>` given `height` / `maxHeight` becomes a flex column that constrains
its body, so a single `height="fill"` child (a data component, a scroll region)
resolves against it.

Caveats that save a render cycle:

- **`"fill"` / percentages need a definite parent.** `height="fill"` resolves
  against the nearest box with a real height (a sized `<Box>`/`<Card>`, a flex
  item with `fill`, a Drawer `fillBody`). Inside a content-sized parent it
  silently resolves to auto — bound the parent, don't add pixels to the child.
- **`height` vs `maxHeight`**: `height` pins the component to exactly that box
  (header pinned, body scrolls); `maxHeight` stays content-sized UP TO the cap,
  then scrolls. Bounded data components virtualize (only visible rows mount)
  and show a reserved-gutter scrollbar; unbounded ones grow to content.
- **A definite `height`/`width` on Box/Flex/Stack also pins `flex-shrink: 0`**
  (a sized box no longer collapses under flex pressure) — opt back in with
  `flexShrink` if you want it squeezable.
- **Bare numbers are pixels, not Chakra spacing tokens** — `width="8"` is 8px.
  `gap` / `padding` / `margin` keep token semantics (`gap="4"` is a spacing
  token, not 4px).

### Row groups — a nested P&L in one Table (#317)

`groupBy` folds flat statement lines into nested, collapsible group header
rows. Groups keep first-appearance data order (Revenue stays above Cost of
sales under any sort — sorting reorders members WITHIN their group); columns
with an `aggregate` show their subtotal ON the group row, so a collapsed group
reads as its subtotal line (drill up) and expanding drills down. Collapse
state persists per `storageKey`. Grand totals stay in `footerRows`.

```tsx
const money = $.const(East.function([Table.Types.CellRenderContext], UIComponentType, (_$, ctx) => (
    <Text width="100%" textAlign="right">{East.Float.printCurrency(ctx.cellValue.unwrap("Float"))}</Text>
)));
// `aggregateRender` takes the aggregated CELL VALUE — a group row has no rowIndex.
const moneyTotal = $.const(East.function([Table.Types.Cell], UIComponentType, (_$, v) => (
    <Text width="100%" textAlign="right" fontWeight="semibold">{East.Float.printCurrency(v.unwrap("Float"))}</Text>
)));
return (
    <Table
        data={lines}   // flat leaf accounts: { section, category, account, q1..fy }
        columns={{
            account: { header: "Account" },
            q1: { header: "Q1", aggregate: "sum", render: money, aggregateRender: moneyTotal },
            fy: { header: "FY", aggregate: "sum", render: money, aggregateRender: moneyTotal },
        }}
        groupBy={[
            r => r.section,                              // level 0: Revenue / Cost of sales / Opex
            { value: r => r.category, collapsed: true }, // level 1: starts collapsed
        ]}
        footerRows={[{ account: { content: <Text fontWeight="bold">Net income</Text> }, /* … */ }]}
    />
);
```

Aggregates: `"sum" | "mean" | "min" | "max" | "count"` (`sum`/`mean` require a
numeric column value — build-time error otherwise). Computed statement lines
(Gross profit) that aren't plain subtotals: model them as their own
single-member section in the data, or use `footerRows`.

### Overlays — trigger prop + body children

```tsx
<Dialog trigger={<Button>Open</Button>} title="Confirm" description="Proceed?">
    <Text>This appears as a modal overlay.</Text>
    <HStack gap="2" justify="flex-end">
        <Button variant="outline">Cancel</Button>
        <Button variant="solid">Confirm</Button>
    </HStack>
</Dialog>
```

### Density cascade — one prop tightens a whole surface

Display components (`<Tag>`, `<Badge>`, `<Kbd>`, `<MetricChip>`, `<EditableChip>`,
`<Meter>`, `<BarStrip>`, `<SegmentedMeter>`, `<Stat>`, `<Avatar>`, `<Trace>`,
`<ChipRail>`) take `density="condensed" | "compact" | "comfortable"` and inherit
it from the nearest providing surface — a `<Table>` / `<Gantt>` / `<Planner>` /
`<Matrix>` / `<ChipRail>` with `density` set, or any layout container
(`<Box>` / `<Stack>` / `<Flex>` / `<Grid>` / `<Card>`) given a `density` prop.
All densified components share one sizing rhythm, so mixed table cells (a tag
beside a trace beside a meter) line up; an explicit `density` on a component
wins over the cascade. `<Badge>` and `<Kbd>` scale on a smaller micro-label
tier so they stay subordinate to tags at every density.

```tsx
// One prop on the Table sizes every chip, trace and meter in its cells.
<Table density="compact" data={lines} columns={{ /* render cells with <Tag>, <Trace>, <Meter>… */ }} />

// Or scope it to a row:
<HStack density="condensed" gap="2">
    <Tag>Line A</Tag>
    <Badge>WK 12</Badge>
    <Meter value={72.0} tone="success" />
</HStack>
```

### Picking between similar components

- **Switch vs Toggle vs Checkbox** — `<Switch>` binds a boolean form value;
  `<Toggle>` is a pressable toolbar button; `<Checkbox>` binds a boolean in a list.
- **SegmentGroup vs Tabs vs RadioGroup** — `<SegmentGroup>` is a compact mode
  switcher (no panels); `<Tabs>` switches content panels; `<RadioGroup>` is a form input.
- **Banner vs Status vs Progress** — `<Banner>` spans the page for staleness /
  partial-data; `<Status>` is a dot + word; `<Progress>` shows task completion.
- **Meter vs Progress vs SegmentedMeter** — `<Meter>` is a static value vs a
  range; `<Progress>` is completion; `<SegmentedMeter>` decomposes a meter.
- **Stat vs MetricChip** — `<Stat>` is a tile with hero number; `<MetricChip>` is
  a compact inline delta pill.
- **Tag vs Badge** — `<Tag>` is an operator-set keyword / filter pill (body
  font, optionally closable); `<Badge>` is a mono uppercase micro-label for
  status / taxonomy (ok / warn / danger / count) that stays a tier smaller
  than tags at the same density.
- **BarStrip vs Chart.Bar vs Chart.Column** — `<BarStrip>` is a small ranked
  horizontal-bar list (no axes) for a KPI card; `Chart.Bar` draws horizontal
  bars inside an axis-bearing `<Chart>` (numeric x, categorical y — grid,
  legend, tooltip, stacking); `Chart.Column` is the vertical twin (formerly
  named `Chart.Bar`).
- **Library vs Deck** — `<Library>` is the draggable palette (DnD source);
  `<Deck>` is the status-coloured display board (popover VIEW state, no drag).
- **Card vs Box** — `<Box>` is structural-only; `<Card>` carries chrome.

## Related skills

- **east** — the language UI component bodies are written in.
- **e3-ui** — bind components to live workspace data (`Data.bind`) and ship them
  as reactive `ui()` e3 tasks; pair it with east-ui whenever the UI reads,
  writes, or commits real data.
- **e3** — the engine that runs UI tasks.
- **e3-ui-cli** — screenshot a component from the terminal (`e3-ui shot
  --from-source`) or Node (`renderToPng`), with managed headless Chromium.
