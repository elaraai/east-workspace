# Record columns from data: DX proposal

Approved 8 November 2026, and filed as #1563 under the Record's epic (#1536), whose branch and PR (#1537) it is built on. It lets a Record's columns come from a record the business edits, or from a struct's fields: each cell reads one field of the row and each edit writes it, however the solution stores it. The Record's own proposal is [Record - DX Proposal](<Record - DX Proposal.md>), beside this file.

## 1. The need

A Record's columns are its row's own fields, fixed when the page is built: the `columns` map is keyed by them. Two kinds of data don't fit that.

- **Columns that are data.** A column per skill, per project, per check type. The business keeps those in a record of their own and edits it. Today a solution has to flatten them into one field each, so adding one is a code change, a redeploy and a migration of every row.
- **Values stored another way.** A cell shows a field as it is stored. A dated history (one row per change) or a list of snapshots can't show as today's value, and an edit can't append to it.

This proposal lets a column come from data: one column per member of a record the business edits, or one per field of a struct. Each cell reads one field of the row, and each edit writes that field. How the field is stored stays the solution's.

The API names no domain. The common shapes need no functions, every column kind can come from data, and the Sheet and the Record share the machinery.

## 2. What a solution writes

Three general shapes come first, none needing a function of the solution's. A worked case whose field is a dated history follows.

### 2.1 A value per member

A person's hours by project: the field is a `Dict` keyed by the project's code. There is one column per project, each under its client.

```tsx
/** @jsxImportSource @elaraai/east-ui */
import { DictType, East, FloatType, StringType, StructType, some } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui";
import { Data, Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

export const Client = StructType({ name: StringType });
export const Project = StructType({ name: StringType, client: StringType });
export const Person = StructType({ name: StringType, hours: DictType(StringType, FloatType) });

export const clients = e3.record("clients", DictType(StringType, Client));
export const projects = e3.record("projects", DictType(StringType, Project));
export const people = e3.record("people", DictType(StringType, Person), {
    mutations: (mutation) => ({
        // Every Save commits through it.
        patch: mutation.patch(),
    }),
});

export const hoursPage = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const staff = $.let(Record.bind(people));
        const clientRows = $.let(Data.bind(clients));
        const projectRows = $.let(Data.bind(projects));
        return (
            <Record
                record={staff}
                title="Hours"
                noun={{ singular: "person", plural: "people" }}
                registers={{
                    clients: Record.register.members(clientRows.read(), { kind: "client", key: (_c, code) => code, label: (c) => c.name }),
                    projects: Record.register.members(projectRows.read(), {
                        kind: "project", key: (_p, code) => code, label: (p) => p.name, parent: (p) => some(p.client),
                    }),
                }}
                columns={{
                    name: Record.column.title(Person, { header: "Name", width: "176px" }),
                    // The hours field: a column for each project, under its client.
                    hours: Record.column.quantity(Person, { each: "projects", groups: "clients", unit: "hrs", width: "88px" }),
                }}
                inspector
                name="hours"
            />
        );
    }}</Reactive>
));
```

A cell shows the person's entry for its project, or nothing. An edit sets the entry, and clearing the cell removes it. A project added to the projects record is a new column on the next read.

### 2.2 A struct's fields

A week's heads as one struct field: a column per day, headed as the solution says.

```tsx
/** @jsxImportSource @elaraai/east-ui */
import { DictType, East, IntegerType, StringType, StructType } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui";
import { Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

export const Week = StructType({
    mon: IntegerType, tue: IntegerType, wed: IntegerType, thu: IntegerType, fri: IntegerType, sat: IntegerType, sun: IntegerType,
});
export const Shift = StructType({ name: StringType, week: Week });
export const roster = e3.record("roster", DictType(StringType, Shift), {
    mutations: (mutation) => ({
        // Every Save commits through it.
        patch: mutation.patch(),
    }),
});

export const rosterPage = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const shifts = $.let(Record.bind(roster));
        return (
            <Record
                record={shifts}
                title="Roster"
                noun={{ singular: "shift", plural: "shifts" }}
                columns={{
                    name: Record.column.title(Shift, { header: "Shift", width: "176px" }),
                    // The week field: a column for each day.
                    week: Record.column.integer(Shift, {
                        each: { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" },
                        width: "56px",
                    }),
                }}
                columnGroups={[{ label: "Heads per day", columnKeys: ["week"] }]}
                inspector
                name="roster"
            />
        );
    }}</Reactive>
));
```

