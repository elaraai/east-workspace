# east-ui JSX — component coverage proposal (deep pass)

> **Status:** DRAFT for approval. Implemented so far: 7 tags (`Box`, `Stack`,
> `VStack`, `HStack`, `Text`, `Heading`, `Button`) + `ui()` closure overload +
> the `/jsx-runtime`. This doc specifies JSX for **all** east-ui components from
> a full prop-surface survey (callbacks, state, and the complete style
> vocabulary), for sign-off before building the rest.

---

## 1. Goals & ground rules

- **JSX is authoring sugar over East IR.** `<Box>` evaluates to the same
  `ExprType<UIComponentType>` value `Box.Root(...)` returns. No React at
  runtime; it serializes/renders identically. (Proven end-to-end via
  `ui('hello', () => <VStack>…</VStack>)` → `e3 dataflow run` → `e3 dataset
  get`.)
- **`.tsx` only.** Literal `<Box>` needs a `.tsx` file; the `.ts` parser reads
  `<` as a type assertion. No pragma/decorator changes that.
- **Flat props, like React.** Every prop sits at the top level of the tag
  (`<Slider value={v} onChange={set} min={0} max={100} variant="outline" />`);
  the wrapper routes them into the factory's real shape (§2).
- **One import for authoring:** `import { ui, Box, Slider, … } from
  '@elaraai/e3-ui/ui'`. The `/jsx-runtime` is compiler-only.
- **Type-safe.** Each tag's props derive from the real factory/style types, so
  `variant="outline"`, `size="md"`, `onChange`, etc. are checked + autocompleted.

---

## 2. Wrapper shapes & flat-prop routing

east-ui factories use a handful of call shapes. The wrapper presents **flat
props** to JSX and routes them per shape. Combinators marked ✅ exist.

| # | Factory shape | Components | JSX | Combinator |
|---|---|---|---|---|
| 1 | `(children[], style?)` — style is flat 2nd arg | Box, Flex, Stack, Grid, Text*, Heading*, Code*, Badge*, Tag*, Kbd* | children + flat style props | ✅ `container` / ✅ `textLeaf` (*value leaves) |
| 2 | `(value/content, options)` — **one flat bag**: callbacks + state + style all siblings | Forms (Checkbox, Switch, Slider, Input, Textarea, TagsInput, Select…), Progress, Meter, Stat, Avatar, Banner, Status, … | all flat props → the bag | ➕ `leaf` |
| 3 | `(label/content, options)` — **style nested** under `options.style`; behavior/state at top | Button, IconButton, CopyButton, CloseButton, Toggle, Card, ScrollArea, Sticky, ChipRail | flat props; wrapper **splits** style-keys into `options.style` | ➕ `optionLeaf(styleKeys)` |
| 4 | `(trigger, body[], style)` | Dialog, Drawer, Popover, HoverCard, Tooltip, Menu, ToggleTip, Collapsible | `trigger={<…/>}` prop + body children + flat opts | ➕ `triggerBody` |
| 5 | `(items[], options)` / `(value, items[], options)` | Tabs, Accordion, Select, SegmentGroup, OptionList, Menu, Carousel, ButtonGroup, TreeView, Grid | item sub-tags as children (§6) | ➕ `itemsParent` |
| 6 | `(rows[], columns[], options)` structured | Table, Matrix, Gantt, Planner | `data=`/`columns=` props (+ optional markup mode §6) | ➕ `dataDriven` |

**Routing rule (from the style survey):** pure-presentation leaves put style as a
flat 2nd arg (shape 1); anything with behavior/state generally takes a flat
options bag (shape 2); a handful nest visual style under `options.style` (shape
3). The wrapper carries a per-component descriptor: `{ kind, styleKeys? }`. For
shape 3, `styleKeys` is the set folded into `options.style`; everything else
stays top-level. The combinators are exported so unlisted/user components are a
one-liner.

---

## 3. Mixing TS and East — props *and* children take either, freely

The core principle: east-ui authoring blends two layers, mixable anywhere.

- **TS/JS layer** — literals, JS arrays, `.map` over JS data, `&&`/ternary,
  spreads. Evaluated at authoring time.
