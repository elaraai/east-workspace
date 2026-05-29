---
name: east-ui
description: "Type-safe UI component library for the East language. Use when writing East programs that define user interfaces with declarative components. Triggers for: (1) Writing East programs with @elaraai/east-ui, (2) Layout with Box, Flex, Stack, Grid, Splitter, ScrollArea, Sticky, ChipRail, (3) Forms with Input, Textarea, Select, Combobox, Checkbox, Switch, Slider, RadioGroup, RadioCardGroup, TagsInput, FileUpload, Field, DateRangeInput, TimeRangeInput, TimeScaleControl, (4) Data display with Table, TreeView, DataList, Gantt, Planner, Matrix, Pagination, (5) Charts with Chart.Root assembling Chart.Line/Bar/Area/Scatter/Band layers plus Chart.refLine/refBand/refDot annotations, Sparkline, (6) Overlays with Dialog, Drawer, Popover, Menu, Tooltip, HoverCard, ToggleTip, ActionBar, CoachMark, CommandPalette, (7) Feedback with Alert, Banner, Status, Toast, Progress, ProgressCircle, Spinner, Skeleton, EmptyState, (8) Disclosure with Tabs, Accordion, Carousel, Collapsible, SegmentGroup, OptionList, Steps, Timeline, ShowMore, (9) Navigation with Breadcrumb, NavList, (10) Reactive UI via Reactive.Root + State.bind for state-driven re-renders."
---

# East UI

Type-safe UI component library for the East language. Components return data structures describing UI layouts, enabling portable rendering across environments.

## Quick Start

```typescript
import { East } from "@elaraai/east";
import { Stack, Text, Button, UIComponentType } from "@elaraai/east-ui";

const MyComponent = East.function([], UIComponentType, $ => {
    return Stack.VStack([
        Text.Root("Hello, World!", { fontSize: "lg", fontWeight: "bold" }),
        Button.Root("Click Me", { variant: "solid", colorPalette: "blue" }),
    ], { gap: "4" });
});

const ir = MyComponent.toIR();
```

## Decision Tree: Which Component to Use

Each entry is `Component → .Factory()` followed by a one-line purpose and (where applicable) the meaningful variant tags. **Every public component in `src/` is listed.**

