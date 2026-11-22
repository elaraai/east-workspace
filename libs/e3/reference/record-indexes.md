# Record indexes

Secondary, interval and area, series and summary, nested series, and entries indexes: what each files, how it is read, and what it costs. Part of the `e3` skill.

## Contents

- Secondary indexes — `index.on([...fields])`, `index.key(fn)`, `index.keys(fn)`
- Interval and area indexes — `index.interval`, `index.area`
- Series and summary indexes — `index.series`, `index.summary`
- Nested series indexes — `index.nested`
- Entries indexes — `index.entries(field)`
- Reading an index inside a task or a function — `e3.index(record.indexes.<name>)`, and a reader for each kind: `of`, `between`, `overlapping`, `events`, `totals`, `within`

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
| series | `{ on, key, level, tile }`; in time order, `{ on, level, tile, key, past }` | the value of the field `key` names; the level an event is filed at, and the start of that level's tile (#1433) |
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
    // The same events, each entry carrying what a tile draws of its job and no more:
    job_tiles_by_press_week: index.series({ key: 'press', from: 'start', to: 'end', tile: 'week' }, {
      value: East.function([StringType, JobType], JobTileType, ($, _id, job) => ({ press: job.press, title: job.title, start: job.start, end: job.end })),
    }),
  }),
});
```

| Option | |
|---|---|
| `key` | the field naming what an event is on: any field but a Set |
| `from`, `to` | the event's start and end: DateTime or Option<DateTime> fields. A row with no start is filed nowhere; no end, or one at or before the start, is an instant |
| `tile` | a series index's finest level, and a summary index's tile: `day`, `week`, `month`, `quarter` or `year` |
| `on` | exact leading fields, before the key; a Set field fans out |
| `order` | a series index's alone: `'key'` (the default), a key's events together; `'time'`, a tile's events together in their keys' order |

**A series index** is an ordinary index whose keys the SDK generates, and it
**carries its rows**, as the area index does. It files each event **once**, at
the finest level from its `tile` up to the year whose shortest tile holds the
event's length — a day, a week, 28 days, 90 days, 365 days — under that level's
tile holding its start; an instant at `tile`; past 365 days, under each year it
touches. An event filed at a level ends within the tile after the one holding
its start, so a reader reads a block of keys over any span from the index alone
as one range a key a level — that level's tiles from two before the span to one
after it — in one request, whatever the span's width.

Declared with a `value` beside its spec — `index.series({ … }, { value })`, as a
plain index takes one — each entry carries **what that gives of its row** in
the row's place: a struct holding the event's start and end under the row's
own names for them, which a reader tests a window by, beside whatever a view
draws an event from. A cell then holds a small part of each event, and the
rest of one is read by its key where it is opened. A write that changes
nothing the value gives leaves the index's entries as they are, and beside a
nested series index or an entries index it carries its own value, as a plain
index's does. A value that gives no struct, or one holding no DateTime start
or end under those names, is refused, naming what it gives.

Declared `order: 'time'`, a series index files the same entries with the tile
before the key, `{ on, level, tile, key, past }`: **a tile's events together,
in their keys' order**. In key order the events of a block of keys over a span lie
in the part of the index each key's whole history fills, a part a key however
narrow the span — so what a board's screen reads grows with its rows'
histories. In time order the events of a run of neighbouring keys over a span
are one range a level a tile, and what a screen reads is what it shows. Lead it
by the group the keys stand in, so a group's keys are neighbours:

```typescript
// A hall's jobs a week at a time, in their presses' order, each entry a tile:
job_tiles_by_hall_week: index.series({ on: ['hall'], key: 'press', from: 'start', to: 'end', tile: 'week', order: 'time' }, { value: tileOf }),
```

Its last leading fields are where its keys stand, outermost first. A Plan
whose rows nest under a group reads an event kind through one: listed in the
kind's source, it is read a block of rows at a time, the last leading field
filled with the key of the group the block's rows stand under — so that field
holds the group's key, at its type, or an Option of it — and a leading field
before it is the rail's to choose. A block is then one range a tile, from its
first row's key through its last. The events on no row, and a page whose rows
nest under no group, are read through a series index in key order listed
beside it; with none, a kind whose events may be on no row is read as one past
the event cap is, shaded from its summary index and never by its cells.

`past` is false in every entry, so a range's end that gives it true lies after
every entry of its key: a run of keys is read through its last one, whatever
their type — a search from `[…on, level, tile, first]` to `[…on, level, tile,
last, true]`, or in a task `entries.range({ from: { ik: { on, level, tile, key:
first } }, to: { ik: { on, level, tile, key: last, past: true } } })`.

One key's events are then no range, so its reader (below) reads every key's
under the leading fields and takes no `key`: declare an index in key order
beside it for a reader of one key. An `order` that is neither is refused,
naming the two, and so is a summary index's, which is filed by key.

**A summary index** holds,
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
the area index's do, and the definition checks them again; a summary index's
`value` is refused, as is a series index's written among its spec's fields
rather than beside them, and so is an `on` field that is the key, the start or
the end: the key follows the leading fields, and the tiles are cut by the start
and the end.

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
| `items({ from, to })`, `items({ at })` | `Dict<K, Struct>`: things people drag, by id, of any key type but a DateTime; their times are DateTime or Option<DateTime> fields — no start files an item nowhere, no end (or one at or before its start) makes it an instant. `{ rollup: true }` files each under every ancestor too |
| `values({ rollup? })` | `Dict<DateTime, V>`: a value per instant. `rollup` keeps every parent's subtotals |
| `rows({ … })` | `Dict<K, Struct>`: child rows, keyed by any type but a DateTime (a role, a number, a String), their own collections declared the same way. `rows({})` declares child rows that nest nothing in time: the index names them among its ids and files nothing of them |
| `recursive()` | `Dict<K, Self>`: more rows like the one listing it, to any depth, keyed as the rows listing it are |

TypeScript types `collections` field by field from the record's type alone: a
misnamed time, or a builder on the wrong kind of field, is an error where it is
written, and its message says what fits. The definition checks the same again,
in words, for a declaration TypeScript could not see. A record has one nested
series index, which takes no `on` and no `value`.

**What it files.** Every entry is keyed `{ collection, row, path, run, level,
tile, item }` (e3-types' `NestedEntryKeyType`): the collection's place, the
field names from the row down (`members` then `load`); the row's key; the child
rows' keys from the row down to the node (none for the row, `m-3` for a member);
the run; the level and tile; and the item. A place and a path are held as a key
holds a list, folded from the last: `.step (key="members", rest=.step
(key="load", rest=.end))`.

A child row's key and an item's id are held in their own types, never as text.
They are the index's **ids**: one variant with a case for each collection of
child rows and of items, named by its place's field names joined with a dot
(`members`, `members.tasks`), each holding that collection's key type. So a
member's path is `.step (key=.members "m-3", rest=.end)`, a job's item
`.id .jobs "j-0042"`, and a crew's hours by role, a variant, sit under
`.step (key=.hours .operator, rest=.end)`. Keys sort in their types' own order.
A declared field's name holds no dot.

Each run of a node is one contiguous range a level:

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

## Entries indexes — `index.entries(field)`

What a reader needs when a record's rows each hold a Dict of categories — a
station's figures by service — and it reads a few categories at a time. An
entries index files one Dict field of the rows entry by entry, each under its
own key and then the row's, carrying that key's value, so a key's entries
across the whole record are one contiguous range: a reader reads the keys it
picks as a range each, in one request, and reads no other key's entries and no
segment of the record's own. Each row stays one row, its categories nested in
it.

```typescript
// StationsType: Dict<String, { site: String, parcels: Integer, byService: Dict<String, { parcels: Integer, waiting: Integer }> }>
const stations = e3.record('stations', StationsType, {
  initial: new Map(),
  indexes: (index) => ({
    stations_by_service: index.entries('byService'),  // { ik: the service, k: the station } → that service's figures there
    stations_by_site: index.on(['site']),             // pages each station without its services
  }),
});
```

| | |
|---|---|
| **What it files** | `{ ik, k } → value`: once for each key the row's field holds, that key and the row's, carrying the key's value. A row whose field is empty files nothing. The field's key may be any type a Dict is keyed by — a String, a Struct, an Option — and its value any type |
| **Its definition** | keyed by the field's key and valued by its value (`stations.indexes.stations_by_service.keyType`, `.valueType`), its field as written beside them (`.entries.field`), as an `on` index carries its fields: what a binding reads (see **e3-ui**) |
| **Reading** | a search of the index by a key, as East prints it — `{ key: '"Priority"' }` — finds the key's range: several keys are several searches in one `datasetFindKeys` request, then one `datasetGetRuns` read of the entries they select |
| **Several** | one entries index a Dict field: a record may declare one for each |
| **Refused, in words** | a field the rows lack, or one that is not a Dict, naming the fields that fit — TypeScript refuses both where they are written; a `value`, since each entry carries its own; a second entries index over a field; and one beside a nested series index: one kind of index files a record's nested fields |

**The lean rows.** Beside an entries index e3 keeps the record's rows by key,
each with the field emptied — the row's own type, as a nested series index's
lean rows are — in an index of the record's named `<index>_rows` (e3-types'
`entriesRowsName`), built with it and never declared, as a nested series
index's span is: a reader of the entries reads each row there without the
entries it reads apart. Each entries index's lean rows empty its own field
alone. The record's other indexes that carry nothing or the row carry it with
every field an entries index files emptied, so a page through them reads no
entry; an index with a `value` of its own carries its own, and the record's own
rows stay whole. An index the record declares under the lean rows' name is
refused.

**Writes.** A write changes the entries whose key or value it changed — a
row's entries before and after compared key by key: one gone a delete, one come
an insert, one whose value changed an update by the value's patch — and the
lean rows where it changed the row's other fields. After a patch, an edit or a
reduce alike, a maintained entries index, its lean rows and the indexes beside
them are what `e3 reindex` rebuilds, byte for byte.

## Reading an index inside a task or a function — `e3.index(record.indexes.<name>)`

A page reads an index through the API (`index=<name>`, `Data.bindPaged`). A
task, a stream task or a function reads one by taking it as an input:
`e3.index(record.indexes.<name>)` in its `inputs`. The body is given the
index's entries — the collection the record's state holds, `Dict<{ ik, k }, P>`,
opened lazily and frozen as any input is — where a body given the record gets
its rows in the record's own order, and reads every one to find a few.

```typescript
const JobType = StructType({ title: StringType, press: StringType });
const jobs = e3.record('jobs', DictType(StringType, JobType), {
  initial: new Map(),
  indexes: (index) => ({ jobs_by_press: index.on(['press']) }),
  mutations: (mutation) => ({ patch: mutation.patch() }),
});
const byPress = e3.index(jobs.indexes.jobs_by_press);