- **East layer** — East expressions: field access (`t.value`), East `.map` over
  an East array, `ifElse`, bound dataset values. Compiled to IR.

### 3a. Props take a TS value *or* an East expression (already true)
```tsx
<Text>hi</Text>                                   {/* TS literal */}
<Text>{row.name}</Text>                           {/* East expression */}
<Badge colorPalette={ok.ifElse("green","red")}>…</Badge>  {/* East conditional */}
```

### 3b. Children, TS side — element values & JS arrays
```tsx
<VStack gap="2">
  <Text>One</Text>
  {labels.map(l => <Text>{l}</Text>)}    {/* labels: JS string[] */}
  {showFooter && <Text>footer</Text>}
</VStack>
```

### 3c. Children, East side — one array *expression*
```tsx
// rows : ExprType<ArrayType<Row>>  — a runtime East array (e.g. a dataset)
<VStack>{rows.map(r => <Text>{r.name}</Text>)}</VStack>
```
`rows.map(...)` is **East's** map: `r` is an East element expression and the
child is a single `ExprType<ArrayType<UIComponentType>>`. Factories already
accept an East array as their children arg, so it slots straight in.

### 3d. Mix them in one parent
```tsx
<Tabs>
  <Tab value="all" title="All">{…}</Tab>           {/* TS static */}
  {presetTabs.map(p => <Tab value={p.id} .../>)}   {/* TS map over JS array */}
  {liveGroups.map(g => <Tab value={g.id} .../>)}   {/* East map over East array */}
</Tabs>
```
The wrapper coalesces: TS element runs become `East.value([...],
ArrayType(TabType))`, East array-expressions are concatenated (East array
concat) → one `ArrayType<Tab>`. All-TS-static stays a plain JS array.

> **Design note (§8):** to do 3c/3d the wrapper must inspect each child's East
> type and concat `ArrayType` children rather than push them. Shipped
> `container`/`textLeaf` do only 3a/3b today.

---

## 4. Style vocabulary (central reference)

Documented once here; per-component specs in §5 just name which subset they
carry. Every value below also accepts an East expression (`SubtypeExprOrValue`).

### 4a. Enum unions (string-literal shorthands)

**Scheme**
- `size`: `xs | sm | md | lg`
- `colorPalette`: `gray | red | orange | yellow | green | teal | blue | cyan | purple | pink | success | warning | danger | info | neutral`
- `variant` (generic `StyleVariant`): `subtle | solid | outline | brand | ok | warn | danger | dashed | plain | count | callout`

**Typography**
- `textStyle`: `display-xl | display-lg | display-md | display-sm | heading-lg | heading-md | heading-sm | heading-xs | body-lg | body-md | body-sm | label-md | label-sm | caption | overline | code-sm | code-md | mono-kpi`
- `fontWeight`: `normal | bold | semibold | medium | light` · `fontStyle`: `normal | italic`
- `fontFamily`: `sans | serif | mono` · `fontVariantNumeric`: `normal | tabular-nums | oldstyle-nums | slashed-zero`
- `textAlign`: `left | center | right | justify` · `textTransform`: `uppercase | lowercase | capitalize | none`
- `textDecoration`: `none | underline | line-through | overline` · `textOverflow`: `clip | ellipsis`
- `whiteSpace`: `normal | nowrap | pre | pre-wrap | pre-line` · `verticalAlign`: `top | middle | bottom | baseline`

**Layout**
- `flexDirection`: `row | column | row-reverse | column-reverse` · `orientation`: `horizontal | vertical`
- `justifyContent`: `flex-start | flex-end | center | space-between | space-around | space-evenly`
- `alignItems`: `flex-start | flex-end | center | baseline | stretch` · `wrap`: `nowrap | wrap | wrap-reverse`
- `display`: `block | inline | inline-block | flex | inline-flex | grid | inline-grid | none`
- `overflow[X|Y]`: `visible | hidden | scroll | auto` · `position`: `static | relative | absolute | fixed | sticky`
- `cursor`: `auto | default | pointer | help | wait | not-allowed | text | move | col-resize | row-resize`
- `align` (content): `start | center | end`