A literal column group may name a struct's columns by the column's key, because those columns are known when the page is built.

### 2.3 A variant, stepped in order

A status stored as a variant, on an ordinary field. East keeps a variant's cases in alphabetical order, so `steps` gives the order a click steps through them in.

```tsx
export const Status = VariantType({ open: NullType, packed: NullType, shipped: NullType });
export const Order = StructType({ customer: StringType, status: Status });

// In the Record's columns:
status: Record.column.cycle(Order, Status, {
    header: "Status", width: "96px",
    steps: [
        { case: "open",    label: "Open",    tone: "neutral" },
        { case: "packed",  label: "Packed",  tone: "info" },
        { case: "shipped", label: "Shipped", tone: "success" },
    ],
}),
```

The build checks that `steps` names every case of the variant, once.

### 2.4 A worked case: dated skills and preference snapshots

This solution's people hold skills as a dated history, one row per change, and preferences as dated snapshots. Its skills and teams are records the business edits. The types below are the solution's own, renamed here. The functions follow its rules and were written here; its planner reads the same rows by the same rules, in functions of its own, with dates of its own.

```ts
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, IntegerType, NullType, OptionType, StringType, StructType, VariantType,
    none, some, variant,
} from "@elaraai/east";
import { Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

export const Level = VariantType({ not_trained: NullType, trainee: NullType, competent: NullType });
export const Holding = StructType({
    skill: StringType,
    holding: VariantType({ level: Level, licence: BooleanType }),
    since: DateTimeType,
    expires: OptionType(DateTimeType),
    signed_off_by: OptionType(StringType),
    signed_off_at: OptionType(DateTimeType),
});
export const Choice = VariantType({ cant: NullType, can: NullType, prefer: NullType });
export const Preferences = StructType({
    since: DateTimeType,
    basis: VariantType({ guessed: NullType, stated: NullType }),
    standard: StructType({ day: Choice, afternoon: Choice, night: Choice, saturday: Choice, sunday: Choice, sunday_night: Choice }),
    peak: StructType({ day: Choice, night: Choice, saturday: Choice, sunday: Choice, four_days: Choice, five_days: Choice, six_days: Choice }),
});
export const Person = StructType({
    id: StringType,
    name: OptionType(StringType),
    home_team: OptionType(StringType),
    active: BooleanType,
    skills: ArrayType(Holding),
    preferences: ArrayType(Preferences),
});
export const Skill = StructType({ team: OptionType(StringType) });
export const Team = StructType({ name: StringType });

export const people = e3.record("people", DictType(StringType, Person), {
    mutations: (mutation) => ({
        // Every Save commits through it.
        patch: mutation.patch(),
    }),
});
export const skills = e3.record("skills", DictType(StringType, Skill));
export const teams = e3.record("teams", DictType(StringType, Team));

/** The holding of a skill in force on a day: the latest dated on or before it, the later of two dated the same. */
export const holdingOn = East.function([ArrayType(Holding), StringType, DateTimeType], OptionType(Holding), ($, holdings, skill, day) => {
    const found = $.let(none, OptionType(Holding));
    $.for(holdings, ($2, holding) => {
        const later = $2.const(found.match({ none: () => true, some: (_$3, held) => East.lessEqual(held.since, holding.since) }));
        $2.if(holding.skill.equal(skill).and(() => East.lessEqual(holding.since, day)).and(() => later), ($3) => {
            $3.assign(found, some(holding));
        });
    });
    return found;
});

/** A skill's level on a day, as every reader plans with it: none once its holding has expired, a licence held competent. */
export const levelOn = East.function([ArrayType(Holding), StringType, DateTimeType], OptionType(Level), ($, holdings, skill, day) => {
    const notHeld = $.const(none, OptionType(Level));
    const competent = $.const(some(variant("competent", null)), OptionType(Level));
    const find = $.const(holdingOn);
    const inForce = $.const(find(holdings, skill, day));
    return inForce.match({
        none: () => notHeld,
        some: ($2, holding) => {
            const expired = $2.const(holding.expires.match({ none: () => false, some: (_$3, end) => East.lessEqual(end, day) }));
            return expired.ifElse(() => notHeld, () => holding.holding.match({
                level: (_$3, level) => some(level),
                licence: (_$3, held) => held.ifElse(() => competent, () => notHeld),
            }));
        },
    });
});

/** A cell's mark: a licence row in force locks it, held or not; an expired level says what lapsed. */
export const markOn = East.function([ArrayType(Holding), StringType, DateTimeType], OptionType(Record.Types.Mark), ($, holdings, skill, day) => {
    const noMark = $.const(none, OptionType(Record.Types.Mark));
    const find = $.const(holdingOn);
    const inForce = $.const(find(holdings, skill, day));
    return inForce.match({
        none: () => noMark,
        some: ($2, holding) => {
            const expired = $2.const(holding.expires.match({ none: () => false, some: (_$3, end) => East.lessEqual(end, day) }));
            return holding.holding.match({
                licence: (_$3, held) => held.ifElse(
                    () => expired.ifElse(() => some(variant("lock", "licence: expired")), () => some(variant("lock", "licence"))),
                    () => some(variant("lock", "no licence"))),
                level: ($3, level) => {
                    const name = $3.const(level.match({ not_trained: () => "not trained", trainee: () => "trainee", competent: () => "competent" }));
                    return expired.ifElse(() => some(variant("note", East.str`expired: ${name}`)), () => noMark);
                },
            });
        },
    });
});

/**
 * The holdings with a skill set to a level today. Today's last row of the skill is replaced when the grid could have
 * written it — a level, with no expiry and no sign-off — and otherwise a row is appended. A level the holdings already
 * read without the grid's row writes nothing, and drops that row: an edit that ends where it started saves none. No
 * earlier row changes.
 */
export const withLevel = East.function([ArrayType(Holding), StringType, Level, DateTimeType], ArrayType(Holding), ($, holdings, skill, level, today) => {
    const read = $.const(levelOn);
    const day = $.const(East.DateTime.roundDownDay(today, 1n));
    const written = $.const({ skill, holding: variant("level", level), since: today, expires: none, signed_off_by: none, signed_off_at: none }, Holding);
    const last = $.let(none, OptionType(IntegerType));
    $.for(holdings, ($2, holding, index) => {
        $2.if(holding.skill.equal(skill).and(() => East.equal(East.DateTime.roundDownDay(holding.since, 1n), day)), ($3) => { $3.assign(last, some(index)); });
    });
    // Today's last row of the skill, when the grid could have written it.
    const mine = $.const(last.match({
        none: () => none,
        some: (_$2, at) => holdings.get(at).holding.hasTag("level").and(() => holdings.get(at).expires.hasTag("none")).and(() => holdings.get(at).signed_off_by.hasTag("none"))
            .ifElse(() => some(at), () => none),
    }), OptionType(IntegerType));
    const without = $.const(mine.match({
        none: () => holdings,
        some: (_$2, at) => holdings.slice(0n, at).concat(holdings.slice(at.add(1n), holdings.size())),
    }));
    return East.equal(read(without, skill, today), some(level)).ifElse(
        () => without,
        () => mine.match({
            none: () => holdings.concat([written]),
            some: (_$2, at) => holdings.map((_$3, holding, index) => index.equal(at).ifElse(() => written, () => holding)),
        }));
});

/** The preferences in force on a day: the latest snapshot dated on or before it, the later of two dated the same. */
export const preferencesOn = East.function([ArrayType(Preferences), DateTimeType], OptionType(Preferences), ($, snapshots, day) => {
    const found = $.let(none, OptionType(Preferences));
    $.for(snapshots, ($2, snapshot) => {
        const later = $2.const(found.match({ none: () => true, some: (_$3, held) => East.lessEqual(held.since, snapshot.since) }));
        $2.if(East.lessEqual(snapshot.since, day).and(() => later), ($3) => { $3.assign(found, some(snapshot)); });
    });
    return found;
});

/** The standard marks in force on a day; before any snapshot, "can" for each. */
export const standardOn = East.function([ArrayType(Preferences), DateTimeType], Preferences.fields.standard, ($, snapshots, day) => {
    const unstated = $.const({ day: variant("can", null), afternoon: variant("can", null), night: variant("can", null),
        saturday: variant("can", null), sunday: variant("can", null), sunday_night: variant("can", null) }, Preferences.fields.standard);
    const find = $.const(preferencesOn);
    return find(snapshots, day).match({ none: () => unstated, some: (_$2, snapshot) => snapshot.standard });
});

/** The peak marks in force on a day; before any snapshot, "can" for each. */
export const peakOn = East.function([ArrayType(Preferences), DateTimeType], Preferences.fields.peak, ($, snapshots, day) => {
    const unstated = $.const({ day: variant("can", null), night: variant("can", null), saturday: variant("can", null), sunday: variant("can", null),
        four_days: variant("can", null), five_days: variant("can", null), six_days: variant("can", null) }, Preferences.fields.peak);
    const find = $.const(preferencesOn);
    return find(snapshots, day).match({ none: () => unstated, some: (_$2, snapshot) => snapshot.peak });
});

/** A person's note, on the name: "none stated" before any snapshot of their preferences, "guessed" while the one in force is a guess. */
export const statedOn = East.function([Person, DateTimeType], OptionType(Record.Types.Mark), ($, person, day) => {
    const noMark = $.const(none, OptionType(Record.Types.Mark));
    const find = $.const(preferencesOn);
    return find(person.preferences, day).match({
        none: () => some(variant("note", "none stated")),
        some: (_$2, snapshot) => snapshot.basis.hasTag("guessed").ifElse(() => some(variant("note", "guessed")), () => noMark),
    });
});

/**
 * The snapshots with a new one dated today: today's last replaced when it is stated, which the grid could have written,
 * and otherwise the new one appended. Choices the snapshots already read without that stated one write nothing, and drop
 * it: an edit that ends where it started saves none. No earlier one changes.
 */
export const withSnapshot = East.function([ArrayType(Preferences), Preferences], ArrayType(Preferences), ($, snapshots, next) => {
    const standardIn = $.const(standardOn);
    const peakIn = $.const(peakOn);
    const day = $.const(East.DateTime.roundDownDay(next.since, 1n));
    const last = $.let(none, OptionType(IntegerType));
    $.for(snapshots, ($2, snapshot, index) => {
        $2.if(East.equal(East.DateTime.roundDownDay(snapshot.since, 1n), day), ($3) => { $3.assign(last, some(index)); });
    });
    // Today's last snapshot, when it is stated.
    const mine = $.const(last.match({
        none: () => none,
        some: (_$2, at) => snapshots.get(at).basis.hasTag("stated").ifElse(() => some(at), () => none),
    }), OptionType(IntegerType));
    const without = $.const(mine.match({
        none: () => snapshots,
        some: (_$2, at) => snapshots.slice(0n, at).concat(snapshots.slice(at.add(1n), snapshots.size())),
    }));
    const unchanged = $.const(East.equal(standardIn(without, next.since), next.standard).and(() => East.equal(peakIn(without, next.since), next.peak)));
    return unchanged.ifElse(
        () => without,
        () => mine.match({
            none: () => snapshots.concat([next]),
            some: (_$2, at) => snapshots.map((_$3, snapshot, index) => index.equal(at).ifElse(() => next, () => snapshot)),
        }));
});

/** The snapshots with the standard marks set today, the peak marks in force copied: a write the person stated. */
export const withStandard = East.function([ArrayType(Preferences), Preferences.fields.standard, DateTimeType], ArrayType(Preferences), ($, snapshots, standard, day) => {
    const peak = $.const(peakOn);
    const write = $.const(withSnapshot);
    const next = $.const({ since: day, basis: variant("stated", null), standard, peak: peak(snapshots, day) }, Preferences);
    return write(snapshots, next);
});

/** The snapshots with the peak marks set today, the standard marks in force copied: a write the person stated. */
export const withPeak = East.function([ArrayType(Preferences), Preferences.fields.peak, DateTimeType], ArrayType(Preferences), ($, snapshots, peak, day) => {
    const standard = $.const(standardOn);
    const write = $.const(withSnapshot);
    const next = $.const({ since: day, basis: variant("stated", null), standard: standard(snapshots, day), peak }, Preferences);
    return write(snapshots, next);
});
```