// A function: how many jobs a press holds, read from the index alone.
const jobsOnPress = e3.function('jobs_on_press', { inputs: [byPress], args: [StringType], output: IntegerType },
  ($, jobsByPress, press) => jobsByPress.prefix({ ik: press }).size());

// More of a row than the index carries: the record beside it, read by the entry's `k`.
const titlesOnPress = e3.function('titles_on_press', { inputs: [byPress, jobs], args: [StringType], output: DictType(StringType, StringType) },
  ($, jobsByPress, jobs, press) => {
    const titles = $.let(new Map(), DictType(StringType, StringType));
    $.for(jobsByPress.prefix({ ik: press }), ($, _carried, key) => { $(titles.insert(key.k, jobs.get(key.k).title)); });
    return titles;
  });

// A task takes it the same way. Its body's parameter is the input's type.
const watched = e3.input('watched', StringType, variant('value', 'P1'));
const watchedJobs = e3.task('watched_jobs', [byPress, watched],
  East.function([byPress.type, StringType], IntegerType, ($, jobsByPress, press) => jobsByPress.prefix({ ik: press }).size()));
```

**The entries.** `ik` is the index's key and `k` the row's, `ik` first, so
every entry of one index key is one contiguous run, in the record's key order,
and a range of index keys is one run too. `P` is what the index carries. The
input's `type` is the type the state holds, so a task's body declares its
parameter by it:

| Index | `ik` | `k` | Carries |
|---|---|---|---|
| `index.on(['press'])` | the field's value | the row's key | nothing (Null), or its `value` |
| `index.on(['press', 'due'])` | `{ press, due }` | the row's key | nothing, or its `value` |
| `index.key(fn)`, `index.keys(fn)` | what `fn` returns, or an element of its Set | the row's key | nothing, or its `value` |
| `index.entries('byService')` | the field's key | the row's key | that key's value |
| `index.interval`, `index.area`, `index.series` | the generated key above | the row's key | nothing for an interval; the row for an area or a series, or a series index's `value` |
| `index.summary` | `{ on, key, tile }` | Null: an entry stands for every row of its key | `{ count, ms }` |
| `index.nested` | `{ collection, row, path, run, level, tile, item }` | the row's key | the item, the totals or the subtotal |

It takes the indexes e3 keeps beside one as well: a nested series index's span
(`machines.indexes.machines_in_time.nested.span`, keyed `{ collection, tile }`,
its `k` Null) and an entries index's lean rows
(`stations.indexes.stations_by_service.entries.rows`). Beside a nested series
index or an entries index, an index that carries nothing or the row carries the
lean row. Its `type` says so, and so does TypeScript: the body's parameter, and
what a read of it gives, are typed as the row.

**A reader for each kind.** A plain index's rows under a key are one run, which
`prefix` reads. The indexes a planning board reads are not one run: a series
index files each event once, at the level its length fits, an interval index
answers a window with a run of starts and one a tree node above the window's
first instant, an area index with a cell a level, and each files more under
those runs than a window holds. So an index input arrives, in an `e3.function`
with a spec and an `e3.streamTask`, with its kind's readers on it — it is still
the entries, and `prefix`, `range`, `size` and a keyed read work as before — and
`e3.index(def).read(entries)` gives the same over any other expression of the
index's type, a task's own function's parameter among them.

```typescript
// The hours a press is booked for in a window, from its series index alone.
const hoursOnPress = e3.function('hours_on_press', {
  inputs: [e3.index(jobs.indexes.jobs_by_press_week)],
  args: [StringType, DateTimeType, DateTimeType],
  output: FloatType,
}, ($, jobsByPress, press, from, to) => {
  const sheets = $.let(0.0);
  jobsByPress.events({ key: press, from, to }).each($, ($, job) => { $.assign(sheets, sheets.add(job.sheets)); });
  return sheets.divide(8000.0);
});