```
Task → What do you need?
│
├─ Layout (arrange content on the page)
│   ├─ Box — generic block container; padding / margin / bg / borderRadius / display
│   │   └─ .Root(children, style)
│   ├─ Flex — flexbox; direction / justify / align / wrap / gap
│   │   └─ .Root(children, style)
│   ├─ Stack — flex with sensible defaults; HStack / VStack shorthands set direction
│   │   ├─ .Root(children, style)
│   │   ├─ .HStack(children, style)
│   │   └─ .VStack(children, style)
│   ├─ Grid — CSS grid; templateColumns / templateRows / gap; .Item gives row/col span
│   │   ├─ .Root(children, style)
│   │   └─ .Item(child, span)
│   ├─ Splitter — resizable panels (horizontal / vertical); each panel carries { id, minSize, maxSize, collapsible, defaultCollapsed }
│   │   └─ .Root(panels, style)
│   ├─ Separator — 1px rule; orientation: horizontal | vertical; variants: subtle | brand | dashed | strong
│   │   └─ .Root(style)
│   ├─ ScrollArea — styled-scrollbar scroll container with overflow x/y controls
│   │   └─ .Root(children, style)
│   ├─ Sticky — position-sticky wrapper with top/bottom offset
│   │   └─ .Root(children, style)
│   └─ ChipRail — horizontal flex-wrap rail for chip-shaped children (e.g. filter pills)
│       └─ .Root(chips, style)
│
├─ Typography (display text)
│   ├─ Text — inline/block text; semantic textStyle preset, fontWeight / fontStyle / textAlign / textTransform / lineClamp / colour slots
│   │   └─ .Root(text, style)
│   ├─ Heading — display-tier heading; textStyle preset + fontWeight / fontFamily / lineHeight / letterSpacing
│   │   └─ .Root(text, style)
│   ├─ Link — clickable hyperlink; variants drive underline-on-hover behaviour; color / hoverColor / visitedColor slots
│   │   └─ .Root(text, href, style)
│   ├─ Code — inline `<code>` token; variant + colorPalette; mono font
│   │   └─ .Root(text, style)
│   ├─ CodeBlock — multi-line code block; header bg, line numbers, highlight-line bg, max-height + overflow
│   │   └─ .Root(text, style)
│   ├─ List — bulleted/numbered list; variants: ordered | unordered | dot (brand bullet); marker + gap controls
│   │   └─ .Root(items, style)
│   ├─ Highlight — highlights `query` substring inside `text` (background-tinted spans)
│   │   └─ .Root(text, query, style)
│   ├─ Mark — semantic `<mark>` span (brand-tinted by default); variants for severity
│   │   └─ .Root(text, style)
│   ├─ Note — inset callout / quote; emphasis: brand | warn | danger; accentColor + bg + border slots
│   │   └─ .Root(children, style)
│   └─ Numeric — tabular-num formatted number; textStyle preset + sentiment-derived color (signColor for ±)
│       └─ .Root(value, options)
│
├─ Buttons (user actions)
│   ├─ Button — clickable button; variants: solid | subtle | outline | ghost | plain; colorPalette: gray | red | green | blue | brand | ...
│   │   └─ .Root(label, options)
│   ├─ IconButton — icon-only button; same variants/sizes as Button
│   │   └─ .Root(icon, options)
│   ├─ CloseButton — × dismiss button used by Dialog / Drawer / Toast
│   │   └─ .Root(options)
│   ├─ CopyButton — copies `value` to clipboard via Platform.Clipboard, shows ✓ feedback
│   │   └─ .Root(value, options)
│   ├─ Toggle — pressable on/off button (NOT a form toggle — see Switch); reports pressed state
│   │   └─ .Root(label, options)
│   └─ ButtonGroup — row/col cluster; `attached: true` shares borders, `gap` separates; takes any UIComponent children
│       └─ .Root(buttons, options)
│
├─ Forms (user input)
│   ├─ Input — typed text inputs; variants: outline | subtle | flushed; colour slots include placeholderColor + focusBorderColor
│   │   ├─ .String(options)
│   │   ├─ .Integer(options)
│   │   ├─ .Float(options)
│   │   └─ .DateTime(options)               – date / datetime with precision
│   ├─ Textarea — multi-line text input; resize: none | vertical | horizontal | both
│   │   └─ .Root(options)
│   ├─ Select — single-select dropdown; size + color/background/borderColor
│   │   └─ .Root(items, options)
│   ├─ Combobox — typeahead/filter select; size + color slots; supports async item providers
│   │   ├─ .Root(items, options)
│   │   └─ .Item(value, label)
│   ├─ Checkbox — boolean checkbox; colorPalette + fillColor / checkColor / borderColor
│   │   └─ .Root(label, options)
│   ├─ Switch — form-style on/off toggle (binds boolean); onColor / offColor / thumbColor
│   │   └─ .Root(options)
│   ├─ Slider — range slider; orientation, variant, colorPalette, marks; track/fill/thumb colour slots
│   │   └─ .Root(options)
│   ├─ RadioGroup — single-select radio list; orientation: horizontal | vertical
│   │   └─ .Root(items, options)
│   ├─ RadioCardGroup — radio buttons rendered as picker cards; orientation + descriptionColor + selected-card colours
│   │   └─ .Root(cards, options)
│   ├─ TagsInput — typeahead chip input; inherits Input variants; tagBackground / tagColor / tagBorderColor for chips
│   │   └─ .Root(options)
│   ├─ FileUpload — drop-zone file picker; dropzoneBackground / dropzoneBorderColor / activeBackground (drag-over)
│   │   └─ .Root(options)
│   ├─ Field — form-field wrapper; orientation, labelColor + helperTextColor + requiredIndicatorColor + per-severity colours (error/warning/info)
│   │   └─ .Root(label, control, options)
│   ├─ DateRangeInput — start–end date pair with preset chips; inherits Input variants
│   │   └─ .Root(options)
│   ├─ TimeRangeInput — start–end time pair; inherits Input variants
│   │   └─ .Root(options)
│   └─ TimeScaleControl — day / week / month / quarter scale picker; activeColor / activeBackground for selected scale
│       └─ .Root(options)
│
├─ Collections (display data sets)
│   ├─ Table — sortable / column-pinnable / virtualized table; variants: line | outline; size: sm | md | lg; selectionMode: single | multiple; striped, stickyHeader, showColumnBorder
│   │   └─ .Root(data, columns, style)
│   ├─ DataList — label/value pair list; orientation: horizontal | vertical; labelColor / valueColor slots
│   │   └─ .Root(items, style)
│   ├─ TreeView — expandable hierarchical tree with selection; size + variant + caretColor + connectorColor + selectedBackground
│   │   └─ .Root(nodes, options)
│   ├─ Gantt — Gantt chart; reuses Table chrome; showToday marker, gridColor, task/milestone defaults
│   │   └─ .Root(tasks, options)
│   ├─ Planner — time-grid event planner (day / week); slotMinWidth, slotLineStroke, colorPalette
│   │   └─ .Root(events, options)
│   ├─ Matrix — generic row × column grid with a cell renderer slot; showGridLines, header/cell colours, legendPosition, emphasis/selected colours
│   │   ├─ .Root(rows, cols, cells, options)
│   │   └─ .CellAddressable(child)          – addressable cell for sparse fills
│   └─ Pagination — page-number control; siblings + boundaries control ellipsis windows; active colour slots
│       └─ .Root(options)
│
├─ Charts (visualize data) — `import { Chart } from "@elaraai/east-ui"`
│   ├─ Chart.Root(layer | layer[], options?)  – assemble mark + annotation layers into one chart;
│   │                                            the x-scale is inferred from the x accessor's type
│   │                                            (String → band, Integer/Float → linear, DateTime → time)
│   ├─ Marks: Chart.Line / Chart.Bar / Chart.Area / Chart.Scatter (rows, encoding, style?)
│   │   ├─ encoding: { x, y }  ·  { x, y, by } (one series per category)  ·  { x, columns: { Name: r => r.field } } (wide)
│   │   ├─ Chart.Scatter encoding also takes { x, y, size } – per-point bubble size (area-proportional)
│   │   └─ Chart.Band(rows, { x, low, high }, style?) – filled low/high range (e.g. confidence band)
│   ├─ Annotations: Chart.refLine({ y } | { x })  ·  Chart.refBand({ y:[lo,hi] } | { x:[lo,hi] })  ·  Chart.refDot({ x, y, label })
│   ├─ style: { color, curve, width, dash, dots, fillOpacity, stack, axis:"left"|"right", order }  (Scatter adds size)
│   ├─ options: { height, width, x/y/y2:{ label, format, domain, scale }, grid, legend, tooltip, stackOffset:"expand" }
│   ├─ Chart.format.{ number, currency, percent, compact, date, time, datetime } – axis tick formats
│   ├─ Sparkline — inline trend visualisation (line | area); 28–36 px tall, fits beside Stat / in a Card row
│   │   └─ .Root(values, style)
│   └─ Slice.Chart.{ Line, Bar, Area, Scatter }(slice, { x, value, xScale?, brush?, legend? }) – slice-bound;
│                                                a brush on a time/linear chart sets the slice's range
│
├─ Display (show information)
│   ├─ Badge — pill/tag label; colorPalette + variants (solid | subtle | outline); border + sizing controls
│   │   └─ .Root(label, options)
│   ├─ Tag — removable chip with close-trigger slot; same variant model as Badge
│   │   └─ .Root(label, options)
│   ├─ Avatar — user avatar (image with initials fallback); size + colorPalette
│   │   └─ .Root(options)
│   ├─ AvatarGroup — overlapping avatar cluster with "+N more" overflow; size + borderColor
│   │   └─ .Root(avatars, options)
│   ├─ Icon — FontAwesome icon; size variant + colour
│   │   └─ .Root(name, options)
│   ├─ Kbd — keyboard shortcut chip (e.g. ⌘ K); variant + shadowColor
│   │   └─ .Root(keys, options)
│   ├─ Stat — metric tile with label / value / change indicator (up | down | flat); size + per-slot colour overrides
│   │   └─ .Root(label, value, options)
│   ├─ MetricChip — compact mono delta chip; sentiment: pos | neg | flat
│   │   └─ .Root(value, options)
│   ├─ Meter — horizontal capacity bar with sentiment colour; thickness preset + track/fill colours
│   │   └─ .Root(value, options)
│   ├─ SegmentedMeter — multi-segment meter (e.g. decomposed confidence); labels position + caption colour
│   │   └─ .Root(segments, options)
│   ├─ BarStrip — ranked horizontal-bar list (axis-free; fits inside Stat / Card); orientation + thickness + valueColor
│   │   └─ .Root(items, options)
│   └─ EditableChip — chip whose text becomes inline input on click; trigger-icon + border colour
│       └─ .Root(value, options)
│
├─ Feedback (status & async signals)
│   ├─ Alert — inline message; status: info | success | warning | error | neutral; variants: solid | subtle | outline; iconColor slot
│   │   └─ .Root(title, options)
│   ├─ Banner — page-spanning notice; status: stale | partial | change | error | guard; reuses Alert variants + accentColor stripe
│   │   └─ .Root(message, options)
│   ├─ Status — dot + uppercase label (no fill); status: success | warning | danger | info | neutral; dotColor override
│   │   └─ .Root(label, options)
│   ├─ Toast — ephemeral overlay through host Toaster singleton; .make builds a value, .emit pushes it
│   │   ├─ .make(status, title, options)
│   │   └─ .emit(toast)
│   ├─ Progress — linear progress bar; variants (determinate / indeterminate), striped, animated, colorPalette
│   │   └─ .Root(value, options)
│   ├─ ProgressCircle — circular progress indicator; thin-stroke brand ring
│   │   └─ .Root(value, options)
│   ├─ Spinner — indeterminate loading spinner; size preset
│   │   └─ .Root(options)
│   ├─ Skeleton — shimmer placeholder; width/height/fontSize + shimmerColor
│   │   └─ .Root(options)
│   └─ EmptyState — zero-data state with glyph, description, optional checklist + actions; size + iconColor
│       └─ .Root(title, options)
│
├─ Disclosure (reveal / switch content)
│   ├─ Tabs — content tabs; variants: line | subtle | enclosed | outline | plain | ink | brand-tint; size sm | md | lg
│   │   ├─ .Root(items, options)
│   │   └─ .Item(value, trigger, content)
│   ├─ Accordion — expandable sections; single or multi-open; variants: enclosed | plain | subtle
│   │   ├─ .Root(items, options)
│   │   └─ .Item(value, trigger, content)
│   ├─ Carousel — paginated slide carousel; orientation, padding, indicator + control colour slots
│   │   └─ .Root(slides, options)
│   ├─ Collapsible — single show/hide section (no group); trigger + content colour slots
│   │   └─ .Root(trigger, content, options)
│   ├─ SegmentGroup — single-select segmented toggle (mode/context switcher); orientation + colorPalette + active/inactive colours
│   │   ├─ .Root(value, items, options)
│   │   └─ .Item(value, label)
│   ├─ OptionList — keyboard-navigable single-select list (rows with description + trailing slot + disabled); selectedBackground + impactColor
│   │   ├─ .Root(options_array, opts)
│   │   └─ .Option(id, label, opts)
│   ├─ Steps — stepper rail; orientation: horizontal | vertical; .Status: pending | active | completed | error | skipped; per-status colours + connectorColor
│   │   ├─ .Root(items, options)
│   │   └─ .Item(value, title, options)
│   ├─ Timeline — vertical decision-journal timeline; per-item status colours + indicatorColor + connectorColor
│   │   ├─ .Root(items, options)
│   │   └─ .Item(value, title, options)
│   └─ Disclosure — the "Show more / Show less" toggle (src/disclosure/show-more)
│       └─ .Root(trigger, options)
│
├─ Navigation
│   ├─ Breadcrumb — ancestor trail with separator (chevron / slash); variant + size + colorPalette
│   │   └─ .Root(items, options)
│   └─ NavList — sidebar nav list; orientation + sectionLabelColor + active item slots (activeBackground, activeIndicatorColor) + badge slots
│       └─ .Root(sections, style)
│
├─ Overlays (floating content)
│   ├─ Dialog — modal dialog; style carries title, size, placement; trigger + body slots
│   │   └─ .Root(trigger, body, style)
│   ├─ Drawer — side drawer panel; side: top | right | bottom | left; trigger + body slots
│   │   └─ .Root(trigger, body, style)
│   ├─ Popover — click-triggered floating panel; style.placement controls anchor position
│   │   └─ .Root(trigger, body, style)
│   ├─ HoverCard — hover-triggered preview card (delayed open/close)
│   │   └─ .Root(trigger, body, style)
│   ├─ Tooltip — hover tooltip; mono uppercase small text (content: string, not UIComponent)
│   │   └─ .Root(trigger, content, style)
│   ├─ ToggleTip — click-toggle tooltip (sticky until dismissed); accepts richer content than Tooltip
│   │   └─ .Root(trigger, content, style)
│   ├─ Menu — dropdown / context menu; style.placement controls anchor; supports menu separators
│   │   ├─ .Root(trigger, items, style)
│   │   └─ .Item(value, label, disabled?)
│   ├─ CommandPalette — ⌘K command palette overlay with search input + groups; size + input/item/group-label colour slots
│   │   └─ .Root(commands, style)
│   ├─ ActionBar — sticky bottom action bar (bulk selection / batch ops); onSelect + onOpenChange callbacks
│   │   └─ .Root(items, style)
│   └─ CoachMark — first-run onboarding callout (live-pulse dot); placement + arrowColor
│       └─ .Root(target, title, body, style)
│
├─ Container (content wrapper)
│   └─ Card — titled card with header / body / footer; variants: elevated | outline | subtle
│       └─ .Root(children, options)
│
├─ Reactive (state-driven re-render)
│   └─ Reactive — wraps a free `() => UIComponent` so it re-renders when read State keys change; all `State.bind` reads must live inside the inner function body
│       └─ .Root(fn)
│
└─ State (typed reactive store)
    └─ State.bind([T], key, defaultValue)   – returns `{ read, write, has }` closures; initialises the key on first
                                              bind; `read()` tracks the dependency so Reactive.Root re-renders when
                                              the value changes
```