Run over sample rows on 8 November 2026, the functions answer as the solution's rules say:

| The skill's holdings | `levelOn` | `markOn` |
|---|---|---|
| competent since March, expired 30 September | none | note "expired: competent" |
| a licence held, expiring next May | competent | lock "licence" |
| a licence not held | none | lock "no licence" |
| trainee today, signed off | trainee | none |
| none | none | none |

`withLevel` appends a row beside today's signed-off one, and replaces a row the grid wrote today. A level stepped away and back in one session leaves the holdings as they were: where the level written is the one they read without the grid's row, the row is dropped. Setting an expired level again writes a row with no expiry, so a level that lapses by rule doesn't lapse again; renewing with an expiry comes later (§8).

`withStandard` appends a snapshot beside today's guessed one, and replaces today's stated one. It drops that stated one when the choices return to the ones in force before it.

On the preferences page, `statedOn` notes each person once, on the name: "none stated" before any snapshot, and "guessed" while the snapshot in force is a guess, which tells a planner the choices aren't the person's own. An edit to either family marks the whole snapshot it writes as stated, including the other family's choices it copies, which may still be guesses. The solution keeps one basis per snapshot, which is fine for the first version.

The skills grid has a column per skill, under its team:

```tsx
/** @jsxImportSource @elaraai/east-ui */
import { East } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui";
import { Data, Record } from "@elaraai/e3-ui";

export const skillsPage = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const staff = $.let(Record.bind(people));
        const teamRows = $.let(Data.bind(teams));
        const skillRows = $.let(Data.bind(skills));
        return (
            <Record
                record={staff}
                title="Skills"
                noun={{ singular: "person", plural: "people" }}
                registers={{
                    teams: Record.register.members(teamRows.read(), { kind: "team", key: (_t, code) => code, label: (t) => t.name }),
                    skills: Record.register.members(skillRows.read(), {
                        kind: "skill", key: (_s, name) => name, label: (_s, name) => name, parent: (s) => s.team,
                    }),
                }}
                columns={{
                    name: Record.column.title(Person, { header: "Name", width: "176px",
                        value: (p) => p.name.match({ some: (_$, name) => name, none: () => p.id }) }),
                    // The skills field: a column for each skill, under its team.
                    skills: Record.column.cycle(Person, Level, {
                        each: "skills", groups: "teams",
                        width: "72px", scale: true,
                        steps: [
                            { case: "not_trained", label: "0", meta: "Not trained" },
                            { case: "trainee",     label: "1", meta: "Trainee" },
                            { case: "competent",   label: "2", meta: "Competent" },
                        ],
                        read: levelOn,
                        mark: markOn,
                        write: withLevel,
                    }),
                }}
                inspector
                name="skills"
            />
        );
    }}</Reactive>
));
```

