# Builder interfaces — design

Every e3-ui builder takes the app's records in the app's own shapes. What a
builder writes is the app's record, its fields mapped to the roles the builder
needs, as the Calendar's and Plan's event kinds already are. What it reads
comes from the app's rows through accessors. What it publishes is a record of
the app's too, its status a field the app maps. The Roster and the Allocation
move onto these declarations, and their own stored types are removed. Each
builder has one way to use it.

This document is the design the epic builds. It was approved on 20 Oct 2026 as
the proposal *Consistent Builder Interfaces* (claude.ai artifact
`JJg4cw5c1UheFGENDPZeSi`, version 3); the decisions in §3 are its rulings. Each
sub-issue copies the sections and rules it owns (§11).

## 1. The rule

A builder declares three things over the app's records. It stores nothing in a
shape of its own.

```tsx
// What a builder writes: your record, its fields mapped to the builder's roles.
events={{ duty: Schedule.events(Record.bind(duties, [dutiesPatch]), { start: "start", end: "end", resource: { field: "person", of: "people" }, shift: "shift", group: "team" }) }}

// What it reads: your rows, through accessors.
resources={{ people: Schedule.resources(staff.read(), { name: "People", icon: "user", label: p => p.name, group: p => p.team }) }}

// What it publishes: your record too, its status a field of yours.
periods={Schedule.periods(Record.bind(rotaWeeks, [rotaWeeksPatch]), { every: "week", status: { field: "state", draft: "open", published: "issued" } })}
```

1. **A role is a field of the app's row, named.** Its type is checked against
   the role when the code compiles, and again at build. A mismatch is refused,
   naming the role, the field and the field's type.
2. **A gesture writes only the fields its roles map.** Every other field of the
   row reads back as it was. The inspector edits those fields through
   `fields` hints, or through the kind's own `inspector`, as the Calendar's does.
3. **An optional role left out turns off what it drives.** Without `position`
   there are no positions and no lead rule; without `periods` there is no
   Publish.

Each builder's roles sit beside Schedule's own, as Plan's `state`, `quantity`
and `lane` do. A builder ignores the roles it has no use for, so one record of
duties can drive a Calendar and the Roster at the same time.

| | Calendar | Plan | Roster | Allocation |
|---|---|---|---|---|
| **Writes** (`events`, `Schedule.events`) | unchanged | unchanged | the app's duties (was `weeks`, a `Roster.Types.Weeks` record) | the app's bins (was `days`, an `Allocation.Types.Days(V)` record) |
| **Reads** (`resources`, `Schedule.resources`) | unchanged | unchanged | people and agencies, and accessors over the app's rows for shifts, groups, positions, activities and proposals | lanes and resources, and `arrivals` |
| **Publishes** (`periods`, `Schedule.periods`) | none; can take `periods` later unchanged | none; as the Calendar | the app's weeks | the app's days; leave it out for no Publish |

## 2. What is removed

Each of these is removed. An app that still passes one is refused at build, and
the message names the form that replaces it.

| Roster today | Becomes |
|---|---|
| `weeks`, `window` | `events={{ <slot>: Schedule.events(record, …) }}` and `periods` |
| `Roster.Types.Weeks` as a record type | the app's duties, weeks and targets records. `Week(R)` and `Assignment(R)` remain only as the Roster's reading of the app's rows, inside the fit's, the pay's and the check's requests; nothing stores them |
| `people={Roster.people(…)}` | `resources={{ people: Schedule.resources(…) }}` |
| `agencies` as `Roster.Types.Agency` values | `resources={{ agencies: Schedule.resources(…) }}` |
| `groups`, `shifts`, `positions` as Roster values | `Roster.groups(rows, …)`, `Roster.shifts(rows, …)`, `Roster.positions(rows, …)` |
| `forecast` | `targets={Roster.targets(record, …)}`, the app's record, which the app's forecast fills |
| `proposals` as `Roster.Types.Proposal` values | `Roster.proposals(rows, …)` |
| `inspector={{ assignment, requirement }}` | the duty kind's own `inspector`, and `Roster.targets`' `inspector` |
| `Roster.patch(…)` in a tab's `drop` | `Schedule.patch(Duty, …)`, as Plan's tabs do |
| `costs` (permanent, overtime and agency rates; a budget) | `pay`, the app's East function in its own pay codes (§5.6), and `currency` |
| an assignment's `offset`, `overtime` and `agreed`; `rules.agree`; the `agree` issue kind and fix | the duty's own times and fields, the app's `pay` and the app's `check` |

| Allocation today | Becomes |
|---|---|
| `days`, `window` | `events={{ <slot>: Schedule.events(record, …) }}` and `periods` |
| `Allocation.Types.Days(V)`, `Day(V)` as record types, and `V` | the app's bins and days records. `Day(R)` and `Bin(R)` remain only as the board's reading of the app's rows, inside the fit's and the check's requests, each bin carrying the app's row as `row` where it carried `values` |
| `events={Allocation.events(…)}` | `arrivals={Allocation.arrivals(…)}` |
| `lanes={Allocation.lanes(…)}`, `resources={Allocation.resources(…)}` | `resources={{ <lanes>: Schedule.resources(…), <resources>: Schedule.resources(…) }}`, under the app's own slot names |
| `publish={false}` | leave `periods` out |
| `quantity={{ unit }}` | the `quantity` role's `unit` |
| `inspector={{ bin }}` | the bin kind's own `inspector` |
| `columns` over `V` | `columns` over the app's bin row |
| `labels.event`, the Events tab (`Allocation.library.events()`) | `labels.arrival` ("Arrival" by default), the Arrivals tab (`Allocation.library.arrivals()`) |
| `Allocation.Types.Event`; `events` in the context, the fit's ask and its result | `Allocation.Types.Arrival`; `arrivals` in each |

**No converter, and no reader of the old forms.** An app's weeks or plans record
is its own to move, as with any record whose type an application changes; the
earlier Roster changes to groups and duties were handled the same way
(`docs/conventions/WIRE_MIGRATION.md`: no reader keeps a decoder for an earlier
form). The Allocation has not shipped, so only Roster apps have a record to move.

## 3. Decisions

Approved 20 Oct 2026 with the proposal.