## Common Types

| Type | Definition | Description |
|------|------------|-------------|
| `UIComponentType` | `VariantType({ box, flex, text, button, ... })` | Recursive type for all UI components |
| `SizeType` | `xs \| sm \| md \| lg \| xl` | Component size |
| `ColorSchemeType` | `gray \| red \| orange \| yellow \| green \| teal \| blue \| cyan \| purple \| pink \| brand` | Colour palette |
| `FontWeightType` | `normal \| medium \| semibold \| bold` | Text weight |
| `FlexDirectionType` | `row \| column \| row-reverse \| column-reverse` | Flex direction |
| `JustifyContentType` | `flex-start \| flex-end \| center \| space-between \| space-around \| space-evenly` | Flex justify |
| `AlignItemsType` | `flex-start \| flex-end \| center \| stretch \| baseline` | Flex align |
| `OrientationType` | `horizontal \| vertical` | Used by Separator, Steps, Splitter, Carousel |
| `AlertStatusType` | `info \| success \| warning \| error \| neutral` | Used by Alert, Toast |
| `StepStatusType` | `pending \| active \| completed \| error \| skipped` | Used by Steps, Timeline |
| `StatusValueType` | `success \| warning \| danger \| info \| neutral` | Used by Status (dot + word) |

## Available Components (flat index)