The preferences grid has two struct families over one field, each written through the solution's own function:

```tsx
export const preferencesPage = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const staff = $.let(Record.bind(people));
        return (
            <Record
                record={staff}
                title="Shift preferences"
                noun={{ singular: "person", plural: "people" }}
                columns={{
                    // The name, noting once a row whether the person's choices are guessed or not stated yet.
                    name: Record.column.title(Person, { header: "Name", width: "176px",
                        value: (p) => p.name.match({ some: (_$, name) => name, none: () => p.id }), mark: statedOn }),
                    // The preferences field: a column for each standard choice, then one for each peak choice.
                    standard: Record.column.cycle(Person, Choice, {
                        field: "preferences",
                        each: { day: "Day", afternoon: "Afternoon", night: "Night", saturday: "Sat", sunday: "Sun", sunday_night: "Sun night" },
                        width: "80px",
                        steps: [
                            { case: "can",    label: "can",    meta: "Can work",   tone: "neutral" },
                            { case: "prefer", label: "prefer", meta: "Prefers",    tone: "success" },
                            { case: "cant",   label: "can't",  meta: "Can't work", tone: "danger" },
                        ],
                        read: standardOn,
                        write: withStandard,
                    }),
                    peak: Record.column.cycle(Person, Choice, {
                        field: "preferences",
                        each: { day: "Day", night: "Night", saturday: "Sat", sunday: "Sun", four_days: "4 days", five_days: "5 days", six_days: "6 days" },
                        width: "80px",
                        steps: [
                            { case: "can",    label: "can",    meta: "Can work",   tone: "neutral" },
                            { case: "prefer", label: "prefer", meta: "Prefers",    tone: "success" },
                            { case: "cant",   label: "can't",  meta: "Can't work", tone: "danger" },
                        ],
                        read: peakOn,
                        write: withPeak,
                    }),
                }}
                columnGroups={[
                    { label: "Standard", columnKeys: ["standard"] },
                    { label: "Peak", columnKeys: ["peak"] },
                ]}
                inspector
                name="preferences"
            />
        );
    }}</Reactive>
));
```