| # | Decision |
|---|---|
| D1 | One interface. The old props and stored types are removed (§2). No deprecation period, no converter, no reader of the old forms. |
| D2 | Every builder's `events` are `Schedule.events` kinds over the app's record. The Roster's and the Allocation's roles join Plan's (§4.1). `title` becomes optional; the Calendar and Plan refuse a kind without one, since they draw it. |
| D3 | Every builder's `resources` are `Schedule.resources` kinds, each builder's accessors beside Plan's (§4.2). The other lists a builder reads take accessors over the app's rows, as `Roster.activities` does. Settings stay plain values: `rules`, `currency`, `labels`, `table`, `every`, `horizon`. |
| D4 | Publish is `periods={Schedule.periods(record, { every, status })}`: one row of the app's per period, keyed by its start (§4.3). |
| D5 | The Roster has no time types. It reads a duty's `start` and `end`, with its `shift` and `group`, and draws its times against the shift's (§5.5). A duty counts its length in hours, unless the app's `hours` accessor gives its own figure. |
| D6 | The Allocation's bins are an instant kind: `at` on a lane (`resource`), with Plan's `quantity`, and the Allocation's `arrival`, `parts`, `hold` and `kind` (§4.1). What it books from is `arrivals` (§6.4). The role that names a bin's arrival is `arrival`, so "event" means the bin in every builder and "arrival" what it books (the proposal's table called this role `event`). |
| D7 | The fit's, the pay's and the check's requests take the app's event row type (`FitRequest(Duty)`, `FitRequest(KilnBin)`), as the Allocation's took `V`. Each assignment or bin in them carries the app's row as `row`. The ready-made parts are constructors over the row type: `Roster.fit(Duty)`, `Allocation.answer(KilnBin)`. |
| D8 | Each record is one session of a single history, as each of the Calendar's and Plan's kinds is. Save sends each record's changes as its own request. Publish saves first, and writes the period's status only once the period's rows are confirmed (§7). |
| D9 | The Roster's week and the Allocation's day stay their own navigation (ruled 18 Oct). Each reads its period's records the way the Calendar reads its window: through the source of the slice named after the kind (an interval index, its range written by the navigation), or the record whole. That source takes no `fields`. The rail narrows what it narrows today, and every event of the period is read for coverage, pay, fits and checks. |
| D10 | Scope: the Roster and the Allocation, and Schedule gaining their roles and `periods`. Unchanged: the Calendar, Plan and the Sheet. Out of scope: Flowchart flows, Studio pages and saved queries. |
| D11 | It lands in the Allocation PR (#1318) before it merges, as its own epic, its children checkboxes in the PR. The Roster's change ships in the same release, with its wire entries (§10). |
| D12 | The on-screen noun for what the Allocation books from follows the code: `labels.arrival`, "Arrival" by default, and the Library's Arrivals tab. |
| D13 | Pay is the app's, and optional: an East function over one person's duties for the week, or one agency's requests, that returns each duty's cost by the app's pay codes (§5.6). The Roster asks it again only for the people whose duties changed, totals the costs by duty, slot, day, week, person and code, and gives them to the check. Without `pay`, no costs show. |

## 4. Schedule

### 4.1 `Schedule.events`: the builders' roles

`ScheduleEventsBase` gains the roles below, each checked against the row type
at compile time (a field-name type, as `title` and `state` are) and again at
build (`schedule/events.ts`' `role(…)`), refused naming the role, the field and
its type (`` `shift` names a String field — "unpaidBreak" holds .Float ``).
`title` becomes optional on `ScheduleEventsBase`; the Calendar and Plan refuse
a kind without it through `scheduleTitled` (`Calendar: events.<slot> has no
title — the Calendar draws each event's title: give the kind a \`title\`, a
String field of its row`).

| Role | Field type | Builder | |
|---|---|---|---|
| `shift` | `String` | Roster | required by the Roster |
| `group` | `String` | Roster | required by the Roster |
| `position` | `String` | Roster | optional |
| `activity` | `Option<String>` | Roster | optional |
| `hours` | an accessor `(row, key) => Float` | Roster | optional: the duty's length when omitted |
| `arrival` | `Option<String>` | Allocation | required by the Allocation; `none` is a reservation |
| `parts` | `{ field: Dict<String, Float>; of: string }`, `of` a resource slot | Allocation | required by the Allocation |
| `hold` | `TimeStep` (east-ui's `TimeStepType`) | Allocation | required by the Allocation |
| `kind` | `Option<String>` | Allocation | optional |

The kind gains two builds beside `build` and `buildPlan`, each closed behind
East functions over beast2 bytes, so a builder's payload is one type whatever
the record holds. Schedule reads and writes a builder's roles, a struct of
fixed type; the builder composes its own view from them and the row
(`Assignment(R)`, `Bin(R)`, §5.3, §6.3), as only it knows what they mean (a
duty's day is the nearest shift start, §5.5). Schedule needs none of a
builder's types.

- **`buildRoster(slot, part)`** (`ScheduleRosterKindType`, `Schedule.Types.RosterKind`):
  - `kind`: the Calendar's closed kind, built through the slice part or over
    the record whole — its `editing`, `entries`, `history` and `ready`, and its
    `fields`, a form over the fields none of the Roster's roles writes;
  - `rows(from, to)`: each stored duty overlapping `[from, to)`, by its key,
    as its roles (`ScheduleRosterRolesType`: `start`, `end`, `resource`,
    `shift`, `group`, `position`, `activity`, `hours`) and its row's bytes
    (`ScheduleRosterEntryType`), read in one pass, so the roles cost no second
    decode; `none` while a read is in flight;
  - `read(row, key)`: a drafted row's roles, from its bytes;
  - `write(row, roles)`: the row with every mapped field written from the
    roles and every other field as it was (B1), `none` for a resource of a
    kind the duty kind doesn't take;
  - `create(roles)`: a new row, every unmapped field its type's default;
  - `roles`: whether `position` and `activity` are mapped; and `rowType`.

  It refuses an instant kind (`at`), `start`/`end` that are Options (a duty has
  its times), a record keyed by anything but String, a kind with no `shift` or
  `group`, or no `resource`, and two roles naming one field.
- **`buildAllocation(slot, part)`** (`ScheduleAllocationKindType`, `Schedule.Types.AllocationKind`):
  - the same `kind` and `rows`, each bin's roles (`ScheduleAllocationRolesType`:
    `at`, `lane`, `arrival`, `quantity`, `parts`, `hold`, `kind`) beside its
    bytes (`ScheduleAllocationEntryType`);
  - `read(row)` and `write(row, roles)`, as the Roster's;
  - `create(roles, values)`: a new bin, its unmapped fields an arrival's
    `values` (bytes at the `values` type), or with none their type's default
    (B13);
  - `lanes` (`resource.of`), `parts` (`parts.of`), `kinded`, `unit` (the
    `quantity` role's), `values` (the struct of the fields no role maps) and
    `rowType`.

  It refuses a span kind, a record keyed by anything but String, a kind with
  no `resource`, `arrival`, `quantity`, `parts` or `hold`, a lane that is not a
  String key of one kind (a variant or an Option), and two roles naming one
  field.

The Calendar and Plan ignore the Roster's and the Allocation's roles, and the
Roster and the Allocation ignore Plan's. A kind given roles of both the Roster
and the Allocation is refused, naming both. An `hours` accessor returning no
Float is refused, naming what it returns.

### 4.2 `Schedule.resources`: the builders' accessors

`ScheduleResourcesConfig` gains:

| Accessor | Returns | Builder |
|---|---|---|
| `position` | `String` (default position) | Roster's people |
| `skills` | `Set<String>` | Roster's people |
| `contract` | `Float` (weekly hours) | Roster's people |
| `agency`, `trainer`, `trainee` | `Boolean` | Roster's people |
| `usual` | `Option<String>` (usual shift) | Roster's people |
| `offset` | `TimeStep` | Allocation's lanes |
| `min`, `max` | `Float` | Allocation's resources (required there) |
| `note` | `Option<String>` | Allocation's resources |
| `hold` | `TimeStep` | Allocation's resources |
| `jobs` | `Array<Allocation.Types.Job>` | Allocation's resources |

`label` is the person's name, the lane's or the resource's name; `group`
(Plan's, `String`) is a person's home group and a resource's group; `meta` is
Schedule's. Each accessor is reified once (`schedule/accessor.ts`), held to the
type it returns — one returning another is refused naming what it returns
(`` Schedule.resources: "People": `contract` returns a Float, a person's
contracted weekly hours — and this one returns .String ``) — and the kind
carries them all as `accessors` (`ScheduleResourceAccessors`: `label`, `meta`,
`group` and each above, `undefined` where not given). The builder's tag calls
them once per row to build its own rows — `Roster.Types.Person` and `Agency`,
`Allocation.Types.Lane` and `Resource` — as Schedule knows none of a builder's
types; and it makes the checks only it can, as it knows its slots: the Roster's
`people` kind requires `group`, the Allocation's resources kind `min` and
`max` (§5, §6).

### 4.3 `Schedule.periods`

```tsx
// record: a Dict<DateTime, P> of the app's, bound with its patch mutation, keyed by each period's start.
periods={Schedule.periods(Record.bind(rotaWeeks, [rotaWeeksPatch]), {
    every: "week",                                                   // a week from the builder's week start, or "day"
    status: { field: "state", draft: "open", published: "issued" }, // the app's variant field, and which of its cases mean what
    dismissed: "dismissed",                                          // the Roster's: a Set<String> field, the proposals rejected
    entries,                                                         // optional: Data.bindPaged(record), read by key
})}
```

1. **The record** is `Dict<DateTime, P>`, keyed by each period's start: a UTC
   midnight, the week's first day for `"week"` by the builder's week start.
2. **Status.** `status.field` names a variant field of `P` (not an Option);
   `draft` and `published` name two of its cases. The published case holds
   `Null` or `{ at: DateTime }`; any other payload is refused at build, naming
   both forms. A status reads as `published { at }`, `at` an Option: `none` for
   a published case holding `Null`. A period with no row is Not started.
3. **Read-only.** A period whose status is the published case is read-only in
   every layout, phones included. A period in a case that is neither is
   read-only too, its chip naming the case.
4. **Publish** saves the period's drafts first. Once every record's session
   reads back confirmed, it writes the published case — with the time in `at`
   when the case holds one — and saves the period. A save that fails leaves the
   period a draft with its drafts kept, so a published period never sits over
   unsaved rows.
5. **New rows.** A period row the builder creates holds the type's default
   (`defaultValue`) in every field it doesn't map: its status the published
   case when it publishes, else the draft case, holding its payload's default.
6. **Without `periods`** there is no status chip and no Publish. Save works as
   ever.
7. **Reads.** The periods are read by key through `entries` when given (the
   week, the week before it, the open picker's month), each span one key search
   and one page, else whole.

`build()` (`SchedulePeriodsKindType`, `Schedule.Types.PeriodsKind`) carries
`every`; the session's `editing` and `entries` (`schedule/session.ts`, the
event kinds' session too); `rows(from, to)`, the periods starting in the span,
by their start, as bytes; `status(row)` (`SchedulePeriodStatusType`: `draft`,
`published { at: Option<DateTime> }`, or `other: String`, the case's name);
`publish(row?, at)`; the Roster's `dismissible`, `dismissed(row)` and
`dismiss(row?, keys)`; `history`; and `rowType`. `publish` and `dismiss` take
the period's row, or none to make one (rule 5).

Refused at build, naming the option: a record not bound with its patch
mutation, not keyed by DateTime, or whose rows are not structs; an `every`
that is neither `"week"` nor `"day"`; a `status.field` the row lacks, that is
no variant or is an Option; a `status.draft` or `status.published` that is no
case of it (`` `status.published` names a case of "state" (cancelled, issued,
open) — and it names "sent" ``), or both naming one; the published case's
payload (rule 2); a `dismissed` that is no `Set<String>` field; and `entries`
that is not the record's own entries.

## 5. Roster

### 5.1 Props

```ts
interface RosterProps {
    events: { [slot: string]: ScheduleEventKind };     // exactly one kind: the duties
    resources: { people: ScheduleResourceKind; agencies?: ScheduleResourceKind };
    periods?: SchedulePeriods;                         // Publish; without it, none
    targets?: RosterTargets;                           // Roster.targets(record, …)
    shifts: RosterShifts;                              // Roster.shifts(rows, …)
    groups: RosterGroups;                              // Roster.groups(rows, …)
    positions?: RosterPositions;                       // Roster.positions(rows, …); refused without the `position` role
    activities?: ExprType<ArrayType<Roster.Types.Skill>>;   // Roster.activities(rows, …), as today
    proposals?: RosterProposals;                       // Roster.proposals(rows, …)
    pay?: SubtypeExprOrValue<FunctionType<[PayRequest(R)], Pay>>;
    currency?: string;                                 // how costs print; required with `pay`
    rules?: { rest?: number; lead?: boolean; trainer?: boolean; skill?: boolean };
    check?: SubtypeExprOrValue<FunctionType<[CheckContext(R)], ArrayType<Issue>>>;
    fit?: BoundFunc<[FitRequest(R)], FitResult>;
    slice?: RecordSlicesChromeOptions;                 // sources: the duty kind's slot, `targets`, `people`, `activities`
    library?: readonly RosterLibraryTab[];
    inspector?: boolean;
    view?, week?, density?, chipSkills?, requirements?, readOnly?, id?;   // as today
}
```

A second event kind is refused (`Roster: \`events\` holds one kind, the
duties`), and so is a resource slot other than `people` and `agencies`.

### 5.2 Roles

The duty kind (`Schedule.events`):

| Role | Field type | What the Roster does with it | |
|---|---|---|---|
| `start`, `end` | `DateTime` | when the duty runs; its day is derived (§5.5), nothing else is | required |
| `resource` | `String` (a `people` key), or a variant of `String` cases mapped to `people` and `agencies` | who: a person, or an agency asked to send someone | required |
| `shift` | `String` | the duty's shift, a key of `shifts` | required |
| `group` | `String` | the group it is rostered in, a key of `groups` | required |
| `position` | `String` | the position held, a key of `positions`; the lead rule reads it | optional: without it, no positions and no lead rule |
| `activity` | `Option<String>` | one skill or duty, a key of `activities` | optional |
| `hours` | `(row, key) => Float` | the hours the duty counts for coverage, skill hours, contract hours, rest and pay | optional: its length |
| `title` | `String` | unused by the Roster | optional |
| `fields`, `inspector`, `ready`, `entries` | as `Schedule.events` | the inspector's form over the other fields, the app's own form, its check on a draft, reads by key | optional |

People and agencies are `Schedule.resources` kinds under the slots `people` and
`agencies` (§4.2): `label` (the name) and `group` (home group) required;
`position`, `skills`, `contract`, `agency`, `trainer`, `trainee`, `usual`
optional.

The lists, each over the app's rows by key, in `order` and then key order:

| Declaration | Accessors |
|---|---|
| `Roster.shifts(rows, …)` | `label`, `code`, `start` (`Schedule.Types.Clock`), `hours` (`Float`), `order?` |
| `Roster.groups(rows, …)` | `label`, `order?` |
| `Roster.positions(rows, …)` | `label`, `code`, `lead` (`Boolean`), `order?` |
| `Roster.activities(rows, …)` | `label`, `code?`, `group?`, `order?` (as today) |
| `Roster.proposals(rows, …)` | `person` (a `people` key), `day` (`DateTime`), `group`, `shift`, `reason`; a proposal's key is its row's key |

The records the Roster writes besides the duties:

| Declaration | Roles |
|---|---|
| `Roster.targets(record, …)` | `day` (`DateTime`), `group`, `shift` (`String`), `positions` (`Integer`), `hours` (`Dict<String, Float>`, hours by activity), `inspector?`, `entries?`. A slot with no row has no target; a target edit on such a slot inserts one, keyed by a minted key. |
| `Schedule.periods(record, …)` | §4.3, with the Roster's `dismissed?`: a `Set<String>` field, the proposals accepted or rejected that week. Without it, proposals offer Accept only. |

### 5.3 Types

The views below are the Roster's reading of the app's rows. They are carried in
requests and in the renderer, and stored nowhere.

```ts
Roster.Types.Who            = VariantType({ person: StringType, request: StringType });            // as today
Roster.Types.Slot           = StructType({ day: IntegerType, group: StringType, shift: StringType });   // as today: day 0–6 of the week
Roster.Types.Assignment(R)  = StructType({ slot: Slot, who: Who, position: StringType, activity: OptionType(StringType),
                                          start: DateTimeType, end: DateTimeType, hours: FloatType, row: R });
Roster.Types.Requirement    = StructType({ positions: IntegerType, hours: DictType(StringType, FloatType) });   // as today
Roster.Types.Status         = VariantType({ draft: NullType, published: StructType({ at: OptionType(DateTimeType) }), other: StringType });   // Schedule's period status
Roster.Types.Week(R)        = StructType({ status: Status, assignments: DictType(StringType, Assignment(R)),
                                          requirements: DictType(Slot, Requirement), dismissed: SetType(StringType) });
Roster.Types.Context        = StructType({ people, groups, activities, shifts, positions, agencies, rules });   // loses `costs`
Roster.Types.Rules          = StructType({ rest: FloatType, lead: BooleanType, trainer: BooleanType, skill: BooleanType });   // loses `agree`
Roster.Types.Coverage       = /* as today, `hours` without `overtime`; `cost` the slot's pay, 0.0 without `pay` */;
Roster.Types.PayRequest(R)  = StructType({ who: Who, start: DateTimeType, duties: DictType(StringType, Assignment(R)), context: Context });
Roster.Types.Pay            = DictType(StringType, DictType(StringType, FloatType));   // duty key → pay code → cost
Roster.Types.CheckContext(R)= StructType({ start: DateTimeType, week: Week(R), context: Context,
                                          coverage: DictType(Slot, Coverage), pay: Pay });
Roster.Types.FitRequest(R)  = StructType({ need: Need, slot: Slot, start: DateTimeType, week: Week(R), context: Context,
                                          coverage: DictType(Slot, Coverage) });
Roster.Types.Fix            = VariantType({ request: StringType, accept: StringType, move: StringType, start: DateTimeType, find: Need });   // `start` a later start; no `agree`
Roster.Types.Issue          = /* as today, its kind without `agree` */;
```

Each `(R)` is a constructor: the same `R` gives the same East type
(`isTypeEqual`). `Roster.Types.Person`, `Group`, `Shift`, `Skill`, `Position`,
`Agency`, `Need`, `Fit`, `FitResult`, `Refusal` and `Clock` are unchanged.

### 5.4 Functions

Each over a week takes the row type and returns its East function, as the
Allocation's take `V` today:

| Function | East function |
|---|---|
| `Roster.coverage(R)` | `(Week(R), Context, Pay) → Dict<Slot, Coverage>` |
| `Roster.check(R)` | `(Week(R), Context) → Array<Issue>` |
| `Roster.weekHours(R)` | `(Week(R), Context) → Dict<String, Float>` |
| `Roster.rest(R)` | `(Assignment(R), String, Week(R), Context) → Rest` |
| `Roster.fit(R)` | `(FitRequest(R), Person) → Fit` |
| `Roster.answer(R)` | `(FitRequest(R), Fn(FitRequest(R), Person) → Fit) → FitResult` |

### 5.5 What the Roster reads from a duty's times

1. **Day.** A duty's day is the UTC day whose `shift` start is nearest the
   duty's `start`. Its week is the week holding that day.
2. **Times are times.** The Roster draws a duty's own times wherever they
   differ from its shift's (`05:00–15:00` on the 06:00–14:00 shift). It gives
   them no name and no worth; the app's `pay` does.
3. **A move** to another slot moves `start` and `end` with it, keeping them
   where they stood against the shift's start, and writes `shift` and `group`.
4. **Editing** a duty's times writes `start` and `end`. The inspector keeps a
   duty within 12 hours of its shift's start, and `end` after `start`.
5. **A new duty** runs its slot's shift: from the shift's start, for the shift's
   hours. Its unmapped fields hold their type's default.
6. **Hours.** A duty counts its length, or what `hours` gives. Coverage, skill
   hours, contract hours and the rest rule read them.
7. **Costs** are the app's `pay`, summed by duty, slot, day, week and person,
   and by code. Without `pay`, none show.
8. **A duty whose shift or group isn't configured** is listed in Issues
   (`Unknown shift · night-2`), never placed in the grid, and kept as stored.
9. **Copy previous week** copies each duty of the week before at its shift's
   own times, its other fields as they were.

### 5.6 Pay

`pay` is an East function `(PayRequest(R)) → Pay`, compiled once in the
renderer, as `check` is. The Roster calls it once per person with that person's
duties in the week, and once per agency with its requests; it merges the
answers by duty key. It calls it again only for the people and agencies whose
duties, or whose duties' rows, changed. A call that throws is shown as a
warning banner naming the person (`Pay couldn't be worked out for Ada Brook`),
and that person's duties show no cost.

The Roster knows no pay code in advance. The inspector shows a duty's costs by
code; the slot, day and week totals and the People layout's person totals sum
them, by code and in all. `currency` prints them through the shared money
formatter.

```tsx
// Your pay rules, in your own codes. One person's duties for the week in (or one agency's requests); each duty's cost
// by code out. Here: ordinary time up to 38 hours in the week, OT1 after it, an agency's requests at its own rate.
const rateRows = $.let(Data.bind(payRates));
const rates = $.const(rateRows.read());
const pay = $.const(East.function([Roster.Types.PayRequest(Duty)], Roster.Types.Pay, ($2, req) => {
    const out = $2.let(new Map(), Roster.Types.Pay);
    const threshold = $2.const(38.0, FloatType);
    const zero = $2.const(0.0, FloatType);
    const worked = $2.let(0.0, FloatType);
    // The week's duties in time order, so the threshold falls where it does.
    const ordered = $2.const(req.duties.toArray(($3, duty, key) => ({ key, duty })).sort(($3, d) => d.duty.row.start));
    $2.for(ordered, ($3, d) => {
        const costs = $3.let(new Map(), DictType(StringType, FloatType));
        $3.match(req.who, {
            request: ($4) => { $4(costs.insert("AGENCY", d.duty.hours.multiply(rates.get("AGENCY", () => 0.0)))); },
            person: ($4) => {
                const ord = $4.const(East.max(East.min(d.duty.hours, threshold.subtract(worked)), zero));
                const ot = $4.const(d.duty.hours.subtract(ord));
                $4(costs.insert("ORD", ord.multiply(rates.get("ORD", () => 0.0))));
                $4.if(East.greater(ot, 0.0), ($5) => { $5(costs.insert("OT1", ot.multiply(rates.get("OT1", () => 0.0)))); });
            },
        });
        $3.assign(worked, worked.add(d.duty.hours));
        $3(out.insert(d.key, costs));
    });
    return out;
}));
```

### 5.7 Examples

**Minimal.**

```tsx
/** @jsxImportSource @elaraai/e3-ui */
import { DateTimeType, DictType, East, FloatType, IntegerType, StringType, StructType, example } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
import { Data, Record, Roster, Schedule } from "@elaraai/e3-ui";

export const Duty = StructType({
    person: StringType,                         // who: a staff key
    start: DateTimeType, end: DateTimeType,     // when, as worked
    shift: StringType, team: StringType,        // the slot
});
export const Worker = StructType({ name: StringType, team: StringType });
export const ShiftTime = StructType({ name: StringType, code: StringType, starts: Schedule.Types.Clock, hours: FloatType, order: IntegerType });
export const Team = StructType({ name: StringType });

export const duties = e3.record("duties", DictType(StringType, Duty), new Map());
export const dutiesPatch = e3.mutation.patch(duties);
export const workers = e3.record("workers", DictType(StringType, Worker), new Map([
    ["w-01", { name: "Ada Brook", team: "inbound" }],
    ["w-02", { name: "Tom Vale", team: "dispatch" }],
]));
export const shiftTimes = e3.record("shift_times", DictType(StringType, ShiftTime), new Map([
    ["early", { name: "Early", code: "E", starts: { hour: 6n, minute: 0n }, hours: 8.0, order: 1n }],
    ["late", { name: "Late", code: "L", starts: { hour: 14n, minute: 0n }, hours: 8.0, order: 2n }],
]));
export const teams = e3.record("teams", DictType(StringType, Team), new Map([
    ["inbound", { name: "Inbound" }], ["dispatch", { name: "Dispatch" }],
]));

export const rotaMinimal = example({
    description: "The smallest roster over the app's own records: duties with their times, shift and team; staff; shift times; teams.",
    keywords: ["Roster", "Schedule.events", "Schedule.resources", "Record.bind"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const rota = $.let(Record.bind(duties, [dutiesPatch]));
        const staff = $.let(Data.bind(workers));
        const times = $.let(Data.bind(shiftTimes));
        const groups = $.let(Data.bind(teams));
        return <Box width="100%" height="760px"><Roster id="rotaMinimal"
            events={{ duty: Schedule.events(rota, {
                name: "Duty", icon: "user-clock",
                start: "start", end: "end", resource: { field: "person", of: "people" },
                shift: "shift", group: "team",
            }) }}
            resources={{ people: Schedule.resources(staff.read(), { name: "People", icon: "user", label: w => w.name, group: w => w.team }) }}
            shifts={Roster.shifts(times.read(), { label: s => s.name, code: s => s.code, start: s => s.starts, hours: s => s.hours, order: s => s.order })}
            groups={Roster.groups(groups.read(), { label: t => t.name })} />
        </Box>;
    }}</Reactive>),
});
```

**Full, bound (the warehouse).** The records:

```ts
export const Duty = StructType({
    who: VariantType({ staff: StringType, agency: StringType }),    // a person, or an agency asked to send someone
    start: DateTimeType, end: DateTimeType,                        // as worked: just times, worth what the pay rules say
    shift: StringType, team: StringType, role: StringType, task: OptionType(StringType),
    unpaidBreak: FloatType, agreed: OptionType(BooleanType),       // the app's own, as are the two below: kept as they are,
    costCentre: StringType, note: StringType,                      // edited in the inspector, read by its pay and its check
});
export const RotaWeek = StructType({
    state: VariantType({ open: NullType, issued: StructType({ at: DateTimeType }) }),
    dismissed: SetType(StringType), approver: OptionType(StringType),
});
export const Cover = StructType({ day: DateTimeType, team: StringType, shift: StringType, heads: IntegerType, hours: DictType(StringType, FloatType) });
export const Suggestion = StructType({ person: StringType, day: DateTimeType, team: StringType, shift: StringType, why: StringType });

export const duties = e3.record("warehouse_duties", DictType(StringType, Duty), dutySeed);
export const dutiesPatch = e3.mutation.patch(duties);
export const dutiesByTime = e3.recordIndex.interval("warehouse_duties_by_time", duties, { from: "start", to: "end" });
export const rotaWeeks = e3.record("warehouse_rota_weeks", DictType(DateTimeType, RotaWeek), new Map());
export const rotaWeeksPatch = e3.mutation.patch(rotaWeeks);
export const cover = e3.record("warehouse_cover", DictType(StringType, Cover), coverSeed);
export const coverPatch = e3.mutation.patch(cover);
export const suggestions = e3.record("warehouse_suggestions", DictType(StringType, Suggestion), suggestionSeed);
export const payRates = e3.record("warehouse_pay_rates", DictType(StringType, FloatType), new Map([["ORD", 31.0], ["OT1", 46.5], ["AGENCY", 38.0]]));
// staff (with its indexes), agencies, shiftTimes, teams, positions and activities (with its index): the warehouse's own records.
```

The board, with `pay` (§5.6) and `check` (§5.8) written in the same body:

```tsx
export const rotaWarehouse = example({
    description: "The warehouse roster over its own records: duties, weeks, cover targets and suggestions, staff and agencies, its pay codes, with Publish, the rail, the fit, the library and the inspector.",
    keywords: ["Roster", "Schedule.events", "Schedule.resources", "Schedule.periods", "Roster.targets", "pay", "Slice.bindRecords", "Func.bind", "Publish"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const rota = $.let(Record.bind(duties, [dutiesPatch]));
        const entries = $.let(Data.bindPaged(duties));
        const byTime = $.let(Data.bindPaged(duties, { indexes: [dutiesByTime] }));
        const weeks = $.let(Record.bind(rotaWeeks, [rotaWeeksPatch]));
        const targets = $.let(Record.bind(cover, [coverPatch]));
        const people = $.let(Data.bind(staff));
        const staffIndex = $.let(Data.bindPaged(staff, { indexes: [staffByTeamName, staffBySkill] }));
        const acts = $.let(Data.bind(activities));
        const actIndex = $.let(Data.bindPaged(activities, { indexes: [activitiesByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.rotaWarehouse", {
            // The week's duties: the Roster's navigation writes the range; no chip picks the week.
            duty: { source: byTime, range: "start" },
            people: { source: staffIndex, icon: { prefix: "fas", name: "user" }, search: ["name", "skills"],
                fields: { team: { label: "Group" }, skills: { label: "Skill" }, name: { label: "Name" } } },
            activities: { source: actIndex, icon: { prefix: "fas", name: "list-check" }, fields: { group: { label: "Group" } } },
        }));
        const firms = $.let(Data.bind(agencies));
        const times = $.let(Data.bind(shiftTimes));
        const groups = $.let(Data.bind(teams));
        const roles = $.let(Data.bind(positions));
        const ideas = $.let(Data.bind(suggestions));
        const fit = $.let(Func.bind(staffFit));
        // pay (§5.6) and check (§5.8) are written here.
        return <Box width="100%" height="760px"><Roster id="rotaWarehouse" week={{ start: "sunday" }} slice={{ slice }} fit={fit}
            pay={pay} currency="EUR" check={check} inspector
            events={{ duty: Schedule.events(rota, {
                name: "Duty", icon: "user-clock", entries,
                start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
                shift: "shift", group: "team", position: "role", activity: "task",
                // The hours a duty counts: its length less its unpaid break.
                hours: d => d.start.durationMinutes(d.end).subtract(d.unpaidBreak).divide(60.0),
                fields: { costCentre: Schedule.field.text({ label: "Cost centre" }), note: Schedule.field.text({ label: "Note" }) },
                // The app's check on a draft: Save waits until every duty has a cost centre.
                ready: d => East.equal(d.costCentre, "").ifElse(
                    () => variant("invalid", [{ field: "costCentre", message: "Give the duty a cost centre" }]),
                    () => variant("ready", null)),
            }) }}
            resources={{
                people: Schedule.resources(people.read(), { name: "People", icon: "user", label: p => p.name, group: p => p.team,
                    position: p => p.position, skills: p => p.skills, contract: p => p.contract, agency: p => p.agency,
                    trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual }),
                agencies: Schedule.resources(firms.read(), { name: "Agencies", icon: "building", label: a => a.name }),
            }}
            periods={Schedule.periods(weeks, { every: "week", status: { field: "state", draft: "open", published: "issued" }, dismissed: "dismissed" })}
            targets={Roster.targets(targets, { day: "day", group: "team", shift: "shift", positions: "heads", hours: "hours" })}
            shifts={Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours, order: s => s.order })}
            groups={Roster.groups(groups.read(), { label: t => t.label, order: t => t.order })}
            positions={Roster.positions(roles.read(), { label: p => p.label, code: p => p.code, lead: p => p.lead, order: p => p.order })}
            activities={Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order })}
            proposals={Roster.proposals(ideas.read(), { person: s => s.person, day: s => s.day, group: s => s.team, shift: s => s.shift, reason: s => s.why })}
            rules={{ rest: 10.0 }}
            library={[Roster.library.people(), Roster.library.activities(), Roster.library.tab(roles.read(), {
                name: "Positions", icon: "id-badge", label: p => p.label, meta: p => some(p.code),
                drop: (_p, key) => Schedule.patch(Duty, { role: key }),
            })]} />
        </Box>;
    }}</Reactive>),
});
```

**Phone.** The same props in a `maxWidth="390px"` box; below 480px of main,
every command is an explicit card action, as today.

### 5.8 The fit and the check

```tsx
// The app's fit, on e3: who fits a Find fix's need. Each assignment of the request's week carries its own row.
export const staffFitBody = East.function([Roster.Types.FitRequest(Duty)], Roster.Types.FitResult, ($, req) => {
    const answer = $.const(Roster.answer(Duty));
    const rule = $.const(Roster.fit(Duty));
    const weekHours = $.const(Roster.weekHours(Duty));
    const hours = $.const(weekHours(req.week, req.context));
    return answer(req, East.function([Roster.Types.FitRequest(Duty), Roster.Types.Person], Roster.Types.Fit, ($2, request, person) => {
        const verdict = $2.const(rule(request, person));
        $2.match(verdict, { refused: ($3) => { $3.return(verdict); } });
        const fits = $2.const(verdict.unwrap("fits"));
        return variant("fits", { score: person.contract.subtract(hours.get(person.key, () => 0.0)), why: fits.why, warn: fits.warn });
    }));
});
export const staffFit = e3.function("warehouse_staff_fit", staffFitBody);

// The app's check sees the pay too: overtime on a duty nobody has agreed.
const check = $.const(East.function([Roster.Types.CheckContext(Duty)], ArrayType(Roster.Types.Issue), ($2, cx) => {
    const issues = $2.let([], ArrayType(Roster.Types.Issue));
    $2.for(cx.week.assignments, ($3, a, id) => {
        const costs = $3.const(cx.pay.get(id, () => East.value(new Map(), DictType(StringType, FloatType))));
        $3.if(costs.has("OT1").and(() => East.notEqual(a.row.agreed, some(true))), ($4) => {
            $4(issues.pushLast({ kind: variant("breach", null), tone: variant("info", null),
                title: "Overtime not agreed", detail: East.str`${a.row.team} · ${a.row.shift}`,
                slot: some(a.slot), assignment: some(id), flag: some("OT"), fix: none }));
        });
    });
    return issues;
}));
```

## 6. Allocation

### 6.1 Props

```ts
interface AllocationProps {
    events: { [slot: string]: ScheduleEventKind };    // exactly one kind: the bins, an instant kind
    resources: { [slot: string]: ScheduleResourceKind };   // the lanes' kind (`resource.of`) and the resources' kind (`parts.of`)
    arrivals: AllocationArrivals;                     // Allocation.arrivals(rows, …)
    periods?: SchedulePeriods;                        // Publish; without it, none
    fit: BoundFunc<[FitRequest(R)], FitResult>;
    check?: SubtypeExprOrValue<FunctionType<[CheckContext(R)], ArrayType<Issue>>>;
    columns?: readonly { key: string; label: string; text: (row) => String; tone?: (row) => Option<StatusToken>; table?: boolean }[];
    slice?: RecordSlicesChromeOptions;                // sources: the bin kind's slot, the lanes' and resources' slots, `arrivals`
    library?: readonly AllocationLibraryDeclaration[];   // Allocation.library.arrivals(), .resources()
    inspector?: boolean;
    labels?: { lane?: AllocationNoun; arrival?: AllocationNoun; resource?: AllocationNoun; quantity?: string };
    every?, rules?, view?, horizon?, title?, readOnly?, id?, table?;   // as today
}
```

A second event kind, or a resource kind that is neither the lanes' nor the
resources', is refused.

### 6.2 Roles

The bin kind (`Schedule.events`, an instant kind):

| Role | Field type | What the board does with it | |
|---|---|---|---|
| `at` | `DateTime` | the bin's time; its UTC day is its plan day; a batch's bins follow one minute apart | required |
| `resource` | `String`, a lane kind's key | its lane | required |
| `arrival` | `Option<String>`, an arrival's key | the arrival it books; `none` is a reservation | required |
| `quantity` | `{ field: Float; unit? }` (Plan's) | its quantity, with the unit everywhere a quantity shows | required |
| `parts` | `{ field: Dict<String, Float>; of: <resources slot> }` | the quantity on each resource, by key; empty while not linked | required |
| `hold` | `TimeStep` | how long a resource holds it, kept from booking | required |
| `kind` | `Option<String>` | what it goes with on a resource, kept from booking | optional: kind mates don't score |
| `fields`, `inspector`, `ready`, `entries` | as `Schedule.events` | the inspector's form over the other fields, the app's own bin form, its check, reads by key | optional |

Lanes take `offset?` (§4.2); resources take `min` and `max`, and `note?`,
`hold?`, `jobs?`, beside Schedule's `group` and `meta`.

### 6.3 Types

```ts
Allocation.Types.Bin(R)          = StructType({ lane: StringType, at: DateTimeType, arrival: OptionType(StringType), quantity: FloatType,
                                               kind: OptionType(StringType), hold: TimeStepType, parts: DictType(StringType, FloatType), row: R });
Allocation.Types.Day(R)          = StructType({ status: Status, bins: DictType(StringType, Bin(R)) });
Allocation.Types.Status          = VariantType({ draft: NullType, published: StructType({ at: OptionType(DateTimeType) }), other: StringType });   // Schedule's period status
Allocation.Types.Arrival         = /* today's Event: key, label, meta, quantity, hold, kind, due, window, details */;
Allocation.Types.Context         = /* as today, `events` → `arrivals` */;
Allocation.Types.FitAsk          = VariantType({ place: StructType({ subject: VariantType({ bin: StringType, arrival: StringType }), quantity: FloatType }),
                                                take: StructType({ resource: StringType }) });
Allocation.Types.FitResult       = /* as today, `events` → `arrivals` */;
Allocation.Types.Candidate       = /* as today, `event` → `arrival` */;
Allocation.Types.FitRequest(R)   = StructType({ day: DateTimeType, plan: Day(R), ask: FitAsk, context: Context });
Allocation.Types.CheckContext(R) = StructType({ day: DateTimeType, plan: Day(R), context: Context, loads: DictType(StringType, Load) });
```

`Allocation.loads(R)`, `candidates(R)`, `answer(R)`, `lookahead(R)`, `check(R)`
and `slots(R)` take the row type where they took `V`; `Allocation.fit` needs
none.

### 6.4 Arrivals

`Allocation.arrivals(rows, { label, quantity, hold, kind?, meta?, due?, window?, details?, values? })`
reads what the board books from, as `Allocation.events` did. Booking an arrival
writes the bin's roles — `arrival` its key, `quantity`, `kind` and `hold` from
its accessors, `parts` empty, `at` and `resource` where it is booked — and
`values`' struct into the row's other fields. `values` returns the row's fields
that no role maps (`ScheduleValuesOf`); without it, those fields take their
type's default. A reservation's unmapped fields take their type's default.

### 6.5 Examples

**Minimal.**

```tsx
export const Bin = StructType({
    bay: StringType, at: DateTimeType, load: OptionType(StringType),
    m3: FloatType, kilns: DictType(StringType, FloatType), dryFor: TimeStepType,
});
export const kilnBins = e3.record("kiln_bins", DictType(StringType, Bin), new Map());
export const kilnBinsPatch = e3.mutation.patch(kilnBins);
// arrivals, kilns and yardBays, and the day yardDay: the kiln yard's own records.

export const yardFit = e3.function("yard_fit", East.function([Allocation.Types.FitRequest(Bin)], Allocation.Types.FitResult, ($, req) => {
    const answer = $.const(Allocation.answer(Bin));
    const rule = $.const(Allocation.fit);
    return answer(req, rule, "ranked by load, kind and spare days");
}));

export const allocationMinimal = example({
    description: "The smallest board over the app's own records: bins, bays, kilns and the day's loads, and the yard's fit on e3.",
    keywords: ["Allocation", "Schedule.events", "Schedule.resources", "Allocation.arrivals", "Func.bind"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const bins = $.let(Record.bind(kilnBins, [kilnBinsPatch]));
        const loads = $.let(Data.bind(arrivals));
        const yard = $.let(Data.bind(kilns));
        const bays = $.let(Data.bind(yardBays));
        const fit = $.let(Func.bind(yardFit));
        return <Box width="100%" height="760px"><Allocation id="allocationMinimal" fit={fit} view={{ date: yardDay }}
            events={{ bin: Schedule.events(bins, {
                name: "Bin", icon: "box",
                at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
                quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor",
            }) }}
            resources={{
                bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
                kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, min: k => k.min, max: k => k.max, jobs: k => k.charges }),
            }}
            arrivals={Allocation.arrivals(loads.read(), { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays) })} />
        </Box>;
    }}</Reactive>),
});
```

**Full, bound (the kiln yard).** The records:

```ts
export const KilnBin = StructType({
    bay: StringType, at: DateTimeType, load: OptionType(StringType),          // where, when, which load (none: a reservation)
    m3: FloatType, spec: OptionType(StringType), dryFor: TimeStepType,
    kilns: DictType(StringType, FloatType),                                  // the split: m³ on each kiln
    specBooked: StringType, specMeasured: StringType,                        // the yard's own
    gradeBooked: StringType, gradeMeasured: StringType, instruction: OptionType(StringType),
});
export const YardDay = StructType({ state: VariantType({ draft: NullType, issued: StructType({ at: DateTimeType }) }) });
export const kilnBins = e3.record("kiln_bins", DictType(StringType, KilnBin), binSeed);
export const kilnBinsPatch = e3.mutation.patch(kilnBins);
export const kilnBinsByTime = e3.recordIndex.interval("kiln_bins_by_time", kilnBins, { from: "at", to: "at" });
export const yardDays = e3.record("yard_days", DictType(DateTimeType, YardDay), daySeed);
export const yardDaysPatch = e3.mutation.patch(yardDays);
```

The board:

```tsx
export const allocationKilnYard = example({
    description: "The kiln yard's board over its own records: its bins, each with the yard's spec and grade beside the board's roles, read a day at a time through the slice; the days it publishes; a check over the bins' own fields; the rail over the bays, the kilns and the loads — each source with its icon, and each narrowing every place its rows appear, the Library's tabs included; the yard's fields as columns; the Arrivals and Resources library; the inspector; and the yard's greedy fit on e3.",
    keywords: ["Allocation", "Schedule.events", "Schedule.resources", "Schedule.periods", "Allocation.arrivals", "Slice.bindRecords", "Data.bindPaged", "Func.bind", "fit", "check", "columns", "links", "Publish", "Library", "narrowing"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        // What the board writes: the bins and the days of the plan, each through its patch door.
        const bins = $.let(Record.bind(kilnBins, [kilnBinsPatch]));
        const entries = $.let(Data.bindPaged(kilnBins));
        const byTime = $.let(Data.bindPaged(kilnBins, { indexes: [kilnBinsByTime] }));
        const days = $.let(Record.bind(yardDays, [yardDaysPatch]));
        // Every bay, kiln and load is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea, yardBaysByCover] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroupMax, kilnsByName] }));
        const loadIndex = $.let(Data.bindPaged(arrivals, { indexes: [arrivalsBySpec] }));
        const slice = $.let(Slice.bindRecords("ex.allocationKilnYard", {
            // The day's bins: the board's navigation writes the range; no chip picks the day.
            bin: { source: byTime, range: "at" },
            bays: { source: bayIndex, icon: { prefix: "fas", name: "warehouse" },
                fields: { area: { label: "Area", hints: ["North", "South"] }, cover: { label: "Cover", hints: ["Covered", "Open"] } } },
            // A max narrows within a group (one index on group, then max); a name is searched by its start.
            kilns: { source: kilnIndex, icon: { prefix: "fas", name: "fire" },
                fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] }, max: { label: "Max m³" }, name: { label: "Name" } } },
            arrivals: { source: loadIndex, icon: { prefix: "fas", name: "truck" }, fields: { spec: { label: "Spec", hints: ["MC08", "MC10", "MC12", "MC14", "MC16", "MC18", "MC20", "MC22"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { kilns: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { kilns: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { kilns: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { bays: { area: ["North"] }, kilns: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const fit = $.let(Func.bind(yardFit));
        // The yard's check reads its own fields: a bin measured off its booked spec is flagged, never refused.
        const check = $.const(East.function([Allocation.Types.CheckContext(KilnBin)], ArrayType(Allocation.Types.Issue), ($2, cx) => {
            const issues = $2.let([], ArrayType(Allocation.Types.Issue));
            $2.for(cx.plan.bins, ($3, bin, id) => {
                $3.match(bin.arrival, { some: ($4, code) => {
                    $4.if(East.notEqual(bin.row.specBooked, bin.row.specMeasured), ($5) => {
                        $5(issues.pushLast({ kind: variant("custom", "Spec mismatch"), tone: variant("neutral", null),
                            title: East.str`${code} · bin ${id}`,
                            detail: East.str`Spec booked ${bin.row.specBooked} · measured ${bin.row.specMeasured} · ${bin.lane} ${bin.at.printFormatted("HH:mm")}`,
                            bin: some(id), resource: none, flag: some("≠ spec"), fix: none }));
                    });
                } });
            });
            return issues;
        }));
        return <Box width="100%" height="900px"><Allocation id="allocationKilnYard" title="Kiln loading" fit={fit} check={check} slice={{ slice }} inspector
            library={[Allocation.library.arrivals(), Allocation.library.resources()]} view={{ layout: "timeline", date: yardDay }}
            events={{ bin: Schedule.events(bins, {
                name: "Bin", icon: "box", entries,
                at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
                quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
                fields: { specMeasured: Schedule.field.text({ label: "Spec measured" }), instruction: Schedule.field.text({ label: "Loading instruction" }) },
            }) }}
            resources={{
                bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
                kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group,
                    meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                    min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges }),
            }}
            arrivals={Allocation.arrivals(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                // A booked bin's own fields: the ones no role maps.
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            periods={Schedule.periods(days, { every: "day", status: { field: "state", draft: "draft", published: "issued" } })}
            columns={[
                { key: "spec", label: "Spec", text: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => b.specMeasured, () => East.str`booked ${b.specBooked} · measured ${b.specMeasured}`),
                    tone: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: b => b.gradeMeasured.startsWith(b.gradeBooked).ifElse(() => b.gradeMeasured, () => East.str`booked ${b.gradeBooked} · measured ${b.gradeMeasured}`), table: false },
            ]} />
        </Box>;
    }}</Reactive>),
});
```

The board keeps its own nouns here: lane, arrival and resource. The yard's
own words are `allocationLabels`', over the Table (`Allocation Spec.md` §3.4):

```tsx
labels={{ lane: "Bay", arrival: { one: "Delivery", other: "Deliveries" }, resource: "Kiln", quantity: "Vol" }}
```

In a 390px box the same props give a card per kiln, or per slot in the Table,
with Book, Reserve, Allocate, Unlink and Back to Arrivals in anchored popovers.

## 7. Saving, publishing and reading

1. **Sessions.** Each record the builder writes is one session of one
   `EditHistory` (`east-ui-components/src/editing/history.ts`): the Roster's
   duties, its periods and its targets; the Allocation's bins and its periods.
   A gesture records the rows it changes across them as one step.
2. **Save** sends each session's batch as its own request through its record's
   patch door (`Record.onApply(record, { keyed: true })`). A conflict or
   refusal keeps that session's drafts and leaves the others' commits standing.
3. **Publish** saves first; once every session reads back confirmed, it records
   the period's status and saves the periods session (§4.3, rule 4).
4. **Conflicts are per row.** Two sessions editing different duties of one week
   both commit; the same duty in both is the second's conflict, naming it.
5. **Reads.** The week's or day's events come through the kind's source of the
   slice (an interval index, its range the period and, for the Roster, the
   week before it, which Copy reads) or the record whole. The source takes no
   `fields`. Targets come through a `targets` source the same way, or whole.
   Periods by key through `entries`, or whole.
6. **Keys.** A new duty's, bin's or target's key is minted unique in its record
   across every period (`crypto.randomUUID()`, retried against the keys read).
7. **Drafts outside the window** stay in their session, as the Calendar's do;
   Save includes them.

## 8. Behaviour

| # | Rule | Owner | Test |
|---|---|---|---|
| B1 | A gesture writes only its roles' fields; every other field of the row reads back as it was. | `e3-ui/src/schedule/events.ts` (`write`) | spec: a row with fields of the app's own, moved and saved, reads back whole |
| B2 | A role naming a missing field, or a field of the wrong type, is refused at build, naming the role, the field and its type. | `schedule/events.ts` | spec per role |
| B3 | The Calendar and Plan refuse a kind without `title`; the Roster and the Allocation take one. | `calendar/index.ts`, `plan/plan.ts` | spec |
| B4 | Each removed prop and type (§2) is refused at build, naming its replacement. | `roster/index.ts`, `allocation/index.ts` | spec per prop |
| B5 | One gesture across records is one undo step: accepting a proposal records the duty and the dismissal together. | renderer `editing.ts` | DOM: Accept, Undo |
| B6 | Save sends each changed record's batch as its own request; a conflict on one keeps its drafts and leaves the others committed. | `editing/history.ts` | DOM: one refused write |
| B7 | Publish saves the period's rows, then writes its status; a failed save leaves it a draft, drafts kept. | renderer `actions.ts` | DOM: a refused duties write |
| B8 | A published period is read-only in every layout, phones included. | renderer | DOM and responsive |
| B9 | Edits to two different duties of one week, from two sessions, both commit. | `Record.onApply(record, { keyed: true })` | e3-web |
| B10 | A duty's day, its times against its shift's and its hours follow §5.5; a move and back leaves its times as they were. | `e3-ui/src/roster/` | spec: overnight shift, early start, late finish, unpaid break, move and back |
| B11 | Coverage, pay, checks and fits read every duty of the week, whatever the rail shows. | `roster/coverage.ts`, renderer | DOM with a narrowed rail |
| B12 | The board's day holds the bins whose `at` falls in it; a batch's bins keep one minute apart. | `e3-ui/src/allocation/` | spec |
| B13 | Booking an arrival writes the roles and `values`' fields; a reservation's unmapped fields take their type's default. | `schedule/events.ts`, allocation writes | spec |
| B14 | Through its kind's source, a builder reads only its period's events, never the record whole. | `schedule/record-window.ts`, `schedule/events.ts` (`rows`), `schedule/periods.ts` | spec: a kind's `rows` and the periods' through paged reads in memory, searches and pages counted, no whole read; e3-web: bounded reads through the slice |
| B15 | A new duty's, bin's or target's key is minted unique in its record, across every period. | renderer | DOM |
| B16 | The fit's, the pay's and the check's requests carry each assignment's and bin's own row. | e3-ui types | spec over a decoded request |
| B17 | Pay is asked a person at a time; a change asks again only for the people whose duties it touched; the totals are its sums, and the check is given them. | renderer `model.ts` | DOM: moving one person's duty past their threshold asks for that person alone, and every total follows |

The renderers' other rules — gestures, layouts, the narrow layout, the library,
the inspector, fits, links, the Table — are unchanged and keep their tests.

## 9. Implementation and reuse

The renderers keep their internal week and day model: they assemble it from the
app's rows, drafts in place, rather than reading it from a record, so the grid,
the cards, the timeline, the table, the library, the toolbar and the footer
don't change.

**e3-ui (the tags).**

- `schedule/events.ts`: the roles of §4.1, checked as Plan's `state`,
  `quantity` and `lane` are; `title` optional; `buildRoster(slot, part)` and
  `buildAllocation(slot, part)` beside `build` and `buildPlan`, reusing
  `kindParts` and `readsOf` (the kind's reads, through its source or whole),
  `refOf` and `resourceValue` (a resource's ref and its field's value).
- `schedule/session.ts` (new): the editing session over a record, moved out of
  `events.ts` unchanged — `Record.onApply(record, { keyed: true })`, its
  snapshot or its revision, its reads by key — which each event kind and the
  periods build.
- `schedule/accessor.ts` (new): an accessor reified once, held to the type it
  returns; `schedule/resources.ts` reifies every accessor through it, and
  carries them as `accessors` (§4.2).
- `schedule/periods.ts` (new): `Schedule.periods` (§4.3).
- `schedule/index.ts`: `scheduleTitled`, the Calendar's and Plan's title check.
- `roster/`: the props and types of §5.1 and §5.3; `Roster.shifts`, `groups`,
  `positions`, `proposals` and `targets`; the functions of §5.4 over the row
  type; `pay`; the refusals of §2.
- `allocation/`: the props and types of §6.1 and §6.3; `Allocation.arrivals`;
  the functions over the row type; the refusals of §2.

**e3-ui-components (the renderers).**

- `roster/editing.ts`, `allocation/editing.ts`: one `useEditHistory` over a
  session per record; the week or day assembled from those sessions' rows —
  each stored row's roles from the kind's `rows`, a drafted row's from `read`.
- `roster/actions.ts`, `allocation/actions.ts`: each command computes the next
  week or day as today, then records the rows it changed (through `write`, and
  `create` for a new one) across sessions as one step; Publish runs Save, then
  the status (§7).
- `roster/data.ts`, `allocation/data.ts`: the period's rows through the kind's
  `rows`, kept by the record's revision and the window, so a render never reads
  them again (a read costs some 30 µs a row, half of it the bytes; a gesture's
  write 0.04 ms); a row decoded only where a request needs it; the period row
  by key through the periods' `rows`.
- `roster/model.ts`: the pure functions compiled once per row type (as the
  Allocation's domain is); pay per person, cached by the bytes of that
  person's duties.
- The inspector shows the row's unmapped fields in the shared `FieldForm`
  (`Fields.specs`, the kind's `fields`), and a duty's start and end; the
  Allocation's noun is "Arrival".

**Reused as it is.**

| Part | Where |
|---|---|
| field checks (`role(…)`), a kind's reads (`readsOf`), a resource's ref and value (`refOf`, `resourceValue`) | `e3-ui/src/schedule/events.ts` |
| a record's editing session, its Save and its reads by key | `e3-ui/src/schedule/session.ts` |
| a kind's reads through its source of the slice | `e3-ui/src/schedule/record-window.ts`, `utils/record-sources.ts` |
| Save per row, conflicts by entry | `Record.onApply(record, { keyed: true })`, `e3-ui/src/bind/record.ts` |
| one history over several sessions; session banners | `east-ui-components/src/editing/history.ts`, `use-edit-history.ts`, `SessionBanners` |
| the inspector's form over the app's fields | `FieldForm`, `Fields.specs`; a kind's own form through `rowInspector` |
| a library card's drop | `Schedule.patch`, `schedule/library.ts` |
| the fit's call, keys and answers | `e3-ui-components/src/shared/func/use-fit.ts` |
| a new row's unmapped fields | East's `defaultValue` |

## 10. Wires

Entries for `docs/conventions/WIRE_MIGRATION.md`:

- **e3-ui's `Roster` takes Schedule's kinds (package-borne).** The `Roster`
  extension's payload trades `read`, `apply` and `window` over
  `Roster.Types.Weeks` for its event kind, its periods and its targets, closed
  over bytes as Schedule's kinds are, and trades `costs` for `pay`.
  `Roster.Types.Weeks` and `Roster.Types.Costs` are removed; `Week` and
  `Assignment` carry the app's row and lose `offset`, `overtime` and `agreed`.
  Packages are re-exported, and the dataflow computes each UI task's output
  again under the new type. A UI task's output is not stored state, so no
  repository upgrade step ships with it. An application's weeks, forecast and
  proposals records hold types that are removed; moving them into the
  application's own records is those records' own migration, as with any
  record whose type an application changes.
- **Schedule's kinds gain the Roster's and the Allocation's roles
  (package-borne).** The Calendar's and Plan's kinds on the wire are unchanged.
- **The Allocation** is new in this release; its interface changes before it
  ships and needs no entry of its own.

## 11. Tasks, in landing order

Each is a sub-issue of the epic and a checkbox in the PR.

1. **The spec.** This document, and `Allocation Spec.md` brought onto it (§2's
   Allocation rows).
2. **Schedule.** §4: the builders' roles on `Schedule.events`, an optional
   `title` and `scheduleTitled`, `buildRoster` and `buildAllocation` (each
   stored row's roles beside its bytes, `read`, `write`, `create`); the
   accessors on `Schedule.resources`; `Schedule.periods`; the shared session
   (`session.ts`) and accessor (`accessor.ts`). B1–B3, B13 (the write), B14 (in
   memory). `Schedule.periods'` and the roles' examples are the builders'
   (tasks 5 and 8), as `Schedule.events'` are the Calendar's and Plan's.
3. **The Roster's tag.** §5.1–§5.6: the props, the types, the list accessors,
   `Roster.targets`, `pay`, the functions over the row type, the payload, the
   refusals. B4, B10, B16.
4. **The Roster's renderer.** §7 and §9: one history over its records, the
   week assembled from rows, commands as row writes, Publish's order, pay per
   person, the inspector over the app's fields and a duty's times. B5–B9, B11,
   B15, B17.
5. **The Roster's examples, showcase and tests.** Minimal, the warehouse,
   people, week, published, a custom inspector, phone, and a long history
   through the slice; the responsive invariants that read them.
6. **The Allocation's tag.** §6: the props, the types, `Allocation.arrivals`,
   the functions over the row type, the payload, the refusals, the Arrival
   noun. B4, B12, B13, B16.
7. **The Allocation's renderer.** As the Roster's, over bins and days.
8. **The Allocation's examples, showcase and tests.** Every current example
   moved onto the app's records.
9. **Docs.** The e3-ui skill and guides, the wire entries (§10), the plugin
   index regenerated.