| Category | Components |
|----------|------------|
| Layout | `Box`, `Flex`, `Stack`, `Grid`, `Splitter`, `Separator`, `ScrollArea`, `Sticky`, `ChipRail` |
| Typography | `Text`, `Heading`, `Link`, `Code`, `CodeBlock`, `List`, `Highlight`, `Mark`, `Note`, `Numeric` |
| Buttons | `Button`, `IconButton`, `CloseButton`, `CopyButton`, `Toggle`, `ButtonGroup` |
| Forms | `Input`, `Textarea`, `Select`, `Combobox`, `Checkbox`, `Switch`, `Slider`, `RadioGroup`, `RadioCardGroup`, `TagsInput`, `FileUpload`, `Field`, `DateRangeInput`, `TimeRangeInput`, `TimeScaleControl` |
| Collections | `Table`, `DataList`, `TreeView`, `Gantt`, `Planner`, `Matrix`, `Pagination` |
| Charts | `Chart.Root` + `Chart.Line/Bar/Area/Scatter/Band` layers, `Chart.refLine/refBand/refDot`, `Chart.format.*`, `Sparkline`, `Slice.Chart.*` |
| Display | `Badge`, `Tag`, `Avatar`, `AvatarGroup`, `Icon`, `Kbd`, `Stat`, `MetricChip`, `Meter`, `SegmentedMeter`, `BarStrip`, `EditableChip` |
| Feedback | `Alert`, `Banner`, `Status`, `Toast`, `Progress`, `ProgressCircle`, `Spinner`, `Skeleton`, `EmptyState` |
| Disclosure | `Tabs`, `Accordion`, `Carousel`, `Collapsible`, `SegmentGroup`, `OptionList`, `Steps`, `Timeline`, `Disclosure (ShowMore)` |
| Navigation | `Breadcrumb`, `NavList` |
| Overlays | `Dialog`, `Drawer`, `Popover`, `HoverCard`, `Tooltip`, `ToggleTip`, `Menu`, `CommandPalette`, `ActionBar`, `CoachMark` |
| Container | `Card` |
| Reactive | `Reactive.Root` |
| State | `State.bind` (returns `{ read, write, has }` closures) |

