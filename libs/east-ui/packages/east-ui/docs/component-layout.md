# east-ui component layout reference

This file is the **discoverable directory layout** for the east-ui
package and the enumeration of base style variants in `src/style.ts`.
It used to live inline in `CLAUDE.md`; moved here because the layout is
derivable from `ls src/` and rotted relative to disk too easily.

For load-bearing architecture (types.ts pattern, container vs leaf,
SubtypeExprOrValue), see [`../CLAUDE.md`](../CLAUDE.md).

## Full file structure

```
src/
  index.ts              # Main exports
  style.ts              # Common style types (FontWeight, TextAlign, Size, ColorScheme, …)
  component.ts          # UIComponentType recursive type definition

  buttons/
    index.ts            # Buttons category exports
    button/
      index.ts          # Button component
      types.ts          # ButtonType, ButtonStyleType

  collections/
    index.ts
    data-list/
      index.ts          # DataList component
      types.ts          # DataListRootType, DataListItemType

  container/
    index.ts
    card/
      index.ts          # Card component (container with children)
      types.ts          # CardStyleType, CardVariantType

  disclosure/
    index.ts
    accordion/
      index.ts          # Accordion component (container with children)
      types.ts          # AccordionStyleType, AccordionVariantType

  display/
    index.ts
    avatar/
      index.ts          # Avatar component
      types.ts          # AvatarType
    badge/
      index.ts          # Badge component
      types.ts          # BadgeType, BadgeVariantType
    stat/
      index.ts          # Stat component
      types.ts          # StatType, StatIndicatorType
    tag/
      index.ts          # Tag component
      types.ts          # TagType

  feedback/
    index.ts
    alert/
      index.ts          # Alert component
      types.ts          # AlertType, AlertStatusType
    progress/
      index.ts          # Progress component
      types.ts          # ProgressType

  forms/
    index.ts
    checkbox/
      index.ts          # Checkbox component
      types.ts          # CheckboxType
    input/
      index.ts          # Input component (String, Integer, Float, DateTime)
      types.ts          # StringInputType, IntegerInputType, …
    select/
      index.ts          # Select component
      types.ts          # SelectRootType, SelectItemType
    slider/
      index.ts          # Slider component
      types.ts          # SliderType
    switch/
      index.ts          # Switch component
      types.ts          # SwitchType

  layout/
    index.ts
    box/
      index.ts          # Box component (container with children)
      types.ts          # BoxStyleType
    grid/
      index.ts          # Grid component (container with children)
      types.ts          # GridStyleType, GridAutoFlowType
    separator/
      index.ts          # Separator component
      types.ts          # SeparatorStyleType
    splitter/
      index.ts          # Splitter component (container with children)
      types.ts          # SplitterStyleType
    stack/
      index.ts          # Stack, HStack, VStack components (container with children)
      types.ts          # StackStyleType

  typography/
    index.ts
    text/
      index.ts          # Text component
      types.ts          # TextType

test/
  platforms.spec.ts     # Test infrastructure
  component.spec.ts     # Tests for UIComponentType compositions
  buttons/              # Button tests
  collections/          # DataList tests
  container/            # Card tests
  disclosure/           # Accordion tests
  display/              # Avatar, Badge, Stat, Tag tests
  feedback/             # Alert, Progress tests
  forms/                # Checkbox, Input, Select, Slider, Switch tests
  layout/               # Box, Grid, Separator, Splitter, Stack tests
  typography/           # Text tests
```

## Base style variants (`src/style.ts`)

Reusable across all components. All created via East's `variant`
function (`variant("bold", null)`, `variant("center", null)`, …).

**Font styling:**

- `FontWeight` — normal, bold, semibold, medium, light
- `FontStyle` — normal, italic

**Text alignment:**

- `TextAlign` — left, center, right, justify
- `VerticalAlign` — top, middle, bottom, baseline

**Text behavior:**

- `TextOverflow` — clip, ellipsis
- `WhiteSpace` — normal, nowrap, pre, pre_wrap
- `WordBreak` — normal, break_word, break_all

**Table-specific:**

- `TableVariant` — simple, striped, unstyled
- `TableSize` — sm, md, lg
- `ColorScheme` — gray, red, orange, yellow, green, teal, blue, cyan,
  purple, pink
- `TextTransform` — uppercase, lowercase, capitalize, none

## Table component shape (reference)

`src/table/`:

- **`Table.Cell`** — creates a cell variant with typed value and
  optional styling.
- **`Table.Row`** — creates a row struct from a record of cells with
  optional row styling.
- **`Table.Root`** — maps an array of data to an array of rows using a
  builder function.

All return East data structures that can be serialized to JSON as East
IR, compiled to executable functions, and rendered in any environment.