## 3. The API

Every option below works on every column kind a Record draws, the Sheet's kinds and the Record's own, unless its row says otherwise. The Sheet's own build refuses them in the first version (§7, item 9).

| Option | Takes | What it does |
|---|---|---|
| `each` | a register's name | One column per member of the register, in the register's order. Each column is headed by its member's label, and its cells read and write the column's field for that member. |
| `each` | `{ field: "Header", … }` | One column per field of the struct the column reads, in the order given, headed as given. |
| `groups` | a register's name | With `each` over a register: each column sits under its member's `parent`. The groups follow this register's order and take its labels as headers. |
| `field` | a field of the row | For a column keyed by a name of its own: the field it reads and writes. A column keyed by a field writes that field. |
| `read` | an East function | How a cell reads the field: `(field, member, day) → value` with `each` over a register, or `(field, day) → struct` with `each` over fields. |
| `write` | an East function | How an edit writes the field: `(field, member, value, day) → field`, or `(field, struct, day) → field`. It returns the field's new value. |
| `mark` | an East function | Words on a cell, or a lock: `(field, member, day)`, `(field, day)`, or `(row, day)` on a plain column, each returning `Option<Record.Types.Mark>`. |
| `steps` | `[{ case, label, meta?, aliases?, tone? }]` | `cycle` only. The variant's cases in stepping order, each with its chip. |