## Pairings / when components overlap

A short guide for the components that look similar — pick by intent:

- **Switch vs Toggle vs Checkbox** – `Switch` binds a boolean form value (settings page). `Toggle` is a pressable on/off button (toolbar). `Checkbox` binds a boolean form value (in a list).
- **SegmentGroup vs Tabs vs RadioGroup** – `SegmentGroup` is a compact mode/context switcher (no content panels). `Tabs` is a content switcher (one panel per tab). `RadioGroup` is a form input (binds a value).
- **Alert vs Banner vs Status vs Toast** – `Alert` is an inline message inside a card. `Banner` is a page-spanning notice for staleness / partial-data / change-since-visit. `Status` is a dot + word (no fill). `Toast` is an ephemeral overlay through the host Toaster.
- **OptionList vs Select vs Combobox vs RadioGroup** – `OptionList` is a visible single-select list (alternatives explorer). `Select` is a closed dropdown. `Combobox` is a typeahead-filtered Select. `RadioGroup` is a form input.
- **Meter vs Progress vs SegmentedMeter** – `Progress` shows task completion (determinate / indeterminate). `Meter` shows a static value against a range (with sentiment colour). `SegmentedMeter` decomposes a meter into multiple stacked segments.
- **BarStrip vs Chart.Bar** – `BarStrip` is a small ranked horizontal-bar list (no axes). `Chart.Bar` is a bar layer inside `Chart.Root` — a full chart with axes and legend.
- **Stat vs MetricChip** – `Stat` is a tile with hero number + label + change. `MetricChip` is a compact inline mono delta pill.
- **Steps vs Timeline** – `Steps` is a horizontal progress rail (linear flow). `Timeline` is a vertical decision-journal log (chronological entries).
- **Card vs Box** – `Box` is structural-only. `Card` carries chrome (header, body, footer, border).