**Visual**
- `borderWidth`: `none | thin | medium | thick` · `borderStyle`: `solid | dashed | dotted | double | none`
- `borderRadius`: `none | xs | sm | md | lg | full` · `boxShadow`: `none | xs | sm | md | lg | xl`
- `zIndex`: `base | dropdown | sticky | banner | overlay | modal | popover | toast | tooltip`
- `elevation`: `flat | raised | overlay | floating | modal` (semantic; prefer over zIndex+shadow)

**Motion**
- `animation`: `none | pulse | spin | bounce | fade-in | shimmer` · `transition`: `none | colors | shadows | transform | layout | all`

**Interaction / status**
- `density`: `comfortable | compact | condensed` · `status` (tone): `success | warning | danger | info | neutral`
- `placement` (overlays, 12-pt): `top | top-start | top-end | bottom | bottom-start | bottom-end | left | left-start | left-end | right | right-start | right-end`

### 4b. Property groups (the "box-like" vocabulary)

- **Spacing:** `padding`, `margin` (string shorthand or `Box.Padding({top,right,bottom,left})`), `gap`
- **Sizing:** `width`, `height`, `min/maxWidth`, `min/maxHeight`, `flex`
- **Flex/layout:** `display`, `flexDirection`, `justifyContent`, `alignItems`, `wrap`
- **Border:** `border`, `borderColor`, `borderWidth`, `borderStyle`, `borderRadius`
- **Color:** `color`, `background`, `colorPalette`
- **Typography:** `textStyle`, `fontWeight`, `fontStyle`, `fontFamily`, `fontVariantNumeric`, `lineHeight`, `letterSpacing`, `textAlign`, `textDecoration`, `textTransform`, `textOverflow`, `whiteSpace`
- **Effects:** `boxShadow`, `opacity`, `transform`, `transition`, `animation`, `cursor`
- **Position:** `position`, `top`, `right`, `bottom`, `left`, `zIndex` · **Overflow:** `overflow`, `overflowX`, `overflowY`

### 4c. How much each component carries

- **Full box-like set (~33):** Box, Stack, Flex (Flex adds `flex/flexGrow/flexShrink`)
- **Typography set (~26):** Text (Heading/Code = subsets)
- **Box-ish display set (~18):** Badge, Tag, Avatar, Icon (sizing + border + spacing + color)
- **Minimal (~7: variant/size + color hatches):** Button family, Input family, and most form/feedback/display leaves carry a small *preset + colour-slot* style set (their structural props live as state, not style)

`Style.*` accessors (`Style.Size("md")`, `Style.Elevation("overlay")`, …) exist
for building enum values explicitly; JSX uses the string shorthand by default.

---

## 5. Component reference

Format per entry: **`.Root(args)`** · **behavior** (callbacks) · **state**
(config) · **style** (location + set + key enums) · **JSX**. Style fields beyond
the listed key enums come from §4b.

### 5.1 Layout (`container`, shape 1 — except Card/ScrollArea/Sticky/ChipRail = shape 3)

| Component | `.Root` | Behavior | State | Style loc | JSX |
|---|---|---|---|---|---|
| Box | `(children, style?)` | — | — | flat 2nd | `<Box padding="4" background="gray.50">…</Box>` |
| Flex | `(children, style?)` | — | — | flat 2nd | `<Flex direction="row" gap="2" wrap="wrap">…</Flex>` |
| Stack/VStack/HStack | `(children, style?)` | — | — | flat 2nd | `<VStack gap="4" align="stretch">…</VStack>` |
| Separator | `(style?)` | — | `label` | nested | `<Separator variant="dashed" label="OR" />` |
| Grid | `(items, style?)` + `Grid.Item(content, style?)` | — | item: `colSpan/rowSpan/colStart/area` | flat 2nd | `<Grid templateColumns="repeat(3,1fr)" gap="3"><Grid.Item colSpan="2">…</Grid.Item></Grid>` |
| Splitter | `(panels, defaultSize, style?)` + `.Panel(content, cfg)` | `onResize/onResizeEnd` | panel: `minSize/maxSize/collapsible` | flat | `<Splitter defaultSize={[60,40]} onResizeEnd={save}><Splitter.Panel minSize={20}>…</Splitter.Panel>…</Splitter>` |
| ScrollArea | `(content, options?)` | — | `scrollbarStyle` | nested | `<ScrollArea maxHeight="300px">…</ScrollArea>` |
| Sticky | `(content, options?)` | — | `offset`, `boundary` | nested | `<Sticky offset="0" boundary="viewport">…</Sticky>` |
| ChipRail | `(chips, options?)` | — | `density`, `separator` | nested | `<ChipRail separator="dot">…</ChipRail>` |
| Card | `(children, options?)` + `.Header/.Title/.Body/.Footer/.Actions/.Section` | — | `header`, `footer`, `state` | nested | see §6 (compound) |