`Record.Types.Mark` is either `note: String`, words drawn in the cell, or `lock: String`, words drawn in a cell the grid then won't edit.

`read` and `write` default wherever the field's shape makes them obvious:

| The field | Default `read` | Default `write` |
|---|---|---|
| a `Dict` keyed by the member | the member's entry, or none | sets the entry; clearing removes it |
| the struct that `each` names | the struct | the new struct |
| anything else | none: the build asks for `read` and `write` | none |

**A clear** (Delete, or pasting nothing) writes none where the cell's value is an option: a `Dict`'s entry, a struct's optional field, or a `write` that takes an option. Where it isn't, as with the roster's days or the `Level` that `withLevel` takes, a column from data refuses the clear, as on a locked cell. A plain required column takes a clear and asks for a value before Save, but a column from data writes one member's value into a field it shares with other members, so it has nowhere to hold a blank. Undo still takes back an edit.

The **day** the functions get is the Record's clock: the browser's local calendar date, at UTC midnight. It turns over at midnight without a rebuild, as an age column's count does.

**The build refuses**, naming the column and the remedy:
- an `each` or a `groups` that names no register;
- a `read`, `write` or `mark` whose types don't match the field, the member's key, the kind's value and the day;
- a field with no default shape, and no `read` and `write`;
- an `each` over fields naming a field the struct lacks;
- `steps` that leave out a case, name one twice, or name one the variant lacks, and a cycle over a variant with a case that carries data, which a step has no value for;
- a literal column group naming a column made from a register, whose columns aren't known until the page runs;
- `fill` or `options` on a column from data, which the first version doesn't take.