// The same rows as a Dict by the job's own key.
const held = jobsByPress.events({ key: press, from, to }).collect($);

// In a task, whose body is its own East function.
const byPress = e3.index(jobs.indexes.jobs_by_press_week);
East.function([byPress.type, StringType], IntegerType, ($, entries, press) =>
  byPress.read(entries).events({ key: press, from, to }).collect($).size());
```

A reader answers a **read**: the rows its words say and no others, each once,
in the index's own order.

| Form | Gives | Holds in memory |
|---|---|---|
| `read.each($, ($, carried, key) => { … })` | the body run once a row: what the index carries for it, and the row's key. It takes no label and runs to its end: skip a row with `$.if`, leave the function with `$.return` | a segment of the index at a time |
| `read.collect($)` | a new Dict by the row's key of what `each` gives | the rows it collects |

| Declared by | Reader | Gives, each row once | Runs read |
|---|---|---|---|
| `index.on`, `index.key`, `index.keys` | `of(key)`: the rows under an index key, or under its first fields (`{ owner }` of `['owner', 'due']`). `between({ from?, to? })`: the rows from one index key up to another | what the index carries, and the row's key | one |
| `index.interval` | `overlapping({ on?, from, to })`: the rows that overlap `[from, to)`. `unset({ on? })`: the rows with no start | what the index carries, and the row's key | at most 55, in the index's order: the starts in the window, then one a tree node above its first instant |
| `index.series` | `events({ on?, key, from, to })`: the events on `key` that overlap `[from, to)` | the row, and its key | one a level, from the index's tile to the year, in the index's order of its levels |
| `index.series`, `order: 'time'` | `events({ on?, from, to })`: the events on every key under `on` that overlap `[from, to)`; it takes no `key` | what the index carries, and the row's key | one a level, a tile's events together in their keys' order |
| `index.summary` | `totals({ on?, key, from, to })`: each tile of `key` that overlaps `[from, to)` | `{ count, ms }`, and the tile's start in place of a row's key | one |
| `index.area` | `within({ on?, x, y, width, height })`: the rows whose box meets the window. `unplaced({ on? })`: the rows with no place | the row, and its key | at most 266, as a page's read of a viewport, in the index's order: a cell before the cells inside it |
| `index.entries` | `of(key)`: that key's entry on every row that holds one | the entry's value, and the row's key | one |
| `index.nested` | of one node of a row's tree, below | below | one, or one a level |

A nested series index's span and an entries index's lean rows are read as
plain indexes are, with `of` and `between`. A span's entry stands for every
row of its key and names none, so its read gives the index key,
`{ collection, tile }`, in a row's key's place.

**A nested series index's readers.** A nested series index files a row's tree
a node at a time, each node's entries in runs, so each reader reads one node:
`{ collection, row, path?, from, to }` — the collection's place (its field
names from the row down, `['units', 'jobs']`, a recursive field adding none),
the row's key, and the Dict keys from the row down to the node, the row itself
where `path` is left out. TypeScript offers the places the index declares, and
types what a read gives by the place.

```typescript
const inTime = e3.index(lines.indexes.lines_in_time);
const sheetsOnUnit = e3.function('sheets_on_unit', {
  inputs: [inTime], args: [StringType, StringType, DateTimeType, DateTimeType], output: FloatType,
}, ($, linesInTime, line, unit, from, to) => {
  const sheets = $.let(0.0);
  linesInTime.items({ collection: ['units', 'jobs'], row: line, path: [variant('units', unit)], from, to })
    .each($, ($, job) => { $.assign(sheets, sheets.add(job.sheets)); });
  return sheets;
});
// The line's mean of its units' load a day, which the index keeps.
linesInTime.subtotals({ collection: ['units', 'load'], row: line, rollup: 'mean', from, to }).collect($);
```

| Reader | Gives, each once | Needs | Runs read |
|---|---|---|---|
| `items(node)` | the node's own items that overlap `[from, to)`, each with its id, in its collection's own key type; or its values in the window, each with its instant | | one a level for items timed `{ from, to }`; one for values and items timed `{ at }` |
| `subtree(node)` | the items of every node beneath the node that overlap the window, each with `{ path, id }`: the keys from the node down to the one holding it — a path, `end` or a `step` and the rest — and its id, each an id of the index's (`NestedUnderType(index)` is the type) | `items(…, { rollup: true })` | one a level |
| `totals(node)` | the node's totals of the collection in each summary tile that overlaps the window — `{ count, ms, values }`, `values` the sum, least, greatest and latest of numbers — with the tile's start | `summary` | one |
| `subtreeTotals(node)` | the same, of the items beneath the node | `rollup: true` and `summary` | one |
| `subtotals({ …node, rollup, level? })` | a parent's subtotal of its children's values in each tile of `level` that overlaps the window, with the tile's start. `rollup` is written as the collection declares it; `level` is the index's tile where left out, or a coarser one | `values({ rollup })` | one |

A node that holds values of its own draws them and keeps no subtotal, so its
`subtotals` is empty; a row or a node that is not there reads as empty too. A
place the index does not file, a collection not rolled up, a rollup it does not
keep, a level finer than its tile and totals of an index with no `summary` are
each refused where the reader is called, naming what the index does keep.

| Rule | |
|---|---|
| **Exact** | A series, a nested series or an area index files more under the runs a window reads than the window holds, and an event past a year under each year it touches: the reader tests each entry, and gives it once. A plain index whose rows fan out — `index.keys`, a Set field — gives a row once across the keys of a read, and holds the keys of the rows it gave to do so |
| **The window's edges** | `[from, to)`, for every reader with a span of time: an event that ends at `from` is outside; an instant at `from` is inside and one at `to` outside; an event with no end, or one at or before its start, is an instant. A window that ends at or before its start holds no row. A row with no start is in no window: a series index files it nowhere, and an interval index gives it by `unset`. An area's window holds its edges: a box that touches it is in it, and one of a negative size holds none. A zero is one edge whatever its sign: a width of `-0.0` is a width of none, as it is to a page |
| **Order** | A read gives its rows in the index's own order: one of several runs reads them in the order the index holds them, so the rows come as a walk of the index meets them. Across a series index's levels that is not time order — the index orders a level by its name: day, month, quarter, week, year — so sort what is collected where order matters |
| **Leading fields** | An index declared with `on` takes every leading field, exactly, as `on: { status: "open" }`, in every reader: TypeScript requires it, `unset` and `unplaced` included. One left out, one that leads nothing, or a value of another type is refused where the reader is called, naming the fields |
| **Its kind's readers** | TypeScript offers an index the readers of its kind. `e3.index(def).read` refuses another index's entries, naming both: by their type, and, where two indexes' entries have one type, by the readers the expression already carries — a body's parameter for the other index, or what the other's `read` was given. An expression that carries none is known by its type alone, so in a task's own function two parameters of one type are the author's to keep apart. `unset` and `unplaced` are refused for an index whose start, or place, is no Option field: every row then has one |
| **More of the row** | Where an index carries less than the row, take the record as an input beside it and read the row by its key, at the same state. Those keyed reads come in the index's order, not the record's, so an index that carries the row is the one to read many rows through |
| **Cost** | A read costs its runs, each a range read: its two ends through the pager's cache and what lies between. It never costs the index. Over 24,000 jobs: a key's rows decode 1 of the index's 20 segments, a week of an interval 12 of 61, a week of a press's series 2 of 20, a room of an area 4 of 19; over forty lines of four units, each read of one node of a nested series index 1 of 31 — the same on east-node, east-c and east-py |
| **The page's runs** | Each reader reads the runs a page's reader of its kind searches, less the tiles and the margin a page reads beyond a window to pan into |

**What a read costs.** A body reads the entries with `prefix` and `range`, by
key, by size and by a loop, as it reads any lazily opened Dict: a run costs the
segment each of its ends lands in and the segments between them, never the
index, and the size of a run costs its two ends alone. A body that uses the
input any other way decodes the index whole, as it would any input; a runner's
`-v` says which, an input at a time.

| Rule | |
|---|---|
| **One state** | The inputs of one record — the record, and any of its indexes — are read at one state of it, so a body never meets an index entry for a row it reads otherwise |
| **A task** | is decided again whenever its record changes, and runs again when the index it reads did: its execution is keyed by the index, so a write that leaves the index as it was is served by the cache |
| **A function** | reads the index as the record is stored when the call starts. Its result's `inputs` name the record, the index and the hash the record was pinned at, which its other inputs of that record name too |
| **Drafts** | A function may list the record in `drafts` whether it reads the record or an index of it: a call's drafts are laid over the record, and its indexes hold them as they would after the Save |
| **No state yet** | A record with no state makes a task wait and a call `invalid`, as it does for the record as an input. So does a state that holds no such index — one written outside the doors that build every index its record declares — the task's status naming the record and the index, and the run going on without it |
| **The package** | `e3.package` collects the index's record |
| **Refused where declared** | Anything but an index its record carries by name, naming what was given; a task's parameter that is not the input's `type`; an index inside `e3.partition` (every piece reads it whole: pass the `e3.index` itself); an index as an input of `e3.customTask`, whose command reads files; a function on the `custom` runtime, which takes no inputs |