## Common Patterns

### Basic Layout with Stack

```typescript
import { Stack, Text, Button, UIComponentType } from "@elaraai/east-ui";

const layout = East.function([], UIComponentType, $ => {
    return Stack.VStack([
        Text.Root("Title", { fontSize: "xl", fontWeight: "bold" }),
        Text.Root("Description text here"),
        Stack.HStack([
            Button.Root("Cancel", { variant: "outline" }),
            Button.Root("Submit", { variant: "solid", colorPalette: "blue" }),
        ], { gap: "2" }),
    ], { gap: "4", padding: "6" });
});
```

### Reactive counter (canonical interactive pattern)

```typescript
import { East, IntegerType, NullType } from "@elaraai/east";
import { Stack, Button, Text, Reactive, State, UIComponentType } from "@elaraai/east-ui";

const counter = East.function([], UIComponentType, (_$) => {
    return Reactive.Root(East.function([], UIComponentType, $ => {
        // bind once — initialises "count" to 0n on first run and exposes
        // read/write closures tied to that key.
        const countBind = $.let(State.bind([IntegerType], "count", 0n));
        const count     = $.let(countBind.read());

        const increment = $.const(East.function([], NullType, $ => {
            $(countBind.write(count.add(1n)));
        }));

        return Stack.VStack([
            Text.Root(East.str`Count: ${count}`, { fontSize: "lg" }),
            Button.Root("+1", { onClick: increment }),
        ], { gap: "3" });
    }));
});
```