### 5.2 Typography (`textLeaf`, shape 1; multi-arg ones noted)

| Component | `.Root` | State | Key style | JSX |
|---|---|---|---|---|
| Text | `(value, style?)` | — | `textStyle`, `fontWeight`, `color`, `textAlign`… | `<Text textStyle="body-md" color="fg.muted">hi</Text>` |
| Heading | `(value, style?)` | `as: h1–h6` | `textStyle` (display/heading) | `<Heading as="h2" textStyle="heading-md">Title</Heading>` |
| Code | `(value, style?)` | — | `variant: subtle\|surface\|outline` | `<Code variant="subtle">x = 1</Code>` |
| Mark | `(value, style?)` | — | (highlight) | `<Mark>term</Mark>` |
| Link | `(value, href, style?)` | — | — | `<Link href="/docs">Docs</Link>` |
| Highlight | `(value, query, style?)` | — | — | `<Highlight query="east">east-ui rocks</Highlight>` |
| List | `(items, style?)` | ordered? | — | `<List>{items.map(i => <Text>{i}</Text>)}</List>` |
| CodeBlock | `(code, style?)` | `language`, `showLineNumbers` | — | `<CodeBlock language="ts">{src}</CodeBlock>` |
| Note | `(body, style?)` | — | — | `<Note>callout</Note>` |
| Numeric | `(value, style?)` | `format`, `sentiment` | tabular-nums, colour | `<Numeric value={n} format="percent" />` |
| Kbd | `(keys[], style?)` | — | `variant`, `size` | `<Kbd>{["⌘","K"]}</Kbd>` |

> Link/Highlight/CodeBlock are **multi-arg** → extra args become props
> (`href`/`query`/`language`).

### 5.3 Buttons (shape 3 — `onClick`/state top-level, visual under `options.style`)

| Component | `.Root` | Behavior | State | Style (nested) | JSX |
|---|---|---|---|---|---|
| Button | `(label, options?)` | `onClick` | `loading`, `disabled`, `loadingText`, `startIcon`, `endIcon` | `variant: solid\|subtle\|outline\|ghost\|plain`, `colorPalette`, `size`, `hoverBackground` | `<Button onClick={save} loading={busy} variant="solid" colorPalette="blue">Save</Button>` |
| IconButton | `(prefix, name, label, options?)` | `onClick` | `loading`, `disabled` | same | `<IconButton prefix="fas" name="trash" label="Delete" onClick={del} variant="ghost" />` |
| CopyButton | `(value, options?)` | — | `label`, `timeout`, `disabled` | `variant`, `successColor` | `<CopyButton value={token}>Copy</CopyButton>` |
| CloseButton | `(options?)` | `onClick` | `label`, `disabled` | `variant`, `size` (no colorPalette) | `<CloseButton onClick={close} />` |
| Toggle | `(label, pressed, options?)` | `onChange` | `pressed`, `disabled`, `icon` | `variant`, `pressedBackground` | `<Toggle pressed={on} onChange={setOn}>Bold</Toggle>` |
| ButtonGroup | `(buttons[], options?)` | — | — | `attached`, `gap` | `<ButtonGroup attached>{…buttons}</ButtonGroup>` |

### 5.4 Forms (shape 2 — flat bag: callbacks + state + style siblings)