## 4. How it behaves

- **The columns** are the register's members, in its order. With `groups`, the groups follow the groups register's order, each member under its parent. Members with no parent, or a parent that register lacks, come after the groups, with no label. A group with no members draws nothing.
- **A cell** shows the read at the Record's day. A mark's words draw in the cell. A locked cell takes no hover and no gesture: the grid won't step it, type into it, paste into it or clear it. A cell whose value isn't an option refuses a clear in the same way (§3).
- **An edit** is the kind's own gesture: a cycle steps, a number is typed. Each edit calls `write` with the field as drafted so far in the session, with every earlier edit to that field already applied, whichever column made it. Its result becomes the field's draft, one step of the history, which Undo takes back.
- **Save** commits the batch through the record's patch mutation: East's difference of each field. An appended row arrives as an insert, a replaced one as an update, and a dropped one as a delete: a row saved earlier the same day, then stepped back. A field whose draft ends where the record holds it sends nothing.
- **The side panel** shows each member as one line, in its group's section, with a locked cell's line read only. The field the columns write isn't shown there as a list of its own.
- **When the data changes**, a member added becomes a new column, one moved changes group, and one retired loses its column. Rows that still name a retired member keep that data, and show no column for it. A rename is a new member.
- **On a phone** the columns page like any others, and each group's label holds over its columns in view.

## 5. How it's built

### 5.1 The factory (e3-ui)

- **`sheet/columns.ts`** — every builder takes `each`, `groups`, `field`, `read`, `write` and `mark`, and `cycle(R, V, { steps })` sits beside `cycle(R, register, …)`. A Record's `columns` map takes a key of its own when the column names its `field`.
- **`sheet/bridge.ts`** — `describeColumn` describes a column made from data: its field, its members' key, its functions' signatures checked against them, the defaults for a `Dict` and a struct, and every refusal above.
- **`sheet/root.ts`** — the payload's columns become an East expression: the fixed columns, and each register's members mapped to wire columns where their column stands. A struct's columns are fixed at build.
- **`record/record.ts`** — `columnGroups` becomes the literal groups plus each column's computed groups. The literal groups keep the build's checks.
- **A variant's steps** cross the wire as a register keyed by the cases' names, so the renderer's cycle is unchanged. The bridge maps each case to its key and back.
- **The Sheet's build** refuses a column from data, naming the Record, where it refuses the Record's own kinds today.

### 5.2 The wire