### Data table with columns

```typescript
import { Table, UIComponentType } from "@elaraai/east-ui";

const dataTable = East.function([], UIComponentType, $ => {
    return Table.Root(
        [
            { id: 1n, name: "Alice", email: "alice@example.com" },
            { id: 2n, name: "Bob",   email: "bob@example.com"   },
        ],
        [
            { header: "ID",    accessorKey: "id"    },
            { header: "Name",  accessorKey: "name"  },
            { header: "Email", accessorKey: "email" },
        ],
        { variant: "line", showColumnBorder: true }
    );
});
```

### Line chart

```typescript
import { East, ArrayType, StructType, StringType, IntegerType } from "@elaraai/east";
import { Chart, UIComponentType } from "@elaraai/east-ui";

const chart = East.function([], UIComponentType, $ => {
    const rows = $.const([
        { month: "Jan", revenue: 186n, profit: 80n },
        { month: "Feb", revenue: 305n, profit: 120n },
        { month: "Mar", revenue: 237n, profit: 95n },
    ], ArrayType(StructType({ month: StringType, revenue: IntegerType, profit: IntegerType })));
    // Compose layers: revenue bars + a profit line. Encodings bind data by typed
    // accessor; the x type (String) infers a band scale. Currency-formatted y-axis.
    return Chart.Root([
        Chart.Bar(rows, { x: r => r.month, y: r => r.revenue }, { key: "Revenue", color: "teal.solid" }),
        Chart.Line(rows, { x: r => r.month, y: r => r.profit }, { key: "Profit", color: "purple.solid", dots: true }),
    ], { y: { format: Chart.format.currency({ compact: true }) }, legend: true, tooltip: true, grid: true });
});
```

### Dialog overlay

```typescript
import { Dialog, Button, Text, UIComponentType } from "@elaraai/east-ui";

const dialogExample = East.function([], UIComponentType, $ => {
    return Dialog.Root(
        Button.Root("Open Dialog"),
        [Text.Root("Are you sure you want to proceed?")],
        { title: "Confirm Action", size: "md" }
    );
});
```

### Status dot + word (no tint)

```typescript
import { Stack, Status, Text, UIComponentType } from "@elaraai/east-ui";

const live = East.function([], UIComponentType, $ => {
    return Stack.HStack([
        Status.Root("Live",     { status: "success" }),
        Status.Root("Warning",  { status: "warning" }),
        Status.Root("Error",    { status: "danger"  }),
        Status.Root("Idle",     { status: "neutral" }),
    ], { gap: "4" });
});
```

## Related skills

- **east** — the language UI component bodies are written in.
- **e3-ui** — bind components to live workspace data (`Data.bind`) and ship them as reactive `ui()` e3 tasks; pair it with east-ui whenever the UI reads, writes, or commits real data.
- **e3** — the engine that runs UI tasks.
