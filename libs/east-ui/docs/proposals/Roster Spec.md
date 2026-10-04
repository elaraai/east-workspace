# Roster — design

The e3-ui `Roster`: a week's roster, edited in place. Groups of people work
shifts day by day, and each shift's requirement (positions, and hours needed
by skill) sits beside who is on it. The rules are checked as you go. It is
laid out in `BuilderFrame` as Studio's builder, the query builder and the
Calendar are, it has drag and drop throughout, and it replaces east-ui's
`Roster` and `Board`.

This document is the design the Roster epic builds. Each sub-issue copies the
sections it owns. `Roster Spec.html` beside it is the visual design.

## 0. The files

| File | What it is |
|---|---|
| `Roster Spec.html` | The hi-fi mock: Claude Design's "Roster Editor" export, its sample data moved to a warehouse and every person given a synthetic name, self-contained but for React 18 (unpkg), Font Awesome (cdnjs) and the fonts (Google Fonts). |
| `Roster Spec.png` and `Roster Spec - <view>.png` | Resting renders of the day and week views, an assignment in the inspector, the Issues tab, the Activities tab and the dark theme, for people browsing the repo. They are generated from the mock and never read by an agent. |
| `Roster Spec.md` | This design. |

**Opening the mock.** Open the file in a browser. Every view and state is
reachable by URL parameter:

| Parameter | Values | Default |
|---|---|---|
| `span` | `day`, `week` (the product's `period`) | `day` |
| `day` | `0`–`6`, the week's day (0 is Sunday in the mock) | `4`, Thursday |
| `week` | an offset from the current week: `-1` is published, `1` not started | `0`, the draft |
| `select` | `asg:<id>` (`asg:s1`), `slot:<day>\|<group>\|<shift>` (`slot:4\|inbound\|early`), `person:<id>` (`person:nochre`), `row:<group>\|<row>` (`row:inbound\|work`), `shift:<shift>` (`shift:early`) | none |
| `tab` | `people`, `activities` (the library's tab) | `people` |
| `inspector` | `details`, `issues` | `details` |
| `theme` | `light`, `dark` | `light` |
| `density` | `comfortable`, `compact` | `comfortable` |
| `requirements` | `false` hides the requirement rows | shown |
| `chip` | `skills`, `hours` | `skills` |
| `left`, `right` | `0` collapses that pane to its rail | open |

For example `Roster Spec.html?span=week`, or `?select=asg:s1` for A. Alder,
the inbound early shift's supervisor, in the inspector, or
`?select=person:nochre` for N. Ochre, who is off that day. A person's id is
their name's letters in lower case. The mock's current week is W37, Sunday
5 to Saturday 11 March 2028, and its day is Thursday 9 March. Opened from
disk, the runtime's re-read of its own page is refused by the browser's
`file://` rule and logged as a console error; the page works either way, and
served by any static server it is not logged. The mock is a desktop design;
the product's phone behaviour is `BuilderFrame`'s (§7).

An agent measures the mock in a headless browser, through its DOM; nobody
reads a screenshot.

## 1. Summary

- **What.** `<Roster.Builder>` plans who works which shift, day by day,
  against what each shift needs.
- **Where.** The interface is in e3-ui (`libs/east-ui/packages/e3-ui/src/roster/`)
  and the renderer in e3-ui-components (`src/roster/`), as Studio's, the query
  builder's and the Calendar's are. It binds records, so it is an e3
  component.
- **Slots.**
  - The roster: one record keyed by week, in the roster's own types, as
    Studio's pages record is Studio's, bound with its patch mutation.
  - People: the app's own record, read through accessors.
  - Proposals: the output of the app's model.
  - Forecast: the requirements a new week starts from.
- **Config.** Groups and their skills, duties, shifts, positions and agencies,
  as typed East data bound with `$.let`.
- **Draws.** `BuilderFrame`: one toolbar; the library (People · Activities) in
  the start pane; the roster grid by day or by week in main; the inspector
  (Details · Issues) in the end pane; a footer with the legend and the
  counts.
- **Built in.**
  - drag and drop: people, agency requests and activities onto shifts, and
    chips moved between shifts;
  - the rules and the coverage, and issues with their fixes;
  - the model's proposals, to accept or reject;
  - undo and redo, Apply, and Publish.

  The app wires none of it.
- **Replaces.** east-ui's `Board` (areas × shifts for one day, whose grid is
  this builder's Day view, editable) and `Roster` (people × days, which
  becomes this builder's People layout, §14), both removed.

## 2. Decisions

These are settled.

1. **`Roster` is in e3-ui**, record-bound like Studio, the query builder and
   the Calendar. east-ui's `Board` and `Roster` are removed with their
   renderers, recipes, examples and skill text; Roster's people × days view
   returns as the People layout (§14).
2. **The roster is one record keyed by week** (its first day), in the
   roster's own types, as Studio's pages record is Studio's. A week is one
   entry, so one Apply writes a week's assignments, requirements and
   dismissals together.
3. **People are the app's own record**, read through accessors. The roster
   never writes them.
4. **Groups, skills, duties, shifts, positions and agencies are typed data**
   the app binds with `$.let`, or reads from records of its own.
5. **Rules and coverage are pure East functions** (`Roster.check`,
   `Roster.coverage`), the same in the builder and in an e3 task. The
   built-in rules can each be turned off, and the app adds its own through
   `check`.
6. **Proposals are data** from the app's model. Accepting drafts an
   assignment; rejecting drafts the proposal's key into the week's
   `dismissed`, which the model can read.
7. **Publish** sets a week's status, and a published week is read-only.
8. **A new week starts from `forecast`**, the app's requirements by week.
   "Copy last week's roster" copies assignments with their positions and
   activities.
9. **A week starts on a configured day** (Monday by default; Sunday in the
   mock). Times show as stored, in UTC, as the Calendar's and Plan's do.
10. **Costs are optional**: hourly rates by kind and a budget per day.
11. **The rest rule checks within the week in view**, as the mock does. Rest
    across a week's edge would read the neighbouring weeks; that can follow.
12. **Sample data is a warehouse** (inbound, picking, dispatch; early, late
    and night shifts; associates and supervisors; agency staff from
    Northside Staffing), and every person in it has a synthetic name.
    Nothing names a client, its trade or its people, in the mock, the
    examples, the showcase or the tests.
13. **Data in examples and tests is an East value** bound once with
    `$.let(value, Type)` inside the East body: never a module-scope
    TypeScript constant, and never a TypeScript helper that builds one.
    Times are East values: a time of day is `{ hour: 6n, minute: 0n }`.

## 3. The authoring surface

### 3.1 The records an app declares

People are the app's own: it keeps them as HR does, in its own type, and the
roster only reads them. The roster is the tool's own artifact, so its record
takes the roster's types, as a Studio app's pages record takes
`Studio.Types.Pages`.

```ts
// records.ts
import { ArrayType, BooleanType, DateTimeType, DictType, FloatType, NullType, OptionType, SetType, StringType, StructType, VariantType, variant } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Roster } from "@elaraai/e3-ui";

// The app's people, as it keeps them. The roster only reads them.
export const PersonType = StructType({
    name:       StringType,
    team:       StringType,                   // a group's key
    grade:      VariantType({ associate: NullType, supervisor: NullType, deputy: NullType }),
    skills:     SetType(StringType),           // skill keys
    hours:      FloatType,                     // contracted hours a week
    employment: VariantType({ permanent: NullType, agency: NullType }),
    trainer:    BooleanType,
    trainee:    BooleanType,
    usual:      OptionType(StringType),        // the shift they usually work
});
export const people = e3.record("people", DictType(StringType, PersonType), new Map());

// The roster: one entry per week, keyed by the week's first day, in the roster's own types.
export const roster      = e3.record("roster", Roster.Types.Weeks, new Map());
export const rosterPatch = e3.mutation.patch(roster);

// What the app's model proposes, and the requirements its forecast gives each week.
export const proposals = e3.input("proposals", ArrayType(Roster.Types.Proposal), variant("value", []));
export const forecast  = e3.input("forecast", DictType(DateTimeType, Roster.Types.Requirements), variant("value", new Map()));
```

### 3.2 The smallest builder

```tsx
// rota.tsx
import { ArrayType, East } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui";
import { Record, Roster, ui } from "@elaraai/e3-ui";
import * as d from "./records.js";

export const rota = ui("rota", [], East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const staff  = $.let(Record.bind(d.people, []));
        const weeks  = $.let(Record.bind(d.roster, [d.rosterPatch]));
        const groups = $.let([{ key: "inbound", label: "Inbound", skills: [] }], ArrayType(Roster.Types.Group));
        const shifts = $.let([{ key: "early", label: "Early", code: "E", start: { hour: 6n, minute: 0n }, hours: 8 }], ArrayType(Roster.Types.Shift));
        return (
            <Roster.Builder
                weeks={weeks}
                people={Roster.people(staff.read(), { name: p => p.name, group: p => p.team })}
                groups={groups}
                shifts={shifts}
            />
        );
    }}</Reactive>
)));
```

That is a working editor. Inbound's people drag onto the early shift of any
day, chips move between days, and Apply commits the week as one patch through
`rosterPatch`. With no requirements a shift shows no positions to fill, and
with no skills there are no activities.

### 3.3 The warehouse roster

The mock's surface: three groups with their skills, a duty open to all, three
shifts, lead positions, an agency, people with every accessor, the model's
proposals, the rules, costs against a budget, and the forecast.

```tsx
// warehouse.tsx
import { ArrayType, East } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui";
import { Data, Record, Roster, ui } from "@elaraai/e3-ui";
import * as d from "./records.js";

export const warehouseRoster = ui("warehouse_roster", [], East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const staff    = $.let(Record.bind(d.people, []));
        const weeks    = $.let(Record.bind(d.roster, [d.rosterPatch]));
        const proposed = $.let(Data.bind(d.proposals));
        const demand   = $.let(Data.bind(d.forecast));
        const groups = $.let([
            { key: "inbound", label: "Inbound", skills: [
                { key: "unload", label: "Unloading", code: "UL" }, { key: "putaway", label: "Put-away", code: "PA" },
                { key: "reach", label: "Reach truck", code: "RT" }, { key: "xdock", label: "Cross-dock", code: "XD" },
                { key: "rcvqa", label: "Receiving QA", code: "QA" }, { key: "yard", label: "Yard", code: "YD" } ] },
            { key: "picking", label: "Picking", skills: [
                { key: "pick", label: "Order picking", code: "OP" }, { key: "voice", label: "Voice picking", code: "VP" },
                { key: "replen", label: "Replenishment", code: "RP" }, { key: "cold", label: "Cold store · licence", code: "CS" } ] },
            { key: "dispatch", label: "Dispatch", skills: [
                { key: "pack", label: "Packing", code: "PK" }, { key: "load", label: "Loading", code: "LD" },
                { key: "label", label: "Labelling", code: "LB" }, { key: "returns", label: "Returns", code: "RN" },
                { key: "admin", label: "Dispatch admin", code: "DA" }, { key: "hazmat", label: "Hazmat · licence", code: "HZ" } ] },
        ], ArrayType(Roster.Types.Group));
        const duties = $.let([{ key: "general", label: "General duties", code: "GD" }], ArrayType(Roster.Types.Skill));
        const shifts = $.let([
            { key: "early", label: "Early", code: "E", start: { hour: 6n,  minute: 0n }, hours: 8 },
            { key: "late",  label: "Late",  code: "L", start: { hour: 14n, minute: 0n }, hours: 8 },
            { key: "night", label: "Night", code: "N", start: { hour: 22n, minute: 0n }, hours: 8 },
        ], ArrayType(Roster.Types.Shift));
        const positions = $.let([
            { key: "associate",  label: "Associate",         code: "",    lead: false },
            { key: "supervisor", label: "Supervisor",        code: "SV",  lead: true },
            { key: "deputy",     label: "Deputy supervisor", code: "DS",  lead: true },
            { key: "acting",     label: "Acting supervisor", code: "ACT", lead: true },
        ], ArrayType(Roster.Types.Position));
        const agencies = $.let([{ key: "northside", name: "Northside Staffing" }], ArrayType(Roster.Types.Agency));
        return (
            <Roster.Builder
                weeks={weeks}
                people={Roster.people(staff.read(), {
                    name:     p => p.name,
                    group:    p => p.team,
                    position: p => p.grade.match({ associate: () => "associate", supervisor: () => "supervisor", deputy: () => "deputy" }),
                    skills:   p => p.skills,
                    contract: p => p.hours,
                    agency:   p => p.employment.hasTag("agency"),
                    trainer:  p => p.trainer,
                    trainee:  p => p.trainee,
                    usual:    p => p.usual,
                })}
                groups={groups}
                duties={duties}
                shifts={shifts}
                positions={positions}
                agencies={agencies}
                proposals={proposed.read()}
                forecast={demand.read()}
                rules={{ rest: 10, lead: true, trainer: true, skill: true, agree: true }}
                costs={{ currency: "$", rates: { permanent: 42, overtime: 63, agency: 51 }, budget: 24800 }}
                view={{ period: "day" }}
                week={{ start: "sunday" }}
            />
        );
    }}</Reactive>
)));
```

### 3.4 Rules in a task

`Roster.coverage` and `Roster.check` are East functions, so a task can run
them over a published week, for example to alert on a week that breaks a
rule:

```ts
// alerts.ts — the published week's issues, for an alert task.
const issues = East.function([Roster.Types.Week, Roster.Types.Context], ArrayType(Roster.Types.Issue), ($, week, context) => {
    const check = $.const(Roster.check);
    return check(week, context);
});
```

The builder calls the same two functions over the drafted week. An app's own
rules go in `check`: an East function from `Roster.Types.CheckContext` to
`Array<Roster.Types.Issue>`, whose issues join the built-in ones everywhere
issues show.

## 4. The options

### 4.1 `Roster.people(rows, config)` — the people

Any `Dict<String, P>` of the app's, usually a record's `read()`, with
accessors that take the row and its key, `(row, key) => …`, as the Calendar's
and Plan's do. Only `name` and `group` are required.

| Accessor | Returns | What it gives the roster |
|---|---|---|
| `name` | `String` | The name on chips, cards and the inspector, and its initials on the avatar. |
| `group` | `String` | Their home group's key. |
| `position` | `String` | The position they take when dropped on a shift; the first position that doesn't lead when omitted. |
| `skills` | `Set<String>` | The skills they hold, by key: coverage, the fit (`5/6`) and the skill check. |
| `contract` | `Float` | Contracted hours a week, which the card's meter and the overtime read-out measure against. |
| `agency` | `Boolean` | Agency staff rather than permanent: the agency rate, the `AG` badge, no skills record. |
| `trainer`, `trainee` | `Boolean` | For the trainer rule. |
| `usual` | `Option<String>` | The shift they usually work, shown on their card and in the inspector. |

### 4.2 `Roster.Builder` props

| Prop | Takes | What it does |
|---|---|---|
| `weeks` | the roster record, bound with its patch | What the builder reads and commits through: `Record.bind(roster, [rosterPatch])`. |
| `window` | a `Data.bindPaged` handle over it | Read the roster a week at a time (a key seek) instead of whole, for a long history. |
| `people` | `Roster.people(rows, config)` | The people the roster draws from (§4.1). |
| `groups` | `Array<Roster.Types.Group>` | The groups, in order, each with its skills. A group's rows are its requirement row and its roster row. |
| `duties` | `Array<Roster.Types.Skill>` | Work any group's people can take with no skill held (the mock's General duties). Its lines show no holders and never a gap. |
| `shifts` | `Array<Roster.Types.Shift>` | The shifts, in order: the columns, by day or across the week. |
| `positions` | `Array<Roster.Types.Position>` | What a person does on a shift, and which positions lead it. One position, `Associate`, when omitted. |
| `agencies` | `Array<Roster.Types.Agency>` | Where agency staff are requested from. None: no requests. |
| `proposals` | `Array<Roster.Types.Proposal>` | The app's model's proposals (§10). |
| `forecast` | `Dict<DateTime, Roster.Types.Requirements>` | The requirements a week starts with, by its first day (§9.4). |
| `rules` | `{ rest?, lead?, trainer?, skill?, agree? }` | The built-in checks (§9.6): the least rest between shifts in hours (10 by default), and whether a staffed shift needs a lead, a trainee a trainer, an activity its skill, and a change the person's agreement. All on by default. |
| `check` | `Fn(Roster.Types.CheckContext) → Array<Roster.Types.Issue>` | The app's own rules, beside the built-in ones. |
| `costs` | `{ currency, rates: { permanent, overtime, agency }, budget? }` | Hourly rates by kind and a budget per day. Omitted, the roster shows no costs. |
| `view` | `{ layout?, period?, date? }` | The first view: `"shifts"` (the default, groups × shifts) or `"people"` (people × days, §9.12); `"day"` (the default) or `"week"`; and the date shown (today by default). The viewer's own changes persist per builder after that. |
| `week` | `{ start? }` | The first day of a week, `"monday"` by default. |
| `density` | `"comfortable"`, `"compact"` | Chip height (26px or 22px); compact hides the requirement cells' skill lines. |
| `chip` | `"skills"`, `"hours"` | Whether a chip ends with the person's skills held (`5/6`) or their hours this week (`40h`). |
| `requirements` | `Boolean` | Whether the requirement rows show. Shown by default. |
| `id` | string | Names the builder when a surface holds two: its view state's storage key and its library's drag-source ids. |

## 5. The East types

### 5.1 The roster's own: `Roster.Types`

```ts
Roster.Types.Weeks        = DictType(DateTimeType, Week);            // keyed by each week's first day, UTC midnight
Roster.Types.Week         = StructType({
    status:       Status,
    assignments:  DictType(StringType, Assignment),
    requirements: Requirements,
    dismissed:    SetType(StringType),                                // proposals rejected this week, by key
});
Roster.Types.Status       = VariantType({ draft: NullType, published: StructType({ at: DateTimeType }) });
Roster.Types.Slot         = StructType({ day: IntegerType, group: StringType, shift: StringType });   // day 0 is the week's first
Roster.Types.Who          = VariantType({ person: StringType, request: StringType });                // a person's key, or an agency's for a request
Roster.Types.Assignment   = StructType({
    slot:     Slot,
    who:      Who,
    position: StringType,                                             // a position's key
    activity: OptionType(StringType),                                 // a skill's or duty's key, one a shift
    offset:   FloatType,                                              // hours late (positive) or early (negative)
    overtime: FloatType,                                              // hours past the shift's end
    agreed:   OptionType(BooleanType),                                // a change agreed with the person; none when nothing changed
});
Roster.Types.Requirements = DictType(Slot, Requirement);
Roster.Types.Requirement  = StructType({ positions: IntegerType, hours: DictType(StringType, FloatType) });   // hours needed per skill or duty

Roster.Types.Group    = StructType({ key: StringType, label: StringType, skills: ArrayType(Skill) });
Roster.Types.Skill    = StructType({ key: StringType, label: StringType, code: StringType });
Roster.Types.Shift    = StructType({ key: StringType, label: StringType, code: StringType, start: Clock, hours: FloatType });
Roster.Types.Position = StructType({ key: StringType, label: StringType, code: StringType, lead: BooleanType });
Roster.Types.Agency   = StructType({ key: StringType, name: StringType });
Roster.Types.Clock    = Calendar.Types.Clock;                         // StructType({ hour: IntegerType, minute: IntegerType })

Roster.Types.Person   = StructType({                                  // one person, as the accessors resolve them
    key: StringType, name: StringType, group: StringType, position: StringType, skills: SetType(StringType),
    contract: FloatType, agency: BooleanType, trainer: BooleanType, trainee: BooleanType, usual: OptionType(StringType),
});
Roster.Types.Rules    = StructType({ rest: FloatType, lead: BooleanType, trainer: BooleanType, skill: BooleanType, agree: BooleanType });
Roster.Types.Costs    = StructType({
    currency: StringType,
    rates:    StructType({ permanent: FloatType, overtime: FloatType, agency: FloatType }),
    budget:   OptionType(FloatType),                                  // per day
});
Roster.Types.Context  = StructType({                                  // what the rules and the coverage read
    people: DictType(StringType, Person), groups: ArrayType(Group), duties: ArrayType(Skill),
    shifts: ArrayType(Shift), positions: ArrayType(Position), rules: Rules, costs: OptionType(Costs),
});

Roster.Types.Coverage = StructType({                                  // one slot's arithmetic
    positions: IntegerType, filled: IntegerType, open: IntegerType, people: IntegerType,
    hours: StructType({ permanent: FloatType, agency: FloatType, overtime: FloatType, requested: FloatType, needed: FloatType, rostered: FloatType }),
    lines: ArrayType(StructType({
        skill:    StringType,
        needed:   FloatType,
        holders:  OptionType(IntegerType),                            // none for a duty
        capacity: OptionType(FloatType),                              // holders × the shift's hours
        gap:      FloatType,
        assigned: FloatType,                                          // hours given to it as an activity
    })),
    cost: FloatType, lead: BooleanType, trainer: BooleanType,
});

Roster.Types.Proposal = StructType({ key: StringType, week: DateTimeType, slot: Slot, person: StringType, reason: StringType });
Roster.Types.Issue    = StructType({
    kind:       VariantType({ breach: NullType, gap: NullType, agree: NullType, proposal: NullType }),
    tone:       StatusTokenType,                                      // danger for a hard breach, warning, info …
    title:      StringType,
    detail:     StringType,
    slot:       OptionType(Slot),
    assignment: OptionType(StringType),
    flag:       OptionType(StringType),                               // the chip's short flag: "8.5h rest", "double", "trainee"
    fix:        OptionType(Fix),
});
Roster.Types.Fix      = VariantType({
    request: StringType,                                              // request agency staff for the issue's slot, from this agency
    agree:   NullType,                                                // mark the issue's assignment agreed
    accept:  StringType,                                              // accept this proposal
    move:    StringType,                                              // move the issue's assignment to this shift
    start:   FloatType,                                               // start the issue's assignment later, at this offset
    find:    VariantType({ leads: NullType, trainers: NullType, skill: StringType }),   // show them in the library
});
Roster.Types.CheckContext = StructType({ start: DateTimeType, week: Week, context: Context, coverage: DictType(Slot, Coverage) });

Roster.coverage : (Week, Context) → Dict<Slot, Coverage>
Roster.check    : (Week, Context) → Array<Issue>                     // breaches, gaps and changes to agree, in day, group, shift order
```

### 5.2 What the renderer receives: the payload

Unlike the Calendar's event kinds, the roster's records have fixed types: the
roster's own. So, like Studio's builder, the payload holds the bound record
directly, with only the people resolved through their accessors:

```ts
RosterBuilderPayloadType = StructType({
    weeks:     RosterWeeksHandleType,                // { read, history, commit: { patch } }, as Studio's pages
    window:    OptionType(RosterWeeksPagedType),
    people:    ArrayType(Person),
    groups:    ArrayType(Group), duties: ArrayType(Skill), shifts: ArrayType(Shift),
    positions: ArrayType(Position), agencies: ArrayType(Agency),
    proposals: ArrayType(Proposal),
    forecast:  DictType(DateTimeType, Requirements),
    rules:     Rules,
    check:     OptionType(FunctionType([CheckContext], ArrayType(Issue))),
    costs:     OptionType(Costs),
    settings:  RosterSettingsType,                   // the first view, the week's start, density, chip, requirements shown
    id:        OptionType(StringType),
});
```

The renderer calls `Roster.coverage` and `Roster.check` (and the app's
`check`) over the drafted week as Studio's builder calls its palette and
inspector functions, so the arithmetic is East's and never the renderer's.

## 6. How it relates to the Calendar and Plan

**The Calendar.** The two builders share their parts and differ in their data:

| Shared with the Calendar | In the roster |
|---|---|
| `BuilderFrame`, one toolbar, panes that slide off main during a drag | The same frame, panes and rails |
| `Fields` (#1147), the typed field form | The inspector's editors: an assignment's offset and overtime steppers, its activity, position and agreed; a slot's targets |
| The `Library` parts | The library pane's People and Activities tabs |
| The shared `Editing` session over a record | One session over the roster record, a week's entry a draft |
| The drag grammar (`LibraryRef`, `CellRef`, `DragEvent`) | Every drop (§11) |
| `Calendar.Types.Clock`, `StatusTokenType` | A shift's start; an issue's tone |
| Accessors `(row, key)`; data bound with `$.let` | `Roster.people` |

They differ on purpose in one place: the Calendar takes the app's own
records, one per kind, while the roster's record is the roster's own type, as
Studio's pages are. A roster's slots are discrete (a day, a group, a shift),
not instants on a time axis.

**Plan.** Plan's cards rows (`Plan Spec.md` K6, "the Roster surface") stay
Plan's: chips on a time axis among other rows. `Plan Spec.md` kept east-ui's
`Roster` standalone "for now"; this design settles it. The roster becomes
this builder, and east-ui's `Roster` is removed. The builder depends on
the shared contracts only, never on Plan's internals.

## 7. Layout in BuilderFrame

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ History · <W37 05-11 Mar 2028 v> · Sun..Sat days · Day Week · 8 issues · Apply    │
├───────────────────────────────────────────────────────────────────────────────────┤
│ banners: a published or not-started week; an Apply's refusals                     │
├──────────────┬────────────────────────────────────────────────┬───────────────────┤
│ LIBRARY      │ main: the roster grid                          │ INSPECTOR         │
│ People       │  per group: its requirement row, its roster    │ Details · Issues  │
│ Activities   │  row; columns: shifts (Day) or days x shifts   │ a chip, a person, │
│ search       │  (Week)                                        │ a shift, a summary│
│ filters      │                                                │ fixes, proposals  │
├──────────────┴────────────────────────────────────────────────┴───────────────────┤
│ footer: legend · Draft · 3 changes · 4 to agree · $24.3k of $24.8k · 550 of 564 h │
└───────────────────────────────────────────────────────────────────────────────────┘
```

| Region | Holds |
|---|---|
| Toolbar | The history item (undo · redo · discard), the week control and its picker, the day strip, Day · Week, the issues chip, Apply, Publish. The shared `Toolbar` folds what doesn't fit. |
| Banners | A published or not-started week (§9.4); an Apply's refusal. |
| Start pane "Library" | Tabs People · Activities, each a `Library` (§9.5). |
| Main | The grid (§8). |
| End pane "Inspector" | Tabs Details · Issues (§9.7, §9.8). |
| Footer | The legend, the week's status, the pending changes, the agreements and proposals, the cost against the budget, the hours against those needed. |

The panes are `BuilderFrame`'s: pinned beside main while main keeps 480px,
overlaid with a rail and a scrim on a phone (560px and narrower), and slid off
main during a drag so they never hide a drop target. The builder fills its
parent and draws no border of its own. The mock's two control rows (the
toolbar, and the day strip over the grid) fold into the one toolbar, and its
read-outs move to the footer. Every style is a slot recipe's: renderers set
data attributes and geometry only.

## 8. The views — anatomy, from the mock

Sizes are the mock's (`comfortable` unless said). Each view's sub-issue holds
these with visual invariants in the showcase's responsive suite.

**Toolbar (mock).** At least 60px tall, padding 12px 20px:
- history buttons 32×32, radius 6;
- the week control 32px tall: ‹ and › 30px wide, between them the week
  (`W37` mono 11px 600, `05–11 Mar 2028` mono 11px, a ▾);
- `This week` 32px, mono 10.5px uppercase;
- Day · Week segments 30px tall, mono 10.5px 600 uppercase, each with its
  icon.

In the product the toolbar is the shared `Toolbar`.

**The week picker (mock).** An anchored popover 300px wide, padding 12px:
- a month header in DM Sans 14px 700 between 28px ‹ and ›;
- a header row `WK S M T W T F S` in mono 9.5px;
- a 30px row per week: a 52px week column (a 7px dot, then the week in mono
  10px 600) and the seven dates in mono 11px. The dot is filled positive for
  published, a 1.5px brand ring for draft, a 1px muted ring for not started;
- a legend in mono 9.5px uppercase.

**Panes (mock).** Library 272px and Inspector 320px open, 44px as rails; the
column change animates over `--dur-base` on `--ease-out`. A pane's tab row is
44px. The Library's search band is padding 12px 14px on paper-2, around a
32px input and 26px filter segments in mono 9.5px uppercase.

**The day strip (mock's band over the grid, the product's toolbar).** A 28px
group: ‹, the week's days (`THU 09` in mono 10px 600, each with a 5px issue
dot), ›. Then the range label in DM Sans 15px 700 and its line in mono
10.5px.

**The grid header:**
- **Day:** sticky, 52px tall:
  - a 148px corner, `GROUP · ROW` mono 9.5px over `2 rows × 3 shifts`;
  - a column per shift, its label mono 10.5px 600 uppercase beside its time
    mono 10.5px, and its meta mono 10px.

  Columns `148px repeat(3, minmax(228px, 1fr))`, at least 832px wide, past
  which main scrolls sideways.
- **Week:** a 28px row of days, each spanning its shifts (`THU` mono 10px
  600, `09` mono 11px 600, a 6px issue dot), over a 24px row of shift codes
  (mono 9.5px). Columns `148px repeat(21, minmax(34px, 1fr))`, at least
  862px.

**A group:**
- **The header:** at least 36px, on paper-2: a 24px chevron, the name in DM
  Sans 14px 700, its meta mono 10.5px, the issues status, and the cost mono
  11px 600 at the right.
- **A row's head:** sticky at the left, and within the row sticky under the
  grid header. Padding 12px 12px 12px 16px: the eyebrow mono 9.5px
  uppercase, the title 12.5px 600, the meta mono 10px, the total mono 11px
  600.

**A requirement cell (Day):** padding 10px 12px, gap 7px:
- a line of figures: needed mono 13px 600 and `needed`, then rostered mono
  11px 600 and the difference mono 10.5px 600;
- the coverage bar: 8px tall, radius 2, on paper-3, its segments laid end to
  end, and the needed tick 2px wide and 3px proud of the bar above and
  below;
- the sub-line in mono 10px;
- the skill lines under a rule: a 20px header (`WORK BY ACTIVITY · HELD ·
  ASG/NEED`, mono 9px) and 21px rows on `minmax(0,1fr) 34px 58px`. Each row
  has the code (18px, mono 8.5px), the skill (12px), the holders (mono
  10.5px) and the hours (mono 10.5px 600).

Empty: `No work required` over a 24px dashed `+ set a target`.

**A roster cell (Day):** padding 8px 8px 10px, gap 4px:
- the head, 24px: the count mono 13px 600, `/ 19 positions` mono 10px, and
  the flags in mono 9.5px uppercase, each after a 6px dot;
- the chips: 26px tall (22 compact), radius 4, a 1px border, padding 0 3px
  0 6px, gap 5px. In order:
  - the badge, 15px tall, mono 8.5px;
  - the name, 12px 600;
  - the flags, mono 9.5px 600;
  - the agreed check, mono 11px;
  - the activity box, at least 22×16, mono 8.5px, with its 11px ×;
  - the fit, mono 10px, at least 22px wide, right-aligned;
  - the × to remove, 18px;
- an open position: 26px, dashed warning, a 6px dot, `Open position`,
  `8 h`, and an 18px `REQUEST AGENCY` button;
- a proposal: 26px, dashed, `MODEL` mono 8.5px in the brand colour, the name
  12px 600 italic, the reason mono 9.5px, an 18px bordered ✓ and an 18px ×;
- the ghost while dragging: 26px, 1.5px dashed, mono 10px 600;
- the drop strip: 24px, dashed, `Drop a person · + agency staff`.

**Week cells:**
- requirement: padding 8px 4px, the needed hours mono 10.5px 600, a 3px fill
  bar, the difference mono 9.5px 600;
- roster: at least 48px tall, `17/19` mono 10.5px 600 over a 6px issue dot.

The day in view's columns are on paper-2, and each day's first shift has the
strong rule.

**Footer (mock: under the grid).** At least 34px, on paper-2, mono 10px:
- the legend's swatches, 12×8px: Permanent (brand), Agency staff (teal),
  Overtime (purple), Requested (dashed teal), Open (dashed warning), and Hours
  needed (a 2×12px tick);
- the hint `Drag ⠿ to move · ✓ accept proposal · ⌫ remove · ⌘Z undo`.

**Inspector:**
- sections padded 16px with a rule between;
- the header: a 22px avatar or tile, an eyebrow mono 10px uppercase, a chip
  (New, Moved, Edited, Removed), the title in DM Sans 17px 700, the meta mono
  10.5px, a status;
- form rows on `92px minmax(0,1fr)`, each label 12.5px over its key mono
  10px. Steppers are 30px: a 28px −, the value 56px wide in mono 12px 600
  right-aligned, a 28px +, then the unit mono 10.5px, with the help line
  mono 10px under them. Selects are 32px, the checkbox 14px;
- skills: a table of rows at least 30px on `14px 1fr auto` (✓ or –, the
  skill, `34 h needed`);
- the week: seven buttons, gap 4px (the day mono 9px, the shift code mono
  12px 600, the hours mono 9.5px);
- a slot's coverage bar is 10px, with a legend in two columns;
- the summary: four stats in two columns (the label mono 10px, the value mono
  20px 600, the sub-line mono 10px);
- actions right-aligned at the end.

## 9. Behaviour

Every interaction of the mock, numbered. Each sub-issue lists the rules it
owns, and each rule has a test there. Rules marked *product* are not in the
mock.

### 9.1 The toolbar and navigation (owner: frame and grid)

- **B1.** Day · Week switch the period. Day shows the day in view, a column
  per shift; Week shows the seven days, a column per day and shift.
- **B2.** The day strip lists the week's days. Each day's dot:
  - danger when a hard breach is on it;
  - warning when another breach or a gap is;
  - none otherwise.

  A click opens that day. ‹ and › step a day; past the week's ends they step
  into the next or previous week, onto its first or last day.
- **B3.** The range label and the line under it:
  - Day: `Thu 09 Mar 2028`, with `$24.3k of $24.8k budget · 550 of 564 h`;
  - Week: `05–11 Mar 2028`, with `W37 · $111.5k · 2536 of 2492 h`.

  Without `costs`, the money is left out.
- **B4.** The week's status: Draft, Published or Not started. The read-outs
  are `3 changes` pending and `4 to agree · 2 proposals`. The issues chip
  (`8 issues`, the breaches and gaps in view, in the warning tone) opens the
  Issues tab.
- **B5.** *Product.* The period, the week and the day persist per builder for
  the viewer.
- **B6.** A shift's header (Day): its label, its time (`06:00–14:00`), and
  `302 h needed · 38 / 38 positions` over every group. A click selects the
  shift.
- **B7.** A day's header (Week): its weekday, its date and its issue dot,
  over its shifts' codes. A click opens that day.

### 9.2 The grid (owner: frame and grid)

- **B8.** A group's header shows:
  - collapse;
  - its name;
  - `294 h needed · 292 h rostered · −2 h`;
  - its issues (`4 issues`, danger when any is a hard breach);
  - its cost.

  Collapsing hides its rows, and persists.
- **B9.** A group's rows:
  - the requirement row: `Requirement`, `Work required`, `hours by skill`
    (`· 7 days` in Week), `294 h needed`;
  - the roster row: `Assignment`, `Roster`, `36 people · 8 agency staff`
    (shifts, in Week), `292 h · $12.9k`.

  `requirements={false}` hides the requirement rows. A click on a row's head
  selects the row.
- **B10.** A requirement cell (Day) shows:
  - the needed hours, the rostered hours and their difference (`146 h needed`,
    `152 h`, `+6 h`: warning when short, muted when over, positive when
    exact);
  - the coverage bar: permanent, agency, overtime, requested (dashed) and
    open (dashed warning) hours end to end, and the needed tick;
  - the sub-line `120 perm · 32 AG h · $6.7k` (`80 perm · 16 AG · 2 OT h`
    with overtime), or `nothing rostered`;
  - a line per skill and duty needed: its code, its name, its holders among
    the people on the shift (`10/19`, `—` for a duty), and its hours assigned
    against needed (`32 / 34`). A line is warning when short, positive when its assigned
    hours cover it.

  Compact hides the lines. A shift needing nothing shows `No work required`
  and `+ set a target`. A click selects the slot.
- **B11.** A roster cell (Day) holds, in order:
  - its head: `19 / 19 positions` (or `no positions`), warning when any is
    open, with the flags `no lead`, `1 open`, `2 gaps`. A click selects the
    slot;
  - its chips, in position order: lead positions as `positions` lists them,
    then the rest, then agency staff, then requests;
  - an open-position row for each open position: `Open position · 8 h` and
    `Request agency`;
  - its proposals (B50);
  - the ghost while a drag rests on it (B35);
  - the drop strip `Drop a person · + agency staff`, whose `+` drafts a
    request.
- **B12.** A chip holds:
  - its badge: the position's code, else `T` for a trainer, `AG` for agency
    staff;
  - the person's name, or `requested · Northside Staffing`;
  - its flags: the issues' (`6h rest`, `double`, `trainee`), `+2h OT`,
    `late +2h` or `early 1h`;
  - the agreed check (✓ agreed, ☐ not yet), when it has an offset or
    overtime;
  - the activity box: the activity's code, or dashed with none; its × clears
    it;
  - the fit: `5/6` (the group's skills they hold), or with `chip="hours"`
    their hours this week, `32h`, warning over their contract;
  - × to remove.
- **B13.** A chip's look:
  - drafted, added or moved: the brand tint with a dashed brand border;
  - edited: the brand tint;
  - removed: the warning tint, struck through, with ↺ to restore in place of
    ×;
  - with a hard breach: a danger border and tint; with another breach, a
    warning border;
  - a request: dashed, with no fill;
  - agency staff: on paper-2;
  - selected: a 1.5px brand outline;
  - being dragged: 40% opacity.
- **B14.** A week cell:
  - requirement: the needed hours, a fill bar of rostered against needed
    (warning when short), and the difference;
  - roster: `filled/positions` (warning when any is open) and an issue dot;
  - `–` when the slot has nothing.

  The day in view is tinted. A click opens that day with the slot selected.

### 9.3 Selection and keys (owner: frame and grid)

- **B15.** A click selects:
  - on a chip, its assignment;
  - on a person card, their assignment that day, else the person;
  - on a requirement cell or a roster cell's head, the slot;
  - on a row's head, the row;
  - on a shift's header, the shift.

  A selection opens the inspector's Details.
- **B16.** The keys, none of them while typing:
  - Esc closes the week picker, else clears the selection;
  - Delete or Backspace removes the selected assignment, or rejects the
    selected proposal;
  - ⌘Z undoes, ⇧⌘Z redoes;
  - `[` and `]` step a week.

### 9.4 Weeks (owner: weeks)

- **B17.** The week control: ‹ and › step a week. The label
  (`W37 05–11 Mar 2028 ▾`) opens the picker. `This week` shows when another
  week is in view and returns to the current one.
- **B18.** The picker shows a month at a time, with ‹ and ›:
  - a row per week, with its label (`W37`) and its dates;
  - the week in view tinted;
  - each week's dot: published, draft or not started;
  - a legend.

  A click goes to that week. It is an anchored popover, closed by Esc or a
  click outside it.
- **B19.** A published week is read-only, under the banner
  `W36 · published — Read-only view of the published roster.`: no drops, no
  chip actions, no inspector edits, no Apply.
- **B20.** A week with no entry is not started. It shows the forecast's
  requirements with no one rostered, under the banner
  `W38 · not started — Requirements are loaded from the forecast. No one is rostered yet.`
  and `Copy W37 roster`, which drafts the week before's assignments with
  their positions and activities (not its proposals, nor what it removed).
  The first gesture on a week makes its entry.
- **B21.** *Product.* Publish applies the week with its status published at
  that instant.
- **B22.** Each week keeps its own drafts while the viewer moves between
  weeks.

### 9.5 The library pane (owner: library pane)

- **B23.** Tabs People (the mock's "Employees") and Activities, each with its
  count. The search filters People by name, group, position, agency, trainer
  and skill; Activities by name and code.
- **B24.** People's filters: All · Leads · Trainers · Off `<day>`. Its groups,
  each with its count:
  - `Off Thu · available`: no assignment that day;
  - Leads: in a lead position that day (the mock says Supervisors, after its
    sample's lead position);
  - Associates;
  - Agency staff.

  Under All, the agency card leads Agency staff when the search matches it.
- **B25.** A person card holds:
  - a grip, and an avatar, filled for a lead;
  - their name and badge;
  - the day's tag: their shift's code, or `OFF` in the brand colour;
  - the meta: `Inbound · early`, `Inbound · Picking late` on another group,
    or `Inbound · off Thu`;
  - their week's hours against their contract (`32 h / 38`, warning over);
  - a meter, in the brand colour to the contract and warning past it.

  A click selects (B15).
- **B26.** The agency card: a building tile, the agency's name, `REQ`, and
  `Request · 8 h`.
- **B27.** An activity card: its code tile, its name, `assigned / needed · Thu`
  (or `not needed Thu`), `16 / 34 h` (positive when covered), and a meter.
  Grouped by group, then `Any group` for the duties.
- **B28.**
  - Empty, a tab says `No matches` with `Nothing matches "q".` or
    `No one fits this filter.`
  - The pane's footer says `Drag onto a shift · Thu 09 Mar` or
    `Drag onto a person · one per shift`.
  - Collapsed, the pane is a rail: an icon, the count off that day, and
    `Library`.

### 9.6 Rules and coverage (owner: types, rules and coverage; issues and fixes)

- **B29.** `Roster.coverage` gives each slot:
  - its positions, filled and open, and the people on it;
  - its hours by kind: permanent, agency, overtime, and requested (a request
    counts the shift's hours); needed (the lines' sum) and rostered (all
    four);
  - each line's holders among the people on it, its capacity (holders × the
    shift's hours), its gap, and the hours assigned to it as an activity
    (the shift's hours plus overtime, for each chip with it);
  - its cost at `costs.rates` (requests at the agency rate, overtime at the
    overtime rate);
  - whether a lead and a trainer are on.
- **B30.** `Roster.check` gives the issues, with their fixes:

  | Issue | Kind and tone | Fix |
  |---|---|---|
  | `No lead on Dispatch · Early`, with `Assign a lead: Supervisor, Deputy supervisor or Acting supervisor`: a staffed shift with positions and no one in a lead position | breach, warning | find leads |
  | `A. Alder · double booked`: a person on two shifts a day | breach, danger | — |
  | `C. Clover · 6 h rest`, with `Inbound · Early · minimum 10 h since the previous shift`: less rest than `rules.rest` before or after | breach, danger | move to the first shift that leaves the rest, else start later by what is missing, rounded up to 30 minutes (`Start 10:00`), which clears agreed |
  | `B. Swale · trainee without trainer`: a trainee on a shift with no trainer | breach, warning | find trainers |
  | `A. Alder · not skilled for Put-away`: an activity the person doesn't hold | breach, warning | — |
  | `C. Kestrel · +2 h OT`, with `Inbound · Late · 14:00–00:00 · not yet agreed`: an offset or overtime not agreed | to agree | mark agreed |
  | `1 open position · Inbound · Night`, with `8 h unfilled · 5 of 6 positions` | gap, warning | request agency staff |
  | `Unloading · 8 h short`, with `Inbound · Night · 3 skilled × 8 h = 24 h of 32 h` | gap, warning | find people with the skill |

  Hard breaches (danger) are double booking and short rest. The mock's
  wording follows its sample (`No supervisor on Dispatch · Early`); the
  product's says `lead` and lists the positions that lead.
- **B31.** Each rule follows `rules`, all on by default. The app's `check`
  adds its issues, which show wherever issues show.

### 9.7 The inspector (owner: inspector)

- **B32.** Tabs Details and Issues, with the issues' count. Details shows the
  selection, or the summary when nothing is selected.
- **B33.** The summary:
  - `Day · Thu 09 Mar 2028` or `Week · W37`, with the counts of groups and
    shifts;
  - four stats:
    - Cost: `$24.3k`, `$0.5k under $24.8k`, positive or danger;
    - Positions: `68 / 70`, `2 open` or `all filled`;
    - Hours: `550 h`, `of 564 h needed`;
    - Issues: `8`, `4 to agree`;
  - the proposals, each with Accept;
  - four hints.
- **B34.** An assignment:
  - **the header:**
    - the avatar, or the agency's tile for a request;
    - `Assignment · Inbound · Early`, or `Proposal · …`, with New, Moved,
      Edited or Removed;
    - the name, or `Agency request`;
    - `Supervisor · Thu 09 Mar` (with `· trainer` or `· trainee`), or
      `Agency staff · Northside Staffing · Thu 09 Mar`;
    - its status: Rostered, Requested · awaiting agency, Added · unsaved,
      Moved · unsaved, Edited · unsaved, Removed · unsaved, or Model
      proposal;
  - **a banner per issue** with its fix;
  - **Shift:**
    - the shift, a segmented control that moves it;
    - Start offset, −2 to +6 h in 0.5 h steps (⇧ for 2 h), with
      `Standard start · 06:00`, `Late start · 08:00` or `Early start · 05:00`;
    - Overtime, 0 to 4 h, with `None · 0–4 h · ⇧ steps 2 h` or
      `2 h at $63/h`;
    - Time: `06:00–14:00 · 8 h`, and `· ends next day` past midnight;
    - Activity: None, the group's skills and the duties. Its help line is
      `Not skilled for Reach truck` (warning), `Whole shift · UL`, or
      `Optional · one per shift`;
    - Position;
    - Agreed, when an offset or overtime is set;
  - **Skills:** `Skills · Inbound` and `5 / 6 held`; each skill ✓ or –, with
    `34 h needed` from the slot's line. Agency staff:
    `No skills recorded for agency staff.`;
  - **Week:** the seven days, each its shift's code and hours, or off;
    danger when a hard breach is on it; the day in view outlined. A click
    opens that day on that assignment. Under the heading, `32 h / 38`, and
    `· +2 h` past the contract;
  - **actions:** Remove from shift, Cancel request, Restore, or Reject and
    Accept proposal.
- **B35.** Changing a person's offset or overtime sets agreed to not yet (☐).
  Both back at zero, agreed is none.
- **B36.** A field the drafts changed is tinted, against what the week holds.
- **B37.** A person who is off that day:
  - `Person · Inbound`, their name, `Associate · usually night`, the status
    `Off Thu 09 Mar`;
  - their skills (`3 / 6 held`) and their week (`24 h / 38`);
  - the hint `Drag N. Ochre onto a shift to roster them for Thu 09 Mar.`
- **B38.** A slot:
  - **the header:**
    - `Shift · Inbound · Thu 09 Mar` and `Early · 06:00–14:00`;
    - `19 / 19 positions · 152 of 146 h`;
    - the status `6 h short`, `Covered · 6 h over` or `Covered`;
    - Edited when its targets changed;
  - **its issues** as banners with their fixes;
  - **Coverage:** the bar, and a legend of hours: Permanent, Agency staff,
    Overtime, Requested, Open, Needed;
  - **Targets:**
    - Positions, ±1 (⇧ for ±10), with `19 filled · 0 open`;
    - a stepper per line, with `9 skilled · 72 h capacity · 4 h short`. At
      0, the line goes;
    - `+ <skill>` chips, each adding a line at the shift's hours;
  - **Roster:** Leads (their names), Trainers, Agency staff
    (`2 named · 1 requested`), To agree, Proposals, Cost.
- **B39.** A shift: its definition (`Early`, `06:00–14:00 · 8 h`, whether it
  ends the next day) and its positions and hours by group. A row: its totals
  by shift, for the day or the week.
- **B40.** Collapsed, the pane is a rail: an icon, the issues count,
  `Inspector`, and the selection's name.

### 9.8 Issues and fixes (owner: issues and fixes)

- **B41.** The Issues tab lists Breaches, Gaps, To agree and Model proposals,
  each with its count. Each issue shows:
  - a dot: danger, warning, the brand colour for a proposal, an open ring to
    agree;
  - its title, and its detail (after its weekday, in Week);
  - its fix, as a button.

  A click opens the issue's day and selects its subject. With none:
  `No issues — Every shift is covered and every change is agreed.`
- **B42.** The fixes:
  - request agency staff drafts a request on the slot;
  - mark agreed sets agreed;
  - accept accepts the proposal;
  - move to `<shift>` moves the assignment;
  - start `HH:MM` sets the offset and clears agreed;
  - find leads, trainers or a skill opens the library on People with that
    filter or search.

  Each is one gesture.
- **B43.** An assignment's flags and a slot's flags come from its issues
  (B11, B12).

### 9.9 Proposals (owner: proposals)

- **B44.** *Product.* A proposal is hidden once its key is in the week's
  `dismissed`, or once its person is on that day.
- **B45.** A proposal for this week shows in its slot as a dashed MODEL chip:
  `MODEL`, the name in italics, its short reason (`fills open`, `+8 h`), ✓
  and ×. Its whole reason reads `Fills the open position · closes Unloading
  and Receiving QA gaps`.
- **B46.** Accepting drafts an assignment (the person, the slot, their
  position) and selects it. Rejecting drafts the key into `dismissed`. Each is
  one gesture.
- **B47.** The summary lists the proposals with Accept; the Issues tab lists
  them with Accept; the inspector shows one with its reason as a banner and
  Reject and Accept proposal.

### 9.10 Drag and drop (owner: drag and drop)

- **B48.** A person card onto a roster cell rosters them there:
  `Add N. Ochre`. Instead:
  - on another shift that day, it moves that assignment:
    `Move A. Alder from Early`;
  - with a proposal of theirs in that slot, it accepts it;
  - with a removed assignment of theirs there, it restores it.

  Refused: already on this shift.
- **B49.** A chip onto another roster cell moves it: `Move A. Alder from Wed`;
  across groups its activity clears. A request moves freely:
  `Move request here`. Refused: its own slot (`Already on this shift`), or a
  person already on another shift that day (`A. Alder · already on Thu late`).
- **B50.** The agency card onto a roster cell drafts a request:
  `Request · Northside Staffing`.
- **B51.** An activity card onto a chip sets its activity: `UL → A. Alder`.
  It warns when the person doesn't hold it (`UL → A. Alder · not skilled`).
  It is refused:
  - on a request: `Requests take no activity`;
  - for another group's activity: `UL is an Inbound activity`;
  - onto a cell: `Drop UL onto a person`.
- **B52.** Short rest warns and allows: `Add N. Ochre · 8.5 h rest`.
- **B53.** While dragging, the cell under the pointer shows a dashed ghost
  chip with the label, and the cell is tinted. The ghost is brand when
  allowed, warning when warned, danger when refused. The week view's roster
  cells take the same drops, with the label as their tooltip.
- **B54.** After a drop the new or moved assignment is selected. A published
  week takes no drop.

### 9.11 Editing and Apply (owner: editing)

- **B55.** The roster record is one session of the shared `Editing`
  contract, and a week's entry is its draft. Every gesture is one undoable
  transaction:
  - a drop or a move;
  - a stepper's step, a select or a check;
  - accept or reject;
  - a copy, or a fix.
- **B56.** Removing an assignment the week holds strikes it through until
  Apply, and ↺ restores it. Removing one the drafts added drops it.
- **B57.** The pending count is the assignments added, moved, edited or
  removed, and the slots whose requirement changed.
- **B58.** Apply commits the week as one patch: its assignments,
  requirements and dismissals, checked against what its drafts began from. A
  week another write moved since is refused as a conflict: its drafts stay,
  and a banner says so. Discard drops the week's drafts.

### 9.12 The People layout (owner: People layout, *product*)

- **B59.** People × days, for the week: a toolbar segment Shifts · People
  switches to it. A row per person, grouped by group, and a column per day. A cell holds the person's chip that day: the shift's
  code, its group when not their own, and their flags. Their week's hours
  are at the row's end.
- **B60.** A chip drags to another day, and a person card from the library
  onto a day, on the shift they usually work; drops follow §9.10. A click
  selects as in B15.

## 10. Proposals, weeks and the forecast, as data

- A proposal is `{ key, week, slot, person, reason }`, from the app's model.
  The builder shows those for the week in view.
- A week's entry is made by its first gesture: its requirements from
  `forecast` at its first day (or none), its status draft, no assignments,
  nothing dismissed.
- The model reads `dismissed` to learn what was turned down.

## 11. Drag and drop, as a table

| Drag | Onto | Does | Refused, or warned |
|---|---|---|---|
| A person card | a roster cell | Rosters them there; moves them from another shift that day; accepts or restores theirs there (B48) | Refused: already on this shift. Warned, and allowed: less rest than the rule (B52). |
| The agency card | a roster cell | Drafts a request (B50) | — |
| A chip | another roster cell | Moves it; across groups its activity clears (B49) | Refused: its own slot, or the person on another shift that day. |
| An activity card | a chip | Sets its activity, one a shift (B51) | Refused: a request, or another group's activity. Warned: not skilled. |
| An activity card | a cell | — | Refused: `Drop UL onto a person`. |

All of it runs on the shared drag grammar (`LibraryRef`, `CellRef`,
`DragEvent`), as the Calendar's and Studio's do. A roster `CellRef`'s `row`
is `<group>|<shift>`, and its `slot` is the day's index in the week. A chip
is a drop target too, for activities: its `CellRef` names the assignment.

## 12. Where the product differs from the mock

| The mock | The product | Why, and what is lost |
|---|---|---|
| Two control rows: the toolbar, and a day strip over the grid | One toolbar; read-outs and the legend in the footer | A component has one toolbar. Nothing is lost. |
| Apply into an applied layer, then Save | Apply commits; Discard in the history item | One editing session. The applied-but-unsaved layer is lost. |
| A row's or a shift's "Definition", naming the API (`Roster.Requirement`, …) | A shift's definition (its times and hours, crossing midnight) and a row's totals; no API names | An operator's screen. The API text is lost. |
| The inspector's footer, naming the selection's path in the data | No footer | The same. |
| A week's status from its date (past weeks published) | A week's own status, and Publish | Stored state. |
| Future weeks seeded from built-in figures | `forecast`, the app's data | The app owns its forecast. |
| Proposals mixed into the assignments | `proposals` data, and `dismissed` in the week | Proposals are the model's, decisions the week's. |
| Every person's shift is 8 paid hours | The shift's `hours` | Shifts are data. |
| A built-in General duties activity | `duties` | Duties are data. |
| Shift tags `ERL`, `LTE`, `NGT` on cards | The shift's code | One code per shift. |
| Panes that collapse at fixed window widths (1020px, 1280px) | `BuilderFrame`, by its own width | The frame's rule. Nothing is lost. |
| The client's groups, skills, shifts, positions, agency and people | A warehouse's, and synthetic names | The public repo carries no client domain. |

## 13. Wires

- **UI.** east-ui's `Roster` and `Board` arms leave `UIComponentType`;
  packages are re-exported (`WIRE_MIGRATION.md`). The builder rides an
  `EastUI.component` carrier, `RosterBuilder`, as `StudioBuilder` does.
- **Stored state.** The roster record holds `Roster.Types.Weeks`, the
  roster's own type, as Studio's pages record holds Studio's. Once released,
  a change to it ships a repository upgrade step (`WIRE_MIGRATION.md`).

## 14. The sub-issues, in landing order

The roster lands after the Calendar epic's `Fields` (#1147) and its types
(#1149), which give it the inspector's form and `Clock`.

1. The spec and the hi-fi mock (this file, the mock, its renders).
2. Remove east-ui's `Board` and `Roster`.
3. The types, factories, rules and coverage (e3-ui).
4. The frame and the grid.
5. Editing and Apply.
6. Weeks.
7. The library pane.
8. Drag and drop.
9. The inspector.
10. Issues and fixes.
11. Proposals.
12. The warehouse roster on e3-web, its responsive specs, the skill and
    examples.
13. The People layout (*product*): people × days, in place of east-ui's
    `Roster` view.