- A wire column says which column and member it was made for, and whether its cells take a clear: `SheetColumnType.from`, an `Option<{ column, member, clears }>`.
- A cell's mark crosses as two unrendered cells beside it, as the audit column's `by` and `verb` do: its words, and whether it locks.
- **The clock.** A row's cells from data, and their marks, are read by one function the renderer calls with its day: over the row's draft once it has one, and over its entry from the source before that. Rows from the source carry none of these cells themselves. That is how an age cell counts already: the projection stays pure, and the renderer brings the clock.
- `SheetEditingType.decode` takes the day, and applies a column's `write` for each cell the gesture changed, over the draft so far.

### 5.3 The renderer (e3-ui-components)

- **The Sheet's model** reads a row's cells from data at the Record's day: when the row arrives, whenever its draft changes, and again when the day turns.
- **A lock** makes its cell read only. Today each gesture checks its column's `editable` on its own, in the grid, the strip and the side panel, for steps, typing, paste, clear and fill. Those checks become one check per cell, which reads the lock, so no gesture can miss it. The clear's check also refuses a clear where `from` says the cell takes none.
- **The cells** draw a mark's words in the record recipe's slots.
- **The column groups** already match each column to its group by key, in the header and on a phone, so they need no change.
- **The side panel** draws the columns from data as lines, in their groups' sections.

## 6. Tests and examples

- **e3-ui specs**: every refusal in §3, the Sheet's refusal of a column from data, and the payload's columns and groups as built from members.
- **e3-ui-components DOM tests**: the columns, their order and their groups; a `Dict` field with no functions; a struct; two families chaining writes on one field; Undo; Save's patch, with an insert, an update and a delete; an edit that ends where it started saving nothing; a note and a lock, and a lock refusing every gesture; a clear refused where the cell's value isn't an option; a plain column's mark; a register's change; the day's turn; the side panel's lines.
- **Examples** in `record.examples.tsx`: the hours, the roster, the order status and the worked case, each the same code as above. The plugin index is regenerated, and the e3-ui skill's Record section gains the options.
- **The showcase**: each example's page, and a phone spec over the hours.

## 7. Decisions

All ruled, and the proposal approved, on 8 November 2026.

1. **The columns follow the register's order**, and the groups follow their own register's order.
2. **A group is headed from a register of its own**, through each member's existing `parent`.
3. **A write gets the field as drafted so far.** That is the session's own contract: it decodes every gesture over the row's draft (`decode(row, draft, previous)` in `sheet/editing-bridge.ts`).
4. **The day is the local calendar date at UTC midnight**, which is how the worked case's dates are stored.
5. **The API is general**: no domain in it, the common shapes needing no functions, every kind, and machinery the Sheet and the Record share.
6. **An expired holding shows empty, with its note**, so the grid reads it as the solution's planner does, and setting the level again renews it.
7. **Locked cells are locked in both places** (D1), the grid and the side panel.
8. **It's built on the Record's branch and PR, #1537** (D3), as part of the Record's epic (#1536).
9. **The Sheet refuses the options in the first version** (D2), naming the Record, as it refuses the Record's own kinds today, with a spec of that refusal. On the Sheet, a column from data also meets its fill providers, its driver, its grouped lines and its proposals, each of which needs to learn about members. Every public method a change touches gets a spec and an example, so the Sheet takes the options later, with its own (§8).

## 8. Later

- **The Sheet taking the options**, its fill providers, driver, grouped lines and proposals taught about members, with its own examples and specs (§7, item 9).
- **The Record's day as a prop**, so a page shows and edits its records as at a date. A planner plans as at a week's first day: a page set to that day shows what the plan will read, and its writes are dated that day.
- **Filtering the rail by one member's value**: an index over (member, value) pairs.
- **The history list in the side panel**: the field's rows, read only, then editing a licence there, and renewing a level with an expiry.
- **Sign-off** as a gesture of its own.
- **Confirming a guess**: a gesture beside sign-off that marks the snapshot in force as stated without changing a choice, or, with no snapshot yet, states the defaults. Stepping a cell away and back rightly saves nothing, so the grid has no other way to record that a person confirmed them.
