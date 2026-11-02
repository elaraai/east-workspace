# Record indexes

Secondary, interval and area, series and summary, and nested series indexes: what each files, how it is read, and what it costs. Part of the `e3` skill.

## Contents

- Secondary indexes — `index.on([...fields])`, `index.key(fn)`, `index.keys(fn)`
- Interval and area indexes — `index.interval`, `index.area`
- Series and summary indexes — `index.series`, `index.summary`
- Nested series indexes — `index.nested`

## Secondary indexes — `index.on([...fields])`, `index.key(fn)`, `index.keys(fn)`

A second collection over a Dict record, in another sort order, maintained in the
same commit, so a view by an attribute is a page rather than a scan.
`index.on([...])` names row fields in index order: one field uses its value as
the key, several use a Struct in that order, and a Set field gives an entry per
element. It also carries field metadata for `Data.bindPaged(record, { indexes })`
and `Slice.bindRecord` (see **e3-ui**). `index.key(fn)` gives one computed entry
per row; `index.keys(fn)` returns a Set, one entry per element (a row naming five
resources appears five times, an empty set not at all); the `value` option of
each is a projection a view renders without touching the record. The functions
are pure and synchronous, since an index maintained commit by commit must equal
its rebuild to the byte. Its name — its key in `indexes` — is an identifier,
never `primary` (the record's own order). Read through one with `index=<name>` on a page or key search; `e3
reindex` rebuilds. A deploy builds an index the package declares and the state
lacks, drops one it no longer declares, and runs nothing for the rest; a build
is a split task over the record.

```typescript
const plans = e3.record('plans', PlansType, {
  initial: new Map(),
  indexes: (index) => ({
    by_due: index.on(['due']),
    by_owner_due: index.on(['owner', 'due']),
    by_owner: index.key(East.function([StringType, PlanType], StringType, ($, _id, plan) => plan.owner), {
      value: East.function([StringType, PlanType], StringType, ($, _id, plan) => plan.title),
    }),
    by_resource: index.keys(East.function([StringType, PlanType], SetType(StringType), ($, _id, plan) => plan.resources)),
  }),
  mutations: (mutation) => ({ /* add_plan, reschedule, patch — above */ }),
});
const pkg = e3.package('planning', '1.0.0', plans);   // the record whole: its indexes and mutations with it
```

## Interval and area indexes — `index.interval`, `index.area`

These indexes answer more than an order — as do the series and summary indexes
below — each with a builder method of its own whose keys the SDK generates.
Underneath each is an ordinary index — the same build,
mutation, storage, paging and `e3 reindex` — and the record Slice reads a
window through either (see **e3-ui**). Their generated keys are query
machinery: edits and sessions always target the record's primary key.

A generated key is a struct whose own fields are e3's: `on` holds the
declaration's leading fields, by their names, at their key types (a Set field's
element type) — a struct with no fields when it lists none — and the kind's own
parts sit beside it. So no name is reserved: a row may name a field anything,
`area`, `tile` and `__area` among them, and an index may be led by it.

| Index | Key | e3's parts |
|---|---|---|
| interval | `{ on, node, at }` | the tree node an entry is filed at; the instant it is ordered by, at the `from` field's type |
| area | `{ on, area }` | the cell's Morton code times 32 plus its level; −1 for a row not yet placed |
| series | `{ on, key, level, tile }` | the value of the field `key` names; the level an event is filed at, and the start of that level's tile (#1433) |
| summary | `{ on, key, tile }` | the value of the field `key` names; the tile's start |

A definition's `on` is the leading fields alone; its kind's options say the
rest (`events.indexes.by_time.interval`, `racks.indexes.racks_by_area.area`,
`jobs.indexes.jobs_by_press_week.series`).

**`index.interval({ on?, from, to })`** keeps events visible while they
overlap a selected time window. `from` and `to` are the row's DateTime or
Option<DateTime> fields; optional `on` fields are exact leading choices:

```typescript
const events = e3.record('events', EventsType, {
  initial: new Map(),
  indexes: (index) => ({
    by_time: index.interval({ from: 'start', to: 'end' }),
    by_status_time: index.interval({ on: ['status'], from: 'start', to: 'end' }),
  }),
});
```

Its key is `{ on, node, at }`. It stores at most three entries per event per
leading-field combination, independent of duration. The record Slice adapter resolves a half-open
`[from, to)` window with at most 55 disjoint bounded queries per exact prefix;
each matching original record occurs once, including events that started
earlier or span the whole window. It never scans the record or guesses a
maximum duration. An event ending at `from` is outside; an instant at `from`
is inside and one at `to` is outside. A missing or non-positive end is an
instant. A missing start remains selectable as Unset/backlog.

Use `on: ['start']` only when the intended query is **starts within**, since it
cannot preserve carry-in events. When both declarations are available, a Slice
range on the start field uses the interval declaration. The generated interval
keys are query machinery; record edits and sessions always target the original
primary key. Calendar's `Calendar.events(binding, { slice, entries, … })`
requires a matching interval declaration and the primary `entries` binding to
confirm saves even after an edit leaves the selected window.

**`index.area({ on?, x, y, width?, height?, at?, cell })`** reads the rows
whose box meets a 2D window — what a floor plan's viewport shows — the interval
index's twin:

```typescript
// RacksType: Dict<String, { hall: String, x: Option<Float>, y: Option<Float>, w: Float, h: Float }>
const racks = e3.record('racks', RacksType, {
  initial: new Map(),
  indexes: (index) => ({
    racks_by_area: index.area({ x: 'x', y: 'y', width: 'w', height: 'h', at: 'centre', cell: 0.01 }),
    racks_by_hall_area: index.area({ on: ['hall'], x: 'x', y: 'y', width: 'w', height: 'h', at: 'centre', cell: 0.01 }),
  }),
});
```

| Option | The box's |
|---|---|
| `x`, `y` | place: two Float fields, or two Option<Float> fields whose `none` is a row not yet placed |
| `width`, `height` | size: two Float fields, or neither for a point |
| `at` | `'corner'`, the default — `x`, `y` is the box's minimum corner, as a zone's is — or `'centre'`, as an item's is |
| `cell` | finest cell: its side in world units, about the smallest thing drawn — 0.01 for a floor in metres, 1 for one in millimetres. It is rounded down to a power of two, so the keys' arithmetic is exact on every runtime, and has no default: a wrong one costs a silent tenfold read |
| `on` | exact leading fields, as the interval index's; a Set field fans out |

Each option takes only the row's fields of its type, so a wrong one does not
compile, and the definition checks them again, naming the option, the field and
its type. The domain is the square ±`cell`·2²⁷ world units around zero
(±1,048 km at a 0.01 cell, which rounds to 2⁻⁷), in 29 levels. Each row is
filed once, under the deepest level whose cell is at least twice its box's
larger side, in the cell holding its box's centre: the key
`{ on, area: Integer }`. A row not yet placed files under `area` −1, which the
record Slice reads as the unplaced clause; one outside the domain, not finite,
or larger than half of it files under the root, which every window reads. The index **carries its rows**: each
entry's projection is the whole row, so a window reads the index alone and no
record segment, and it takes no `value`. The record Slice reads a viewport,
grown by an eighth of its larger side on each side, as at most 266 disjoint
searches per exact prefix, sent in one request, which together hold every row
whose box meets it, each once — beside rows of the cells searched that it
misses, which the reader draws or not.

## Series and summary indexes — `index.series`, `index.summary`

What a planning board reads: the events on a block of keys — a Plan's
resources — over a span of time, and, zoomed out past what a screen can draw,
how busy each key is. Both file a row's event by the key it is on and by time
tiles — `day`, `week` (ISO, from Monday), `month`, `quarter` or `year`, in UTC,
half-open — the key before the time, so a key's entries over any span are
contiguous: a series index's `{ on, key, level, tile }`, a summary index's
`{ on, key, tile }`.

```typescript
// JobsType: Dict<String, { press: String, start: Option<DateTime>, end: Option<DateTime>, … }>
const jobs = e3.record('jobs', JobsType, {
  initial: new Map(),
  indexes: (index) => ({
    jobs_by_press_week: index.series({ key: 'press', from: 'start', to: 'end', tile: 'week' }),
    jobs_by_press_month: index.summary({ key: 'press', from: 'start', to: 'end', tile: 'month' }),
  }),
});
```

| Option | |
|---|---|
| `key` | the field naming what an event is on: any field but a Set |
| `from`, `to` | the event's start and end: DateTime or Option<DateTime> fields. A row with no start is filed nowhere; no end, or one at or before the start, is an instant |
| `tile` | a series index's finest level, and a summary index's tile: `day`, `week`, `month`, `quarter` or `year` |
| `on` | exact leading fields, before the key; a Set field fans out |

**A series index** is an ordinary index whose keys the SDK generates, and it
**carries its rows**, as the area index does. It files each event **once**, at
the finest level from its `tile` up to the year whose shortest tile holds the
event's length — a day, a week, 28 days, 90 days, 365 days — under that level's
tile holding its start; an instant at `tile`; past 365 days, under each year it
touches. An event filed at a level ends within the tile after the one holding
its start, so a reader reads a block of keys over any span from the index alone
as one range a key a level — that level's tiles from two before the span to one
after it — in one request, whatever the span's width. **A summary index** holds,
under each key and tile, `{ count, ms }`: how many rows touch the tile, and the
milliseconds of it they cover — a row's shares
add up to its length, and an instant's is none. Each entry stands for every row
of its key and names none, so its window's `key` is Null, a read of it joins
nothing, and a read that needs its rows — a joined read, a placement
(`datasetPlace`) or a membership read (`datasetWithin`) — is refused, naming the
index; the record's describe says it is a summary. A write
changes its totals by what its rows took away and gave — its program reads the
record, never the summary — and the apply adds that to each total, dropping one
whose count reaches zero; the totals are Integers, so a maintained summary is the
one `e3 reindex` sums, byte for byte, and a build split into pieces adds the
pieces' totals of a key. A change that would leave a total no rebuild sums — a
count below zero, or time with no row — fails the write, naming the total and
`e3 reindex`, which rebuilds it; a total past the largest Integer fails the
write or the build, naming a finer tile.

A series index files an event past a year under each year it touches, as many
as 4,096: one touching more is refused where it is written, naming it and its
span. A summary splits an event over its tiles, as many as 4,096 — eleven years
of days — and one touching more is refused the same way, naming the tile:
declare a coarser tile. Each option takes only the row's fields of its type, as
the area index's do, and the definition checks them again; a `value` is
refused, and so is an `on` field that is the key, the start or the end: the key
follows the leading fields, and the tiles are cut by the start and the end.

## Nested series indexes — `index.nested`

What a planning board reads when a record's rows nest what it draws: a
machine's jobs and its load a day at a time, a hall's members, an assembly's
parts to any depth. One declaration a record lists every collection its rows
nest, each field with a builder saying what it holds. e3 files each item apart
from its row — once, by its collection, its row, its node and its time — keeps
each node's totals a summary tile at a time, and each parent's subtotals at
every level; and the record's other indexes carry the rows without those
collections, so a page of rows reads none of them and a window of items reads
no row.

```typescript
// MachinesType: Dict<String, { name, site, status, jobs: Dict<String, Job>, load: Dict<DateTime, Float> }>
const machines = e3.record('machines', MachinesType, {
  initial: new Map(),
  indexes: (index) => ({
    machines_in_time: index.nested({
      collections: {
        jobs: index.nested.items({ from: 'start', to: 'end' }),  // things people drag: by id, their times fields
        load: index.nested.values(),                              // a value per instant: keyed by the instant
      },
      tile: 'week',
      summary: 'month',
    }),
    machines_by_site: index.on(['site']),                         // pages each machine without its jobs and load
  }),
});
// Each member's load, and each hall's mean of its members', at every level from the day up.
const halls = e3.record('halls', HallsType, {
  indexes: (index) => ({
    halls_in_time: index.nested({
      collections: { members: index.nested.rows({ load: index.nested.values({ rollup: 'mean' }) }) },
      tile: 'day',
      summary: 'month',
    }),
  }),
});
// Parts to any depth, each part's jobs filed under every part above it too.
const assemblies = e3.record('assemblies', AssembliesType, {
  indexes: (index) => ({
    assemblies_in_time: index.nested({
      collections: {
        parts: index.nested.rows({
          jobs: index.nested.items({ from: 'start', to: 'end' }, { rollup: true }),
          parts: index.nested.recursive(),
        }),
      },
      tile: 'week',
      summary: 'month',
    }),
  }),
});
```

| Builder (`index.nested.…`) | A field holding |
|---|---|
| `items({ from, to })`, `items({ at })` | `Dict<String, Struct>`: things people drag, by id; their times are DateTime or Option<DateTime> fields — no start files an item nowhere, no end (or one at or before its start) makes it an instant. `{ rollup: true }` files each under every ancestor too |
| `values({ rollup? })` | `Dict<DateTime, V>`: a value per instant. `rollup` keeps every parent's subtotals |
| `rows({ … })` | `Dict<String, Struct>`: child rows, their own collections declared the same way |
| `recursive()` | `Dict<String, Self>`: more rows like the one listing it, to any depth |

TypeScript types `collections` field by field from the record's type alone: a
misnamed time, or a builder on the wrong kind of field, is an error where it is
written, and its message says what fits. The definition checks the same again,
in words, for a declaration TypeScript could not see. A record has one nested
series index, which takes no `on` and no `value`.

**What it files.** Every entry is keyed `{ collection, row, path, run, level,
tile, item }` (e3-types' `NestedEntryKeyType`): the collection's place, the
field names from the row down (`members` then `load`); the row's key; the Dict
keys from the row down to the node (`[]` for the row, `m-3` for a member); the
run; the level and tile; and the item. A place and a path are held as a key
holds a list, folded from the last: `.step (key="members", rest=.step
(key="load", rest=.end))`. Each run of a node is one contiguous range a level:

| Run | Holds |
|---|---|
| `items` | each item once, as a series index files an event — at the level its length fits, past a year under each year — carrying it (`.item .jobs (…)`); a value, and an `{ at }` item, at the declared tile alone |
| `totals` | where `summary` is declared, each node's `{ count, ms, values }` a summary tile at a time; for a Float or Integer collection, `values` is the sum, the least, the greatest and the last there, taken in key order |
| `subtotals(rollup)` | for `values({ rollup })`, every parent's subtotal by each rollup at each level from `tile` to the year, where a descendant's value touches the tile: a node holding values folds its own, a parent aggregates its children's, in key order |
| `subtree`, `subtreeTotals` | for `items(…, { rollup: true })`, each item under every ancestor too, `.under (path, id)`, and each ancestor's totals of them |

A rollup is `'sum'`, `'mean'` (a mean of means up the tree), `'min'`, `'max'`,
`'count'` (the leaf rows beneath that hold a value), a fold and an aggregate
named apart (`{ fold: 'last', aggregate: 'sum' }`, a balance), or several.

**Reading.** A reader searches the index's leading fields — `[collection, row,
path, run, level, tile]`, each as East prints it — as a range a row a level: a
block of fifty machines' jobs over three weeks is fifty times four ranges in one
`datasetFindKeys` request, and one `datasetGetRuns` read of the entries they
select, each job carried whole; a parent's week subtotals are one range; a
part's subtree is one range a level.

**The lean rows.** Beside a nested series index, every other index of the
record that carries nothing or the row carries the row without the listed
collections — each listed collection empty, child rows kept with theirs empty —
so a page of rows read without a join reads no nested item and no segment of
the record's own. An index with a `value` of its own carries its own. A
binding of the record's indexes lists the nested index by name beside any that
carry the lean rows — `Data.bindPaged(machines, { indexes: ['machines_by_site',
'machines_in_time'] })` (see **e3-ui**).

**Its span.** Beside every nested series index e3 keeps its span, an index of
the record's named `<index>_span` (e3-types' `nestedSpanName`), built with it
and never declared: under each collection's place and each month its items or
values touch (`NestedSpanKeyType`, `{ collection, tile }`), how many of them
touch it and the milliseconds of it its items cover, summed across the rows as a
summary index's totals are, and a month let go once nothing touches it. A
collection's first and last month held are its span across the record — what a
Plan's horizon covers for the series reading it — and its months' counts are
how much it holds in each, which the horizon's strip draws as its bars (see
**e3-ui**). Reading it is one search a collection, an exact match on its
place, and one read of the first and last entry of each. An index the record
declares under that name is refused.

**Writes.** A row a write updates by a patch is maintained by the patch: e3
walks it along the declaration — each collection's Dict patch, and each child
rows' — and compares the entries of only the items it names, with the totals of
the summary tiles they touch and the subtotals of the tiles they touch at each
level. A replace on the way, which a recursive type's patch always is, and an
inserted or deleted row are compared whole. Both ways give the same delta, and a maintained
index is the one `e3 reindex` rebuilds, byte for byte.