| Component | `.Root` | Behavior | State / config | Key style enums |
|---|---|---|---|---|
| Input.String/Integer/Float/DateTime | `(value, style?)` | `onChange(T)`, `onBlur`, `onFocus` | `placeholder`, `min/max/step`, `maxLength`, `pattern`, `precision`, `disabled` | `variant: outline\|subtle\|flushed`, `size` |
| Checkbox | `(checked, style?)` | `onChange(bool)` | `label`, `indeterminate`, `disabled` | `colorPalette`, `size` |
| Switch | `(checked, style?)` | `onChange(bool)` | `label`, `disabled` | `colorPalette`, `size` |
| Slider | `(value, style?)` | `onChange(f)`, `onChangeEnd(f)` | `min`, `max`, `step`, `disabled` | `orientation`, `variant: outline\|subtle`, `colorPalette`, `size` |
| Textarea | `(value, style?)` | `onChange`, `onBlur`, `onFocus` | `placeholder`, `rows`, `maxLength`, `autoresize`, `disabled`, `invalid` | `variant`, `resize: none\|vertical\|horizontal\|both`, `size` |
| TagsInput | `(value[], style?)` | `onChange([str])`, `onInputChange` | `max`, `editable`, `delimiter`, `addOnPaste`, `disabled`, `placeholder` | `variant`, `colorPalette`, `size` |
| Select | `(value, items, style?)` + `.Item(value,label,style?)` | `onChange(str)`, `onChangeMultiple([str])`, `onOpenChange` | `placeholder`, `multiple`, `disabled` | `size` |
| Combobox | `(value, items, style?)` + `.Item` | `onChange`, `onChangeMultiple`, `onInputValueChange`, `onOpenChange` | `placeholder`, `multiple`, `allowCustomValue`, `disabled` | `size` |
| RadioGroup | `(value, items[], style?)` | `onChange(str)` | item `{value,label?,disabled?}`; `name`, `required` | `colorPalette`, `size`, `orientation` |
| RadioCardGroup | `(value, items[], style?)` | `onChange(str)` | item `{value,label,description?,disabled?}` | `colorPalette`, `size`, `orientation` |
| FileUpload | `(style?)` | `onFileAccept([file])`, `onFileReject` | `accept`, `maxFiles`, `maxFileSize`, `directory`, `dropzoneText`, `disabled` | `variant`, `size` |
| Field | `(label, control, style?)` + `.StringInput/.Checkbox/.Select/…` | (wrapped control's) | `helperText`, `errorText`, `required`, `invalid`, `readOnly` | `orientation` |
| TimeScaleControl | `(value, style?)` | `onChange(scale)` | `availableScales`, `disabled` | `variant: solid\|outline\|subtle`, `colorPalette`, `size` |
| TimeRangeInput | `(start, end, style?)` | `onChange(int,int)` | `min`, `max`, `step`, `presets` | `variant`, `size` |
| DateRangeInput | `(start, end, style?)` | `onChange(dt,dt)` | `min`, `max`, `precision`, `presets` | `variant`, `size` |

JSX examples:
```tsx
<Slider value={v} onChange={setV} min={0} max={100} step={5} colorPalette="blue" />
<Input.Float value={qty} onChange={setQty} min={0} placeholder="qty" variant="subtle" />
<Field label="Email" required helperText="work address">
  <Input.String value={email} onChange={setEmail} />
</Field>
```
> **Naming decision (§8):** `Input` has no `.Root` — tags are `<Input.String/>`,
> `<Input.Float/>`, etc. (or add `<Input>` ≙ `Input.String`).

### 5.5 Display

| Component | `.Root` | Behavior | State | Style loc / key enums |
|---|---|---|---|---|
| Badge | `(value, style?)` | — | — | flat 2nd · `variant: solid\|subtle\|outline`, `colorPalette`, `size` |
| Tag | `(label, style?)` | `onClose` | `closable` | flat 2nd · `variant`, `colorPalette`, `size: sm\|md\|lg\|xl` |
| Avatar | `(options?)` | — | `src`, `name` | bag · `variant`, `colorPalette`, `size` |
| AvatarGroup | `(avatars[], options?)` | — | `max` | bag · `size`, `borderColor` |
| Stat | `(label, value, options?)` | — | `helpText`, `baseline`, `delta`, `info`, `indicator{direction,sentiment,icon}`, `format` | bag · `size`, color slots |
| Icon | `(prefix, name, style?)` | — | `label` (a11y) | 3rd arg · `size: …\|2xl`, `variant: solid\|regular\|light\|thin\|brands`, `colorPalette` |
| MetricChip | `(value, tone, options?)` | — | `unit`, `icon`; `tone: positive\|negative\|neutral\|info` | bag · `emphasis: subtle\|solid\|outline`, `size` |
| EditableChip | `(label, options?)` | `onClick` | `trigger` (icon), `disabled` | bag · `size`, color slots |
| Kbd | `(keys[], style?)` | — | — | flat 2nd · `variant`, `size`, `colorPalette` |
| Meter | `(value, options?)` | — | `max`, `label`, `tone` | bag · `thickness: xs\|sm\|md\|lg`, `showValue` |
| SegmentedMeter | `(segments[], options?)` | — | `max`, `caption`; seg `{value,tone,color,label}` | bag · `thickness`, `labels: inside\|outside\|none` |
| BarStrip | `(items[], options?)` | — | `showValues`, `sort: asc\|desc\|none`, `maxItems`; item `{label,value,tone,color,trailing}` | bag · `orientation`, `thickness` |

```tsx
<Stat label="Revenue" value={rev} indicator={{ direction: "up", sentiment: "positive" }} format="currency" />
<Tag closable onClose={() => remove(id)} colorPalette="purple">{name}</Tag>
<Meter value={used} max={total} tone="warning" thickness="sm" />
```

### 5.6 Feedback (shape 2)

| Component | `.Root` | Behavior | State | Key enums |
|---|---|---|---|---|
| Progress | `(value, options?)` | — | `min`, `max`, `label`, `valueText`, `indeterminate`, `showValue`, `estimatedDuration`, `startedAt` | `variant: outline\|subtle`, `tone: brand\|pos\|neg`, `size`, `striped`, `animated` |
| Banner | `(status, title, options?)` | `onDismiss` | `description`, `actions`, `dismissible`, `showIcon`, `icon`; `status: info\|warning\|success\|error\|neutral\|change\|guard\|stale` | `variant`, `size` |
| EmptyState | `(title, options?)` | — | `description`, `actions`, `icon`, `glyph` | `size` |
| Skeleton | `(shape, options?)` | — | `shape: text\|rect\|circle`, `lines`, `count` | `width`, `height`, `shimmerColor` |
| Status | `(label, options?)` | — | `value: success\|warning\|danger\|info\|neutral`, `pulsing`, `showIcon`, `icon` | `size` |

```tsx
<Progress value={pct} max={100} striped animated tone="brand" label="Uploading…" />
<Banner status="warning" title="Heads up" description="Disk almost full" dismissible onDismiss={ack} />
```

### 5.7 Navigation

| Component | `.Root` | Behavior | Item shape |
|---|---|---|---|
| Breadcrumb | `(items[], style?)` | item `onClick` | `{label, current?, onClick?}`; style `runAnchor` |
| NavList | `(sections[], style?)` | `onSelect(key)` | section `{label?, items}`; item `{key, label, icon?, badge?, active?}` |

```tsx
<Breadcrumb>{trail.map(c => <Breadcrumb.Item current={c.current} onClick={c.go}>{c.label}</Breadcrumb.Item>)}</Breadcrumb>
<NavList onSelect={goTo}>{/* Section/Item sub-tags */}</NavList>
```

### 5.8 Disclosure — compound (shape 5; see §6.1)

`Accordion`, `Tabs`, `SegmentGroup`, `OptionList`, `Carousel`, `Collapsible`.
All: `value`/`defaultValue` + `onValueChange`/`onChange`/`onOpenChange`/`onIndexChange`.

| Component | Root opts (key) | Item sub-tag |
|---|---|---|
| Tabs | `value`, `defaultValue`, `onValueChange`; style `variant: line\|plain`, `orientation`, `fitted`, `justify`, `colorPalette` | `<Tab value title disabled>{body}</Tab>` |
| Accordion | `multiple`, `collapsible`, `value[]`, `onValueChange`; `variant: enclosed\|plain\|subtle` | `<Accordion.Item value title meta disabled>{body}</Accordion.Item>` |
| SegmentGroup | `value`, `onChange`; `size`, `colorPalette`, `orientation` | `<SegmentGroup.Item value disabled>label</SegmentGroup.Item>` |
| OptionList | `selectedId`, `onSelect` | `<OptionList.Option id description trailing disabled>label</…>` |
| Carousel | `index`, `onIndexChange`, `loop`, `autoplay`, `slidesPerView`, `showControls` | plain element children |
| Collapsible | `defaultOpen`, `onOpenChange` (trigger+content) | `trigger={…}` prop + content children |

### 5.9 Overlays — trigger + body (shape 4; see §6.2)

`Dialog`, `Drawer`, `Popover`, `HoverCard`, `Tooltip`, `Menu`, `ToggleTip`,
`ActionBar`. All take `trigger` + body/content; the style arg is a rich bag with
`onOpenChange` (+ `onExitComplete`/`onEscapeKeyDown`/`onInteractOutside` on
Dialog), `open`/`defaultOpen`, config (`modal`, `closeOnEscape`, …), and visual
`size`/`placement` (12-pt)/`motionPreset`/`role`.

```tsx
<Dialog trigger={<Button>Delete</Button>} role="alertdialog" eyebrow="IRREVERSIBLE"
        title="Delete project?" size="sm" onOpenChange={track}>
  <Text>This can't be undone.</Text>
</Dialog>
<Tooltip content="Copy to clipboard" placement="top"><IconButton …/></Tooltip>
<Menu trigger={<Button>Actions</Button>}>
  <Menu.Item value="dup">Duplicate</Menu.Item>
  <Menu.Separator/>
  <Menu.Item value="del" disabled={locked}>Delete</Menu.Item>
</Menu>
```

### 5.10 Collections — data-driven (shape 6; see §6.3)

| Component | `.Root` | Notable opts/callbacks |
|---|---|---|
| Table | `(rows, columns, options?)` + `.Column(key,…)` | `pagination{pageSize,page,onPageChange}`, `selection{mode,selected,onChange}`, column `render(ctx)`, events: cell/row click, sort |
| DataList | `(items, style?)` | item `{label, value}` |
| Matrix | `(rows, columns, options?)` + `.cell/.segment/.marker/.legend` | data-driven grid |
| Pagination | `(page, pageSize, count, onPageChange, options?)` | `siblings`, `boundaries`, `variant`, `size` |
| TreeView | `(nodes, options?)` + `.Item/.Branch` | nested `Item`/`Branch` |
| Gantt | `(rows, columns, options?)` + `.task/.milestone` | timeline |
| Planner | `(rows, columns, axis, options?)` + `.event/.axis*/.slot*` | schedule |

```tsx
<Table data={rows} columns={cols}
       pagination={{ pageSize: 25n, page, onPageChange: setPage }}
       selection={{ mode: "multiple", selected: sel, onChange: setSel }} />
<Pagination page={page} pageSize={25n} count={total} onPageChange={setPage} />
```

### 5.11 Charts (shape 5 — layer children; see §6.4)

`Chart.Root(rows, layers, options?)` with typed **accessors** (scale inferred
from the accessor's East type). Layer sub-factories: `Line/Bar/Area/Scatter/
Band/refLine/refBand/refDot`. `Sparkline(data[], style?)` is a leaf.

```tsx
<Chart data={series}>
  <Chart.Line x={r => r.t} y={r => r.value} color="blue" curve="monotone" />
  <Chart.Bar  x={r => r.t} y={r => r.count} axis="right" />
  <Chart.RefLine y={threshold} />
</Chart>
<Sparkline data={points} type="area" color="green" />
```

---

## 6. Compound patterns (detail)

### 6.1 Item-children (`itemsParent`)
Parent's non-items args (`value`, options) → props; item sub-tags → children
(static / East `.map` / mixed per §3). Sub-tag → existing `.Item`/`.Option`
factory (item structs already surveyed). New thin aliases optional (§7).

### 6.2 Trigger + body (`triggerBody`)
`trigger={<El/>}` slot prop (single element); body = children; everything else
(callbacks/state/visual) = flat props folded into the style/opts arg.
- **Open question (§8):** `trigger=` prop (lean) vs `<Dialog.Trigger>` sub-tag.

### 6.3 Structured tables — `data=` vs `<Table.Row>` markup
Default is data-prop driven (and the only option for runtime/dynamic rows):
`<Table data={rows} columns={cols} …/>`. The proposed **markup mode** for
static tables:
```tsx
<Table>
  <Table.Column key="name">Name</Table.Column>
  <Table.Column key="qty" render={ctx => <Badge>{ctx.value}</Badge>}>Qty</Table.Column>
  <Table.Row><Table.Cell>Widget</Table.Cell><Table.Cell>{n}</Table.Cell></Table.Row>
</Table>
```
Needs **new** `Table.Row(cells)`, `Table.Cell(value, content?)`,
`Table.Column(key,…)` factories + parent assembly of rows/columns. Static only;
dynamic stays `data=`. (Same question for Matrix/Gantt/Planner.)

### 6.4 Chart layers
Layer factories already return layer values → wrap as children. Accessors are
plain TS arrows `r => r.field` returning East field expressions.

### 6.5 Card (compound container)
`Card.Root(children, options?)` plus `Card.Header/.Title/.Description/.Body/
.Footer/.Section/.Actions`. JSX:
```tsx
<Card state="ready">
  <Card.Header><Card.Title>Sales</Card.Title><Card.Description>Q3</Card.Description></Card.Header>
  <Card.Body>{chart}</Card.Body>
  <Card.Footer><Card.Actions>{buttons}</Card.Actions></Card.Footer>
</Card>
```

---

## 7. New east-ui factories proposed

All **additive**; no breaking changes. Most sub-factories already exist (wrap
directly): `Accordion.Item`, `SegmentGroup.Item`, `OptionList.Option`,
`Menu.Item/.Separator`, `ActionBar`/`Action`, `TreeView.Item/.Branch`,
`Grid.Item`, `Splitter.Panel`, `Select.Item`, `Combobox.Item`, `Chart.*`,
`Gantt.task/.milestone`, `Matrix.*`, `Card.*`, `Stat.Indicator`.

- **Thin aliases (optional, tag-matching names):** `Tabs.Tab`, `Select.Option`, `Combobox.Option`.
- **Genuinely new (items are JS objects / no item factory today):** `RadioGroup.Item`, `RadioCardGroup.Item`, `DataList.Item`, `Breadcrumb.Item`, `NavList.Section`/`.Item`.
- **Table markup mode (biggest):** `Table.Row`, `Table.Cell`, `Table.Column` (± Matrix/Gantt/Planner equivalents).

---

## 8. Decisions needed for sign-off

Resolved (your steers): all four tiers; TS+East mix freely in props & children;
dynamic item lists are East `.map` children, not an `items=` prop.

Open:
1. **`<Table.Row>` markup mode** — build alongside `data=` (new `Table.Row/.Cell/.Column`), or keep tables `data=`-only? Same Q for Matrix/Gantt/Planner.
2. **Children coalescing (§3d)** — support interleaving TS-static + East `.map` in one parent (East-array-aware concat), or restrict to "all-static OR one East map"?
3. **Trigger slot** — `trigger={<El/>}` prop (lean) vs `<Dialog.Trigger>` sub-tag.
4. **Sub-tag naming** — namespaced `<Tabs.Tab>`/`<Select.Option>` (proposed) vs bare `<Tab>`/`<Option>`.
5. **Alias factories** — add `Tabs.Tab`/`*.Option`, or map those tags onto existing `.Item`?
6. **`Input`/`Field` tags** — `<Input.String/>`/`<Input.Float/>` (matches factory) or add a default `<Input/>` ≙ `Input.String` + typed variants?
7. **Style prop depth** — expose the *full* box-like style vocabulary on every container tag (big autocomplete surface), or curate a common subset + an escape-hatch `style={{…}}` for the long tail?
8. **Flat vs nested style for shape-3 components** (Button/Card/overlays) — keep flat JSX props with wrapper-side splitting (proposed), or mirror the factory's nested `style` object in JSX?
