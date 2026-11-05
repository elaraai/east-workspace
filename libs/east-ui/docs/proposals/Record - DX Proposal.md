# Record: DX proposal

Proposed 6 November 2026, for review before the epic and its sub-issues are filed. The visual contract is the designer's **Record — cell kinds for e3-ui** (`Record Cells.dc.html`, beside this file): its two live tables (1a, the skills matrix; 1b, shift preferences), the cell-kind catalogue (1c), the cycle and toggle states, looks, inspector line and column group (1d), and add, select and delete (1e). This proposal says how an author declares a Record, what it draws and does, what crosses the wire, and what it reuses. §4 restates the page's anatomy and behaviour as requirements with ids, so it can be built and tested without reading the prototype's script.

References: the Sheet's authoring layer in e3-ui (`packages/e3-ui/src/sheet/` — `columns.ts`, `types.ts`, `root.ts`, `sheet.ts`, `record.ts`, `registers.ts`, `fields.ts`, `actions.ts`, `edits.ts`, `transactions.ts`), the record binding (`packages/e3-ui/src/bind/record.ts`), the east-ui Table (`packages/east-ui/src/collections/table/` — `TableColumnGroupType`), the fields and editing contracts (`packages/east-ui/src/contracts/fields.ts`, `editing.ts`), the design system's Row card (`app_design_system/guidelines/cards/parts-row.html`), [EAST_UI_PROP_PATTERNS](../../../../docs/conventions/EAST_UI_PROP_PATTERNS.md), and the [Sheet actions proposal](<Sheet Actions - DX Proposal.md>), whose shape this one follows.

## Recommendation

**A Record is the e3-ui table for a system of records.** Its rows are an e3 record's entries, its grid is the east-ui Table's anatomy, and its column kinds are the Sheet's. Six new kinds join them: `title`, `person`, `toggle`, `cycle`, `age` and `audit`, plus a `boolean` that the Sheet lacks. Edits are drafts of the shared editing session behind the one history bar. Add drafts an empty record and Delete drafts a removal. A row's detail is the BuilderFrame's inspector pane.

```tsx
<Record
    slice={{ slice }}                                   // the rail over the record: search, filters, counts
    title="Skills matrix"
    noun={{ singular: "person", plural: "people" }}
    registers={{ levels: Record.register.members(levels, { kind: "level", key: l => l.key, label: l => l.key, meta: l => some(l.name) }) }}
    columns={{
        name:       Record.column.title(Skills, { header: "Name" }),
        intake:     Record.column.cycle(Skills, "levels", { header: "Intake", scale: true }),
        days_since: Record.column.age(Skills, { header: "Days since", since: p => p.updated, stale: 90n, absent: "not confirmed" }),
        updated:    Record.column.audit(Skills, { header: "Last updated", mode: "blame" }),
    }}
    columnGroups={[{ label: "Core", columnKeys: ["intake"] }]}
    groupBy="role"
    inspector
    onApply={Record.onApply(people, { keyed: true })}
/>
```

Why this shape:

- **It is the Sheet's root in the Table's anatomy.** The rows, the columns' bridge, the drafts, readiness, the strip, the inspector's forms and `Record.onApply` are the Sheet's, unchanged. The Record contributes the grid's anatomy (DS Row card: 36/32/28, pad 0 12, first and last 20, the 46 select column), the column-group row, row bands, the new cell kinds and the toolbar's Add and Delete.
- **One namespace.** `Record` already carries `Record.bind` and `Record.onApply`; the tag, `Record.column.*`, `Record.register.*`, `Record.field`, `Record.patch` and `Record.Types` join it, as `Sheet` is its tag and its namespace.
- **A cycle's states are a register.** A register is declared once and named by every column over it, as `enum` and `reference` name theirs. Its members' order is the cycle's order, their labels its chips, their `meta` its names, their `tone` its colours, and a member's label or alias typed in a cell sets it, which is how the digits work.
- **The journal is the row's own fields** (ruled 6 November 2026). `Record.Types.Change` is a type a solution adds to its record, `{ at, by, verb }`. The `audit` column draws it and `age` counts from it. The Record only reads it and never writes it, and it needs no signed-in identity and no e3 change.
- **Time since takes the client's clock.** An age cell is `now − since`, where `since` comes from the row and `now` is the browser's. The factory compiles the elapsed count into an East function `(since, now) → Integer`, and the renderer calls it with the browser's clock. Nothing in the payload is built from a clock.

## 1. What a Record is

An interface and a renderer, as every e3-ui component is (CLAUDE.md, *never build a UI component from East UI components*). The factory computes one payload and returns it through its `EastUI.component("Record", RecordPayloadType)` carrier. The `Record` renderer in `@elaraai/e3-ui-components` builds the frame in the browser with east-ui-components' `BuilderFrame`: one toolbar, the grid in main with the Sheet's strip docked under it, the footer, and the inspector pane. It draws no outer border, so the host frames it.

The payload holds the Sheet's root (`SheetRootType`), built by the very code `<Sheet>` builds it with (`createSheetBuild`, the bridge, `recordRows`, the slice's sources), beside what only a Record has: its title and noun, its column groups (the Table's `TableColumnGroupType`), its row bands and its inspector pane (the Sheet's forms).

**Its rows**, as the Sheet takes them:

- `record` is a record bound with its patch mutation, `Record.bind(record)`. Its entries are the rows, in key order, and each row's id is its key's text. `window={Data.bindPaged(record)}` reads a large one a window at a time.
- The `rows` source of `slice` (`Slice.bindRecords`) gives its record's rows, paged from it, with the narrowing drawn over them as the lens. Edits commit through `onApply={Record.onApply(record, { keyed: true })}`.

## 2. The author's API

A sketch: proposed names, not code that compiles today.

### `<Record>`'s props

| Prop | Takes | What it does |
|---|---|---|
| `record` · `window` | `Record.bind(record)`; `Data.bindPaged(record)` | The rows: the record's entries (§1) |
| `slice` | `{ slice: Slice.bindRecords(key, { rows, … }) }` | The rail on the toolbar (search, filters, presets, the summary) and, with a `rows` source, the rows |
| `onApply` | `Record.onApply(record, { keyed: true })` | With `slice`: the Apply that commits each batch through the record's patch door |
| `columns` | `{ field: Record.column.*(R, …) }` | The columns, in order, keyed by the row's fields. An `age` column alone is keyed by a name of its own (§2.4) |
| `columnGroups` | `[{ label, columnKeys }]` | The Table's column-group row: each group a run of adjacent columns under one label; `""` draws no label and no rule. The inspector's sections follow them |
| `groupBy` | a column's key | Bands the rows by that column's value, under the Roster's collapsible band, in the column's own order (its register's members, a toggle's off then on); rows with no value lead, unbanded |
| `registers` | `{ name: Record.register.members(…) }` | The registers the `reference`, `enum`, `set`, `person` and `cycle` columns name |
| `title` | `string` | The toolbar's lead: the title, then the count of the record's rows |
| `noun` | `{ singular, plural }` | What a row is called: `18 people`, `Added a person`, `No people match the search`, `Person · new` |
| `inspector` | `true` | The inspector pane: Details (the selected row's every field) and Issues |
| `fields` | `{ field: Record.field.* }` | Hints for the inspector's form, the Sheet's `fields` |
| `newRow` | `East.function([Record.Types.NewRow], Record.Types.Patch(R), …)` | A new row's values, the Sheet's `newRow`: a field it sets starts set, and a field it leaves `none` starts empty (§4, AD2) |
| `edits` | `{ insertRows?, removeRows? }` | Add and Delete, and the select column with them; both on by default, off on a read-only Record |
| `owned` | `(row) => Boolean` | Rows an upstream system owns: read only, as the Sheet's |
| `readOnly` | `boolean` | The whole Record read only: no Add, Delete, select column, hover or editor |
| `density` | `"comfortable" \| "compact" \| "condensed"` | Rows 36, 32 or 28 |
| `ready` · `applyMode` | the Sheet's | Author readiness checks; `"auto"` saves each gesture |
| `name` | `string` | Keeps two Records on one surface apart |

### `Record.column.*`

Each builder takes the row type first and returns a column checked against its field's type, as the Sheet's do. The first nine are the Sheet's own builders, re-exported: the same cell and the same editor.

| Kind | Builder | Sits on | Edits by |
|---|---|---|---|
| text | `Record.column.text(R, cfg)` | `String`, `Option<String>` | In place · ⏎ commits, esc discards |
| stamped | `Record.column.stamped(R, cfg)` | `String`, `Option<String>` | Never · an upstream system owns it; paste and clear skip it |
| integer | `Record.column.integer(R, cfg)` | `Integer`, `Option<Integer>` | In place · mono, right-aligned |
| quantity | `Record.column.quantity(R, cfg)` | `Float`, `Option<Float>` | In place · mono, right-aligned, its `unit` after the value |
| date | `Record.column.date(R, cfg)` | `DateTime`, `Option<DateTime>` | In place · the Sheet's date grammar: `+3d`, `mon`, `18/9` |
| enum | `Record.column.enum(R, register, cfg)` | `String`, `Option<String>` | Menu of the register · the member's tone is its dot |
| reference | `Record.column.reference(R, register, cfg)` | `String`, `Option<String>` | Menu of the register · typed text resolves to a member's key |
| set | `Record.column.set(R, register, cfg)` | `Sheet.Types.Link`, `Array<Member>`, `String` | In place · comma-separated members |
| action | `Record.column.action(R, V, cfg)` | `V`, `Option<V>` | The Sheet's action column (#1474): the next half takes the first case, ▾ the rest |
| boolean | `Record.column.boolean(R, cfg)` | `Boolean` | Click or space · a Checkbox, centred |
| title | `Record.column.title(R, cfg)` | `String` | Not in place · selects the row and opens it in the inspector |
| person | `Record.column.person(R, register, cfg)` | `String`, `Option<String>` | Menu of the register's people · neutral initials, never a colour per person |
| toggle | `Record.column.toggle(R, cfg)` | `Boolean` | Click or space flips · its two words |
| cycle | `Record.column.cycle(R, register, cfg)` | `String` | Click → next · ⇧-click → previous · a member's label or alias sets · ⌫ the first state |
| age | `Record.column.age(R, cfg)` | its own key | Read only · whole days (or `unit`) since `since`, to the browser's now · warns at `stale` |
| audit | `Record.column.audit(R, cfg)` | `Record.Types.Change`, `Option<Change>` | Read only · the last change: its date, or its date, verb and who · Pending while the row holds drafts |

`Record.column.lookup`, `link` and `custom` are not offered: a Record has no driver, and the link grammar is the Sheet's planning surface.

### 2.1 The new kinds' configs

Every config takes the Sheet's base fields where they apply: `header`, `sub`, `width`, `editable`, `detail`.

```ts
/** A record's title — `Record.column.title(R, cfg)`, on a String field. */
interface RecordTitleConfig<R extends StructType> extends SheetColumnBaseConfig<R, StringType> {
    /** Neutral initials before the title, drawn from it (`A. Morgan` → `AM`). Default false. */
    avatar?: boolean;
}

/** A person, by a register's key — `Record.column.person(R, register, cfg)`. */
interface RecordPersonConfig<R extends StructType> extends SheetColumnBaseConfig<R, StringType> {
    /** The words for no one, beside a dashed ring. Default "Unassigned". */
    unassigned?: string;
}

/** Two states on a Boolean — `Record.column.toggle(R, cfg)`. */
interface RecordToggleConfig<R extends StructType> extends SheetColumnBaseConfig<R, BooleanType> {
    /** The word for true — "yes". */
    on: string;
    /** The word for false — "no". */
    off: string;
    /** chip (default) or mark (§4, C6). */
    look?: "chip" | "mark";
}

/** The members of a register, stepped by a click — `Record.column.cycle(R, register, cfg)`, on a String field holding a member's key. */
interface RecordCycleConfig<R extends StructType> extends SheetColumnBaseConfig<R, StringType> {
    /** A scale: the first member draws empty and the rest step up the heat ramp in order. Without it, each member's `tone` colours it. */
    scale?: boolean;
    /** chip (default) or mark (§4, C6). */
    look?: "chip" | "mark";
}

/** Time since a moment, to the browser's now — `Record.column.age(R, cfg)`, keyed by a name of its own. */
interface RecordAgeConfig<R extends StructType> {
    header?: SubtypeExprOrValue<StringType>;
    sub?: SubtypeExprOrValue<StringType>;
    width?: SubtypeExprOrValue<StringType>;
    /** When the clock started, over the row: a DateTime, a Change (its `at`), or an Option of either; `none` draws `absent`. */
    since: (row: ExprType<R>) => SubtypeExprOrValue<DateTimeType | OptionType<DateTimeType> | RecordChangeType | OptionType<RecordChangeType>>;
    /** What one counts. Default "days". */
    unit?: "hours" | "days" | "weeks";
    /** At or past this many, the cell warns and the row counts as stale. Default none. */
    stale?: bigint;
    /** The words when `since` is none — "not confirmed". Default "—". */
    absent?: string;
}

/** The last change to a row, as the solution keeps it — `Record.column.audit(R, cfg)`. */
interface RecordAuditConfig<R extends StructType> {
    header?: SubtypeExprOrValue<StringType>;
    sub?: SubtypeExprOrValue<StringType>;
    width?: SubtypeExprOrValue<StringType>;
    /** `date` (default): the date, its verb and who in the tooltip and the inspector · `blame`: the date, then `verb · who`. */
    mode?: "date" | "blame";
    /** The words when the field is none. Default "—". */
    absent?: string;
}
```

`boolean` takes the base config alone.

### 2.2 The journal: `Record.Types.Change`

```ts
Record.Types.Change = StructType({
    at:   DateTimeType,   // when the row last changed, or was confirmed
    by:   StringType,     // who did it, as the solution names them
    verb: StringType,     // what they did: "changed", "confirmed", "created", "imported"
})
```

A solution that wants an audit trail adds a field of this type, or its `Option`, to its record's row type, and its own processes write it: an import, an integration, or a mutation of its own. The Record reads it and never writes it. An Apply leaves the field as it was; while a row holds drafts, its audit cell reads **Pending** and counts them (AU4). A new row's `Option<Change>` field starts `none`, so it is never an issue, and its audit and age cells stay empty until the record holds the row.

### 2.3 Time since: the client's clock

`age` has two halves:

- **`since`, from the row:** an accessor that the factory compiles once and projects into the cell (`EAST_UI_PROP_PATTERNS` §3), as a date column's `actual` is.
- **`now`, from the browser.** The factory compiles the elapsed count, `(since, now) => Integer`, whole `unit`s from `since` to `now` rounded down, into the column's kind. The renderer calls it for each age cell it draws, with the browser's clock read once per render. It reads the clock again each minute, so a day that turns over moves every age cell, the stale dots, the footer's stale count and the inspector's facts together.

So the payload never holds a clock's reading, and the count is East's (`durationMilliseconds`), never JavaScript date arithmetic.

### 2.4 Column keys

A column is keyed by the field it sits on, the `<Table columns>` idiom, so a typo or a kind on the wrong field type is a type error. `age` is the one exception: it shows no field, so it is keyed by a name of its own that no field has, as the designer's `days_since` is. The `columns` prop is typed as a mapped type over its own keys. A row field's key must hold a column over that field, and any other key must hold an `age` column.

### 2.5 Row bands: `groupBy`

`groupBy="role"` bands the rows by the `role` column's cell. Bands follow the column's own order: a `reference`, `enum`, `person` or `cycle` column's register members, a toggle's off then on, or otherwise the values in East's order. A row with no value leads, unbanded; a new row is one until its value is set. Each band folds, kept per viewer under the Record's `name`. Over `slice`, the rows source must read in the band column's order, through the record's index on its field (`index.on(["role"])`) (§7, decision 4).

### 2.6 What the compiler and the build catch

- A column on a field it cannot sit on; a non-field key holding anything but `age`; `age` under a field's key.
- At build: a register a column names that `registers` does not declare; `columnGroups` naming a key that is not a column, or a group whose columns are not adjacent, or a column in two groups; `groupBy` naming no column, or an `age` or `audit` column; `title` given twice; `onApply` beside `record`; `record`, `window` and `slice`'s `rows` together; an action column without the Sheet's machine (as the Sheet checks it).
- The Sheet refuses the Record's kinds at build in this epic (§7, decision 3).

## 3. Worked examples

Each example is complete: the record, its binding, the Record. All five go into `test/record/record.examples.tsx`, wired into its spec per EXAMPLES_AUTHORING, and onto a Record page of the showcase. Examples 2 and 3 are the designer's 1a and 1b.

### Example 1 — the least: a title, a toggle and a cycle

```tsx
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, DictType, East, StringType, StructType, some } from "@elaraai/east";
import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
import { Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

export const Crew = StructType({ name: StringType, inducted: BooleanType, forklift: StringType });
export const recordCrew = e3.record("record_crew", DictType(StringType, Crew), {
    initial: new Map([
        ["C-001", { name: "A. Morgan", inducted: true, forklift: "2" }],
        ["C-002", { name: "B. Ellis", inducted: false, forklift: "0" }],
        ["C-003", { name: "C. Patel", inducted: true, forklift: "1" }],
    ]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

const crew = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const members = $.let(Record.bind(recordCrew));
        const LevelType = StructType({ key: StringType, name: StringType });
        const levels = $.let([
            { key: "0", name: "Not trained" },
            { key: "1", name: "Supervised" },
            { key: "2", name: "Competent" },
        ], ArrayType(LevelType));
        return (
            <Box height="360px">
                <Record
                    record={members}
                    title="Crew"
                    noun={{ singular: "crew member", plural: "crew members" }}
                    registers={{ levels: Record.register.members(levels, { kind: "level", key: l => l.key, label: l => l.key, meta: l => some(l.name) }) }}
                    columns={{
                        name:     Record.column.title(Crew, { header: "Name", width: "160px" }),
                        inducted: Record.column.toggle(Crew, { header: "Inducted", width: "80px", on: "yes", off: "no" }),
                        forklift: Record.column.cycle(Crew, "levels", { header: "Forklift", width: "72px", scale: true }),
                    }}
                />
            </Box>
        );
    }}</Reactive>
));
```

A click on B. Ellis's Forklift steps it `0 → 1` as one draft: the cell tints, Apply commits through the record's patch door, and ⌘Z takes it back. Typing `2` sets it at once.

### Example 2 — the designer's 1a: a skills matrix

Ten cycle columns on the heat ramp under three column groups. Rows are banded by role, the rail searches names and roles, the age warns past 90 days, and the audit is in blame mode.

```tsx
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, DictType, East, OptionType, StringType, StructType, some } from "@elaraai/east";
import { Box, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

export const Skills = StructType({
    name: StringType, role: StringType,
    intake: StringType, review: StringType, dispatch: StringType, handover: StringType,
    scanner: StringType, console: StringType, reports: StringType,
    auditing: StringType, training: StringType, planning: StringType,
    updated: OptionType(Record.Types.Change),
});
export const recordSkills = e3.record("record_skills", DictType(StringType, Skills), {
    initial: new Map([
        ["P-0401", { name: "A. Morgan", role: "Operator", intake: "2", review: "2", dispatch: "2", handover: "2", scanner: "1", console: "1",
            reports: "0", auditing: "0", training: "0", planning: "0", updated: some({ at: new Date("2026-09-18T09:12:00Z"), by: "M. Hale", verb: "confirmed" }) }],
        ["P-0408", { name: "B. Ellis", role: "Operator", intake: "0", review: "0", dispatch: "0", handover: "0", scanner: "0", console: "0",
            reports: "0", auditing: "2", training: "2", planning: "2", updated: some({ at: new Date("2026-10-17T14:40:00Z"), by: "S. Park", verb: "changed" }) }],
        ["P-0415", { name: "C. Patel", role: "Contractor", intake: "2", review: "1", dispatch: "1", handover: "1", scanner: "0", console: "0",
            reports: "0", auditing: "0", training: "0", planning: "0", updated: some({ at: new Date("2026-11-02T11:05:00Z"), by: "J. Ortiz", verb: "changed" }) }],
        ["P-0450", { name: "H. Kim", role: "Operator", intake: "1", review: "0", dispatch: "1", handover: "0", scanner: "2", console: "2",
            reports: "2", auditing: "0", training: "0", planning: "0", updated: some({ at: new Date("2026-07-10T08:30:00Z"), by: "A. Rowe", verb: "changed" }) }],
        ["P-0520", { name: "V. Lowe", role: "Team lead", intake: "2", review: "2", dispatch: "1", handover: "0", scanner: "0", console: "1",
            reports: "1", auditing: "1", training: "1", planning: "1", updated: some({ at: new Date("2026-11-03T16:20:00Z"), by: "M. Hale", verb: "changed" }) }],
    ]),
    indexes: (index) => ({
        // What the rail searches and filters by, and the bands' order.
        record_skills_by_name: index.on(["name"]),
        record_skills_by_role: index.on(["role"]),
    }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

const skills = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const people = $.let(Record.bind(recordSkills));
        const slice = $.let(Slice.bindRecords("record.skills", {
            rows: {
                source: Data.bindPaged(recordSkills, { indexes: ["record_skills_by_name", "record_skills_by_role"] }),
                label: "People",
                fields: { role: { label: "Role", hints: ["Operator", "Contractor", "Team lead"] } },
                search: ["name", "role"],
            },
        }));
        const LevelType = StructType({ key: StringType, name: StringType });
        const levels = $.let([
            { key: "0", name: "Not trained" },
            { key: "1", name: "Supervised" },
            { key: "2", name: "Competent" },
        ], ArrayType(LevelType));
        const roles = $.let(["Operator", "Contractor", "Team lead"], ArrayType(StringType));
        return (
            <Box height="760px">
                <Record
                    slice={{ slice }}
                    title="Skills matrix"
                    noun={{ singular: "person", plural: "people" }}
                    registers={{
                        levels: Record.register.members(levels, { kind: "level", key: l => l.key, label: l => l.key, meta: l => some(l.name) }),
                        roles:  Record.register.members(roles, { kind: "role", key: r => r, label: r => r }),
                    }}
                    columns={{
                        name:       Record.column.title(Skills, { header: "Name", width: "156px" }),
                        role:       Record.column.reference(Skills, "roles", { header: "Role", width: "136px" }),
                        intake:     Record.column.cycle(Skills, "levels", { header: "Intake", width: "72px", scale: true }),
                        review:     Record.column.cycle(Skills, "levels", { header: "Review", width: "72px", scale: true }),
                        dispatch:   Record.column.cycle(Skills, "levels", { header: "Dispatch", width: "72px", scale: true }),
                        handover:   Record.column.cycle(Skills, "levels", { header: "Handover to next shift", width: "72px", scale: true }),
                        scanner:    Record.column.cycle(Skills, "levels", { header: "Scanner", width: "72px", scale: true }),
                        console:    Record.column.cycle(Skills, "levels", { header: "Console", width: "72px", scale: true }),
                        reports:    Record.column.cycle(Skills, "levels", { header: "Reports", width: "72px", scale: true }),
                        auditing:   Record.column.cycle(Skills, "levels", { header: "Auditing", width: "72px", scale: true }),
                        training:   Record.column.cycle(Skills, "levels", { header: "Training", width: "72px", scale: true }),
                        planning:   Record.column.cycle(Skills, "levels", { header: "Planning", width: "72px", scale: true }),
                        days_since: Record.column.age(Skills, { header: "Days since", width: "92px", since: p => p.updated, stale: 90n, absent: "not confirmed" }),
                        updated:    Record.column.audit(Skills, { header: "Last updated", width: "264px", mode: "blame" }),
                    }}
                    columnGroups={[
                        { label: "Core", columnKeys: ["intake", "review", "dispatch", "handover"] },
                        { label: "Tools", columnKeys: ["scanner", "console", "reports"] },
                        { label: "Advanced", columnKeys: ["auditing", "training", "planning"] },
                    ]}
                    groupBy="role"
                    inspector
                    onApply={Record.onApply(people, { keyed: true })}
                    name="skills"
                />
            </Box>
        );
    }}</Reactive>
));
```

Walking the mock with this declaration, on 5 November 2026:

| Row | Cell | Why |
|---|---|---|
| A. Morgan | Scanner `1 → 2` and Reports `0 → 1`, tinted; Last updated `● PENDING 2 changes` | Two drafts; the audit counts the row's drafts (AU4) |
| H. Kim | Days since `● 118` in warn | 118 ≥ `stale` 90 |
| any row | Days since `48`, Last updated `2026-09-18 confirmed · M. Hale` | `blame` mode over the row's `updated` |
| Contractor band | `▾ Contractor · 1 person` | `groupBy="role"`, in the `roles` register's order |
| Header | `HANDOVER TO NE…`, the whole label in its tooltip | One line; ellipsis (HD3) |
| Footer | `5 of 5 people · 1 stale · no update in 90 days · 0 Not trained · 1 Supervised · 2 Competent` | The shown rows, the age's stale count, the cycles' shared register (FT2) |

### Example 3 — the designer's 1b: shift preferences

Valence tones, avatars on the title, the audit in date mode. The digits come from the members' aliases.

```tsx
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, DictType, East, OptionType, StringType, StructType, some, variant } from "@elaraai/east";
import { Box, Reactive, StatusValueType, UIComponentType } from "@elaraai/east-ui";
import { Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

export const Preferences = StructType({
    name: StringType, role: StringType,
    days: StringType, afternoon: StringType, nights: StringType, sat: StringType, sun: StringType, overtime: StringType,
    updated: OptionType(Record.Types.Change),
});
export const recordPreferences = e3.record("record_preferences", DictType(StringType, Preferences), {
    initial: new Map([
        ["P-0401", { name: "A. Morgan", role: "Operator", days: "prefer", afternoon: "can", nights: "can", sat: "can", sun: "can", overtime: "prefer",
            updated: some({ at: new Date("2026-10-21T10:15:00Z"), by: "K. Lund", verb: "changed" }) }],
        ["P-0415", { name: "C. Patel", role: "Contractor", days: "can", afternoon: "prefer", nights: "cannot", sat: "prefer", sun: "cannot", overtime: "can",
            updated: some({ at: new Date("2026-10-24T13:02:00Z"), by: "S. Park", verb: "changed" }) }],
        ["P-0422", { name: "D. Novak", role: "Operator", days: "prefer", afternoon: "can", nights: "can", sat: "can", sun: "can", overtime: "can",
            updated: some({ at: new Date("2026-05-13T09:41:00Z"), by: "S. Park", verb: "changed" }) }],
    ]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

const preferences = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const people = $.let(Record.bind(recordPreferences));
        const ChoiceType = StructType({ key: StringType, label: StringType, name: StringType, aliases: ArrayType(StringType), tone: StatusValueType });
        const choices = $.let([
            { key: "can",    label: "can",    name: "Can work",   aliases: ["1"], tone: variant("neutral", null) },
            { key: "prefer", label: "prefer", name: "Prefers",    aliases: ["2"], tone: variant("success", null) },
            { key: "cannot", label: "can't",  name: "Can't work", aliases: ["3"], tone: variant("danger", null) },
        ], ArrayType(ChoiceType));
        const roles = $.let(["Operator", "Contractor"], ArrayType(StringType));
        return (
            <Box height="720px">
                <Record
                    record={people}
                    title="Shift preferences"
                    noun={{ singular: "person", plural: "people" }}
                    registers={{
                        choices: Record.register.members(choices, { kind: "choice", key: c => c.key, label: c => c.label, meta: c => some(c.name),
                            aliases: c => c.aliases, tone: c => some(c.tone) }),
                        roles: Record.register.members(roles, { kind: "role", key: r => r, label: r => r }),
                    }}
                    columns={{
                        name:       Record.column.title(Preferences, { header: "Name", width: "176px", avatar: true }),
                        role:       Record.column.reference(Preferences, "roles", { header: "Role", width: "136px" }),
                        days:       Record.column.cycle(Preferences, "choices", { header: "Days", width: "80px" }),
                        afternoon:  Record.column.cycle(Preferences, "choices", { header: "Afternoon", width: "80px" }),
                        nights:     Record.column.cycle(Preferences, "choices", { header: "Nights", width: "80px" }),
                        sat:        Record.column.cycle(Preferences, "choices", { header: "Sat", width: "80px" }),
                        sun:        Record.column.cycle(Preferences, "choices", { header: "Sun", width: "80px" }),
                        overtime:   Record.column.cycle(Preferences, "choices", { header: "Overtime", width: "80px" }),
                        days_since: Record.column.age(Preferences, { header: "Days since", width: "92px", since: p => p.updated, stale: 90n, absent: "not confirmed" }),
                        updated:    Record.column.audit(Preferences, { header: "Last updated", width: "136px" }),
                    }}
                    columnGroups={[
                        { label: "Shifts", columnKeys: ["days", "afternoon", "nights"] },
                        { label: "Weekends", columnKeys: ["sat", "sun"] },
                        { label: "", columnKeys: ["overtime"] },
                    ]}
                    groupBy="role"
                    inspector
                    name="preferences"
                />
            </Box>
        );
    }}</Reactive>
));
```

D. Novak's Sun reads `can't` in neg with the row washed: one draft. Its tooltip reads `Sun · Can't work · was can`. Typing `2` sets `prefer`. The audit shows `2026-05-13`, with `changed · S. Park` in its tooltip and in the inspector's Last updated.

### Example 4 — every kind (1c)

Every kind, as the cell-kind catalogue draws it: text, stamped, integer, quantity, date, enum, reference, set, boolean, title, person, toggle and cycle, with age and audit. Example 2 of the [Sheet actions proposal](<Sheet Actions - DX Proposal.md>) covers the action column.

```tsx
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, OptionType, StringType, StructType, none, some, variant } from "@elaraai/east";
import { Box, Reactive, StatusValueType, UIComponentType } from "@elaraai/east-ui";
import { Record, Sheet } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

export const Operator = StructType({
    name: StringType, badge: StringType, notes: StringType, shifts: IntegerType, hours: FloatType,
    started: OptionType(DateTimeType), status: StringType, role: StringType, certificates: Sheet.Types.Link,
    inducted: BooleanType, supervisor: OptionType(StringType), night: BooleanType, preference: StringType,
    updated: OptionType(Record.Types.Change),
});
export const recordOperators = e3.record("record_operators", DictType(StringType, Operator), {
    initial: new Map([
        ["P-0401", { name: "A. Morgan", badge: "EXT-88213", notes: "Prefers day shifts through March", shifts: 1482n, hours: 38.5,
            started: some(new Date("2026-09-18T00:00:00Z")), status: "active", role: "Operator",
            certificates: { from: [], to: [variant("identified", { key: "Forklift" }), variant("identified", { key: "Confined space" })] },
            inducted: true, supervisor: some("S. Park"), night: false, preference: "prefer",
            updated: some({ at: new Date("2026-09-18T09:12:00Z"), by: "M. Hale", verb: "confirmed" }) }],
        ["P-0408", { name: "B. Ellis", badge: "EXT-88240", notes: "", shifts: 96n, hours: 12.0,
            started: none, status: "leave", role: "Contractor", certificates: { from: [], to: [] },
            inducted: false, supervisor: none, night: true, preference: "can", updated: none }],
    ]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

const operators = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const records = $.let(Record.bind(recordOperators));
        const StatusType = StructType({ key: StringType, label: StringType, tone: StatusValueType });
        const statuses = $.let([
            { key: "active", label: "Active",   tone: variant("success", null) },
            { key: "leave",  label: "On leave", tone: variant("warning", null) },
            { key: "left",   label: "Left",     tone: variant("neutral", null) },
        ], ArrayType(StatusType));
        const roles = $.let(["Operator", "Contractor", "Team lead"], ArrayType(StringType));
        const certificates = $.let(["Forklift", "Confined space", "First aid", "Working at height"], ArrayType(StringType));
        const supervisors = $.let(["S. Park", "M. Hale", "J. Ortiz"], ArrayType(StringType));
        const ChoiceType = StructType({ key: StringType, label: StringType, name: StringType, tone: StatusValueType });
        const choices = $.let([
            { key: "can",    label: "can",    name: "Can work",   tone: variant("neutral", null) },
            { key: "prefer", label: "prefer", name: "Prefers",    tone: variant("success", null) },
            { key: "cannot", label: "can't",  name: "Can't work", tone: variant("danger", null) },
        ], ArrayType(ChoiceType));
        return (
            <Box height="480px">
                <Record
                    record={records}
                    title="Operators"
                    noun={{ singular: "operator", plural: "operators" }}
                    registers={{
                        statuses:     Record.register.members(statuses, { kind: "status", key: s => s.key, label: s => s.label, tone: s => some(s.tone) }),
                        roles:        Record.register.members(roles, { kind: "role", key: r => r, label: r => r }),
                        certificates: Record.register.members(certificates, { kind: "certificate", key: c => c, label: c => c }),
                        supervisors:  Record.register.members(supervisors, { kind: "person", key: p => p, label: p => p }),
                        choices:      Record.register.members(choices, { kind: "choice", key: c => c.key, label: c => c.label, meta: c => some(c.name), tone: c => some(c.tone) }),
                    }}
                    columns={{
                        name:         Record.column.title(Operator, { header: "Name", width: "184px", avatar: true }),
                        badge:        Record.column.stamped(Operator, { header: "Badge", width: "120px", owner: "Gatehouse" }),
                        notes:        Record.column.text(Operator, { header: "Notes", width: "184px" }),
                        shifts:       Record.column.integer(Operator, { header: "Shifts", width: "120px" }),
                        hours:        Record.column.quantity(Operator, { header: "Hours", width: "120px", unit: "hrs" }),
                        started:      Record.column.date(Operator, { header: "Started", width: "120px" }),
                        status:       Record.column.enum(Operator, "statuses", { header: "Status", width: "120px" }),
                        role:         Record.column.reference(Operator, "roles", { header: "Role", width: "184px" }),
                        certificates: Record.column.set(Operator, "certificates", { header: "Certificates", width: "248px" }),
                        inducted:     Record.column.boolean(Operator, { header: "Inducted", width: "72px" }),
                        supervisor:   Record.column.person(Operator, "supervisors", { header: "Supervisor", width: "160px" }),
                        night:        Record.column.toggle(Operator, { header: "Nights", width: "80px", on: "yes", off: "no" }),
                        preference:   Record.column.cycle(Operator, "choices", { header: "Overtime", width: "80px" }),
                        days_since:   Record.column.age(Operator, { header: "Days since", width: "96px", since: o => o.updated, stale: 90n, absent: "not confirmed" }),
                        updated:      Record.column.audit(Operator, { header: "Last updated", width: "232px", mode: "blame" }),
                    }}
                    inspector
                />
            </Box>
        );
    }}</Reactive>
));
```

### Example 5 — read only

Example 2 with `readOnly` draws the same cells with no hover, the default cursor, no select column and no Add or Delete. The rail still narrows and counts, and the inspector shows every field read only. The example is `recordSkillsReadOnly`: Example 2's body with `readOnly` and no `onApply`.

## 4. Anatomy and behaviour

Values are East tokens and sizes are px at 1×. Each requirement has an id for tests and visual invariants. The renderer realises each value through the theme's recipes (tokens only, CLAUDE.md); a value here names what the recipe must equal, never an inline style.

### Frame

| Id | Part | Spec |
|---|---|---|
| FR1 | Frame | `BuilderFrame`: toolbar, main (grid, then strip, then footer), the inspector pane 320 at the right with a rule at its left. No outer border |
| FR2 | Toolbar | 44 tall, pad 0 20, gap 12, a `--rule` under it, `--paper`. Items left to right: title, rail, status line, Add and Delete, the history bar |
| FR3 | Title | Mono `--fs-label-sm` 600, 0.14em, caps, `--ink`, then 8 on the count: 16 tall, pad 0 4, `--r-sm`, `--paper-3`, mono `--fs-label-sm` 600 tnum `--ink-2`, the record's row count |
| FR4 | Rail | The slice rail's own items: search (14 icon slot, `fa-magnifying-glass` 10 `--ink-4`; box 200×28 `--rule-strong` `--r-md`; the `/` key), filters (`fa-filter`, the dashed `+ FILTER` chip). Nothing new |
| FR5 | Status line | Flex 1, right-aligned, mono `--fs-label-lg` `--ink-3`, one line with an ellipsis, `role="status"` `aria-live="polite"`. It holds the last gesture's words (§4 messages), else `N selected of M` while rows are ticked |
| FR6 | Add · Delete | The button recipe, outline sm: 28, pad 0 12, gap 8, Inter Tight `--fs-body-sm` 500, `--r-md`, `--rule-strong` edge, `--paper`, hover `--paper-3`; `fa-plus` and `fa-minus`. 8 apart, 12 before the history bar. Delete is off (`--ink-5`, no hover) until rows are ticked, with tooltip `Tick rows to delete them`, else `Delete N selected`. Both hidden on a read-only Record or with `edits` off |
| FR7 | History bar | The shared `HistoryBar`: Issues (`fa-triangle-exclamation`, its own slot, shown only with issues, `N issues · go to the first`), Undo, Redo, Discard (`fa-xmark`), Apply (`fa-check`), each 28 square, `--r-sm`; off `--ink-3` at 0.5 |

### Grid

| Id | Part | Spec |
|---|---|---|
| GR1 | Rows | 36 · 32 · 28 at comfortable · compact · condensed, rule included; a `--rule` under each; `--paper`. The DS Row card |
| GR2 | Cell padding | 0 12; the first and last cells 20; a cycle or toggle cell 4 each side, centred; an age cell right-aligned |
| GR3 | Text | Text cells Inter Tight `--fs-body`; values mono `--fs-body` 500 tnum |
| GR4 | Scroll | Rows scroll under a sticky head (the group row and the header row, together) |
| HD1 | Group row | 24 tall. Each group spans its columns: label mono `--fs-label-xs` 600, 0.14em, caps, line 18, `--ink-4`, centred, one line; a 1px `--rule-strong` under its columns, inset 6 at each end. An unlabelled group draws neither |
| HD2 | Header row | The row's height. Labels mono `--fs-label-sm` 600, 0.1em, caps, line 14, `--ink-4`, aligned as the cells are |
| HD3 | Long labels | One line, an ellipsis; the whole label in its tooltip and in the inspector's field |
| HD4 | No sorting | Headers sort nothing; order is the record's, or the bands' |
| SL1 | Select column | 46 wide, pad left 20: a checkbox 14, radius 3, `--rule-strong` edge on `--paper`; ticked `--brand-d` fill and edge, `fa-check` 9 `--paper`. The header's ticks every row shown (`Select all shown`); some ticked draws `fa-minus` `--ink-4`; all ticked, ticked (`Deselect all`) |
| BD1 | Band | The Roster's collapsible band (`schedule-group`): min 38, `--paper-2`, a `--rule` under, sticky content pad 7 16 gap 8: chevron 10 `--ink-3` (down open, right folded), the value in DM Sans `--fs-title-xs` 700, then mono `--fs-label-sm` tnum `--ink-3` `N people`. A click folds it; folds are kept per viewer |
| EM1 | Nothing shown | Centred, pad 32 20, gap 8: `×` mono `--fs-num` `--rule-strong`; `No people match the search` DM Sans `--fs-title-xs` 700; `Clear the search →` `--fs-body-sm` 500 `--brand-d` after a `☐` mono `--ink-4`, which clears the rail's search |

### States

| Id | State | Row | Cell |
|---|---|---|---|
| ST1 | Rest | `--paper` | transparent |
| ST2 | Row hover | `--paper-2` | transparent |
| ST3 | Cell hover | — | A cycle, toggle or boolean cell `--paper-3`, as the action cell's controls do; any other none |
| ST4 | Selected or ticked row | `--paper-3` | — |
| ST5 | Active cell | — | `--paper-3` and `--shadow-focus-inset` |
| ST6 | Dirty cell | — | `--brand-tint` until Apply; the active cell's `--paper-3` wins |
| ST7 | Draft row (new, or holding drafts) | `color-mix(in oklch, var(--warn) 8%, var(--paper))`, unchanged on hover | — |
| ST8 | A new row's empty editable cell | — | `color-mix(in srgb, var(--warn) 17%, var(--paper))`, no text, no mark; tooltip `Intake · required` |
| ST9 | Owned row, read-only Record | No hover | The same chip, no hover, the default cursor |

The chip keeps its state's look in every state (ST1–ST9).

### Cells

| Id | Kind | Spec |
|---|---|---|
| C1 | title | Inter Tight `--fs-body` 500 `--ink`, ellipsis; tooltip `A. Morgan · P-0401`. With `avatar`: 24 (20 at compact and condensed), round, `--rule-strong` edge, `--paper-3`, mono `--fs-label-sm` (`--fs-label-xs`) 600 0.04em caps `--ink-2`, initials of the first and last words without dots; 8 before the text |
| C2 | person | The avatar (C1), then the member's label; none: a 24 dashed `--rule-strong` ring, `role="img"`, and `Unassigned` in `--ink-4` |
| C3 | boolean | A checkbox 14, radius 3, centred: true `--brand-d` fill and edge with a `--paper` tick; false `--rule-strong` edge on `--paper` |
| C4 | Chip (cycle, toggle) | 22 tall (15 at compact and condensed), min width the column's widest label (one width per column, so states line up), pad 0 6, 1px edge, `--r-sm`, mono `--fs-label-md` (`--fs-label-xs`) 600 tnum |
| C5 | Chip looks | First scale member, toggle off, neutral: `--paper` · `--ink-4` · edge `--rule-strong`. Scale steps: the rest up the heat ramp to `--heat-4`, evenly (three members: `--heat-2` with `--ink`, `--heat-4` with `--paper`; fill and edge alike). Toggle on: `--heat-4`, `--paper`. Valence: a 6% wash `color-mix(in oklch, var(--<tone>) 6%, transparent)`, a 1px `--<tone>` edge and the `--<tone>-text` step, for success (`pos`), danger (`neg`), warning (`warn`) and info |
| C6 | Mark look | The Status idiom, quieter, for long narrow columns. A scale: one 8 pip per member after the first, gap 4, filled `--brand-d` up to the member, else a 1px `--ink-5` ring. A valence: an 8 dot (`--<tone>`, or a 1px `--ink-4` ring when neutral), 8, then the label mono `--fs-label-md` 600 0.1em caps in `--<tone>-text` (neutral `--ink-3`) |
| C7 | age | Mono `--fs-body` 500 tnum `--ink`, right-aligned. Stale: an 8 `--warn` dot (`aria-label="Stale"`), 8, then the count in `--warn-text`. None: `absent` in mono italic 400 `--ink-4`. Tooltip `48 days`, or `Stale · 118 days · threshold 90` |
| C8 | audit, held | The date mono `--fs-body` 500 tnum `--ink` (`YYYY-MM-DD`), 8, then in blame mode `verb · by` `--fs-body-sm` `--ink-3`, ellipsis. Tooltip `2026-09-18 09:12 · confirmed · M. Hale` |
| C9 | audit, pending | While the row holds drafts, in either mode: an 8 `--brand` dot, 8, `PENDING` mono `--fs-label-md` 600 0.1em caps `--brand-dd`, 8, then `--fs-body-sm` `--brand-dd`: `2 changes` in blame mode, `2` in date mode. Tooltip `2 pending` |
| C10 | Absent value | Every kind's empty value: mono italic 400 `--ink-4` (`no data`, `not started`, `not confirmed`) |
| C11 | Sheet kinds | text, stamped, integer, quantity, date, enum, reference, set and action draw as the Sheet's cells do, in the Record's row and padding |

### Pointer and keyboard

| Id | Gesture | Result |
|---|---|---|
| P1 | Click a cell | The ring moves there and the row is selected; the inspector shows it |
| P2 | Click a cycle or toggle cell | P1, and the cell steps to the next state: one draft, one undo step. ⇧-click steps back. The cell never opens an editor |
| P3 | Click a boolean cell | P1, and it flips: one draft |
| P4 | Click a title cell | P1; the inspector opens on Details. Not in place |
| P5 | Click a select checkbox | Ticks or unticks the row; the header ticks every row shown, or none when all are ticked. Ticking never moves the ring |
| P6 | Rest the pointer on a cell | The strip previews that cell; on leaving the grid, the strip returns to the active cell |
| K1 | ↑ ↓ ← → | Move the ring, clamped at the edges, selecting the row; with no ring, the first row's first editable column |
| K2 | Space · ⏎ on a cycle or toggle | Steps (⇧ steps back) |
| K3 | ⌫ · Delete on a cycle | Sets the first member |
| K4 | A key on a cycle | A member whose label or alias is that key is set at once (`0`–`2` in 1a, `1`–`3` in 1b) |
| K5 | ⌘Z · ⇧⌘Z | Undo · redo, the shared session's; the ring moves to the cell the step changed |
| K6 | Typing on another kind | The Sheet's in-place editing for that kind: the editor opens, ⏎ commits, esc discards |

### Add, select, delete

| Id | Gesture | Result |
|---|---|---|
| AD1 | Add | Drafts one record first in the rows and selects it. The rail's search clears so the draft is never hidden. The ring is on the title; the inspector opens on Details with the title's field focused. Status: `Added a person`. One undo step removes the draft |
| AD2 | The new row | Every field starts empty unless `newRow` sets it: the draft invents no defaults of its own. The row takes ST7, each empty editable cell ST8. Its audit and age cells stay empty until the record holds it |
| AD3 | Issues | Each empty field of a new row is an incomplete issue, and each refusal of the app's `ready` (`incomplete` or `invalid`, each `field: message`) stands beside them: Issues shows in the history bar and Apply waits. Issues takes the ring to the first of them, selecting its row and opening it on Details; status `N required fields empty`, or `N issues hold Apply` when the app's refusals are among them |
| AD4 | Apply | Writes every draft: the new record with its key, each change, each removal, as one batch through the patch door. Status `Applied 3 changes to 2 people · deleted 1` |
| AD5 | Delete | The ticked rows leave the grid as one draft, one undo step. A ticked new row is simply dropped. Status `Deleted 2 people · Apply writes it, Undo restores`; Undo restores them (`Restored 2 people`); ticks clear |
| AD6 | Discard | Drops every draft and every tick; status `Discarded N changes` |
| AD7 | Undo · Redo | Status `Undid one change` · `Redid one change` |

### Strip

| Id | Over | Label · text · keys |
|---|---|---|
| SP1 | Nothing | The title · `Click a cell to step it · select a row to open it in the inspector` · `↑ ↓ ← → move` |
| SP2 | A cycle | `Intake · 1` · `A. Morgan · Supervised · was 0 · click → 2 · ⇧-click → 0` · `space next · 0–2 set · ⌫ 0` |
| SP3 | A title | `Person · P-0401` · `A. Morgan · Operator · details in the inspector` · `↑ ↓ ← → move` |
| SP4 | An age | `Days since · 48` · `Days since the last change · stale from 90`, or `Stale · no change for 118 days · threshold 90` |
| SP5 | An audit | `Last updated` · `2026-09-18 09:12 · confirmed · M. Hale`, or `2 pending · applies with the history bar` |
| SP6 | A new row's empty field | The column · `Required · Apply waits for every field of a new person` and `· click sets 0` on a cycle, `· set it in the inspector` otherwise · `⌘Z removes the row` |
| SP7 | Any other kind | The Sheet's strip for that kind |

The strip is the Sheet's: 32 tall, pad 0 16, `--paper-2`, a `--rule` over it. The label is mono `--fs-label-sm` 600 0.14em caps `--brand-d`, the text `--fs-body-sm` `--ink-2` with an ellipsis, the keys mono `--fs-label-md` `--ink-4`.

### Footer

| Id | Part | Spec |
|---|---|---|
| FT1 | Footer | 36, pad 0 20, gap 16, a `--rule` over, `--paper`: `N of M people` mono `--fs-label-md` tnum `--ink-3`, N 600 `--ink`; the stale note `3 stale · no update in 90 days` from the first age column with `stale` |
| FT2 | Legend | At the right: when every cycle column names one register, each member's chip (15 tall, mono `--fs-label-xs` 600, its look) and its `meta` in mono `--fs-label-md` `--ink-3`; in the mark look, its meta alone |

### Inspector

| Id | Part | Spec |
|---|---|---|
| IN1 | Tabs | The Sheet's: Details and Issues with its count; 43 tall, gap 20, mono `--fs-label-md` 600 0.14em caps, the open tab `--ink` over a 2px `--ink` rule, the other `--ink-4`; collapse `fa-angles-right` |
| IN2 | Head | Eyebrow `row N` mono `--fs-label-lg` 600 0.18em caps `--ink-4`; the title in DM Sans `--fs-title-md` 600; a chip `NEW` (`--paper-3`, `--rule-strong`, `--ink-2`) or `N PENDING` (`--brand-tint`, `--brand-d`) |
| IN3 | Row issues | Over the form: `N issues`, then each field's label (mono `--fs-label-sm` caps `--ink-4`) and its message (`--fs-body-sm` `--warn-text`): `Required`, or the app's `ready` message. The field each names is ringed in the form |
| IN4 | Fields | The Sheet's forms: each field through its column's kind, in column order; each column group a section under its label (an unlabelled group's `Other`), mono `--fs-label-sm` 600 0.16em caps `--ink-4`, fields 4 apart |
| IN5 | Cycle, toggle and boolean fields | The compact FieldForm line (new): the label left, `--fs-body-sm` 600 `--ink`, one line, ellipsis, its key in the tooltip; the RadioGroup right on a 32 line, options 12 apart, each a 14 ring (`--rule-strong`, checked `--brand-d`) with a 6 `--brand-d` dot. A drafted field takes FieldForm's dirty tint, `--brand-tint` with a 6 spread; none checked when unset |
| IN6 | Facts | The read-only fields last: the audit's `2026-09-18 09:12 · confirmed · M. Hale` and the age's `48` (`--warn-text` when stale), each a read-only input, 32 tall, `--rule` edge, `--paper-2`, mono `--fs-body` 500 tnum |
| IN7 | Actions | Duplicate (a new draft after the row: `newRow`'s values with the row's over them, and the title empty) and Delete (AD5), the Sheet's |
| IN8 | No row | Three stats, `Shown`, `Pending` and `Stale` (value mono `--fs-body` 500 over a mono `--fs-label-lg` 600 0.18em caps `--ink-4` label), then `Select a row to see its fields here.` |
| IN9 | Issues tab | Every refusal holding Apply, the empty required fields and the app's `ready` refusals together. Each is a row: `row 3 · Intake` mono `--fs-label-sm` caps `--ink-4` (a row outside the rail's narrowing by its key) over its message `--warn-text`; a click selects the row, opens Details and rings the field. Only with no refusal: `No issues` · `Every draft in the batch is ready to apply.`; never while Apply waits |

## 5. Wire

Additive. Older payloads decode unchanged: a Sheet declares none of the new kinds.

```text
RecordPayloadType = {
    sheet:        Sheet.Types.Root,                       // the rows, the columns, the session, the registers, the rail
    title:        Option<String>,
    noun:         Option<Sheet.Types.Noun>,
    columnGroups: Array<Table.Types.ColumnGroup>,         // the Table's own
    bands:        Option<{ column: String }>,             // groupBy
    inspector:    Option<Sheet.Types.InspectorPane>,      // the Sheet's forms
    history:      Option<() => Option<Array<RecordCommitInfo>>>,
    missing:      Option<String>,
    name:         Option<String>,
}
EastUI.component("Record", RecordPayloadType)

Sheet.Types.ColumnKind gains
    title:   { avatar: Boolean }
    person:  { register: String, unassigned: Option<String> }
    boolean: Null
    toggle:  { on: String, off: String, look: Variant{ chip, mark } }
    cycle:   { register: String, scale: Boolean, look: Variant{ chip, mark } }
    age:     { unit: Variant{ hours, days, weeks }, stale: Option<Integer>, absent: Option<String>,
               elapsed: Function([DateTime, DateTime], Integer) }   // (since, now) → whole units
    audit:   { mode: Variant{ date, blame }, absent: Option<String>, by: String, verb: String }   // the rule cells
Sheet.Types.ColumnKind.quantity gains  unit: Option<String>        // a constant unit, beside the driver's uom
Record.Types.Change = { at: DateTime, by: String, verb: String }
```

- **The cells.** A title, person or cycle cell is the `String` arm; a boolean or toggle cell is `Boolean`. An age cell is its `since` as `DateTime`, or `Null`. An audit cell is its Change's `at` as `DateTime`, or `Null`, with `by` and `verb` projected into unrendered rule cells (`$by:updated`, `$verb:updated`), as a date's `actual` is. No new cell arm.
- **The clock.** `elapsed` is compiled by the factory from `unit` (`since.durationMilliseconds(now)` over the unit's milliseconds, rounded down) and called by the renderer with the browser's clock (§2.3). Nothing else on the wire reads a clock.
- **Column groups** are the Table's `TableColumnGroupType`. The inspector's sections read them.
- **No e3 wire changes.** This is a UI task's payload, rebuilt when the package is.

## 6. Reuse

| Part | Where | Used for |
|---|---|---|
| The Sheet's root, bridge, columns, registers, rows from a record or a slice | e3-ui `sheet/` (`createSheetBuild`, `describeColumn`, `recordRows`, `recordSources`) | The payload's `sheet`, every Sheet kind, `Record.register.*`, `Record.patch` |
| The shared editing session, readiness, `Record.onApply` | east-ui `contracts/editing.ts`, e3-ui `bind/record.ts` | Drafts, issues, Apply, Discard, undo and redo |
| `HistoryBar` and its Issues slot | east-ui-components `editing/` | FR7 |
| `BuilderFrame`, the shared toolbar ladder | east-ui-components `layout/builder-frame`, `toolbar/` | FR1–FR6 |
| The slice rail | east-ui-components `slice/`, `useRecordSlicesToolbarItems` | FR4, the footer's N of M, EM1's Clear |
| The Sheet's cell content, editors and parse grammar | e3-ui-components `sheet/cells`, `Editor.tsx`, `parse/` | C11, K6 |
| The Sheet's strip | e3-ui-components `sheet/Strip.tsx` | SP1–SP7 |
| The Sheet's inspector and forms | e3-ui-components `sheet/frame/inspector.tsx`, e3-ui `sheet/fields.ts` | IN1–IN9 |
| `FieldForm`, `RadioGroup` | east-ui-components `forms/field-form`, `forms/radio-group` | IN5 (gains the one-line layout) |
| The Table's column groups, the DS Row card | east-ui `TableColumnGroupType`; `app_design_system/guidelines/cards/parts-row.html` | HD1, GR1–GR2, SL1 |
| The Roster's band | east-ui-components `theme/slot-recipes/schedule-group.ts` | BD1 |
| The avatar, checkbox, Status parts | east-ui-components `avatar`, `checkbox`, `status` recipes | C1–C3, C6 |
| The Sheet's action column | e3-ui `sheet/actions.ts`, e3-ui-components `sheet/actions/` | `Record.column.action` |
| Index-ordered windows | e3-ui `utils/ordered-source.ts` | §2.5 bands over a paged source |

The renderer is a new `record/` in e3-ui-components. Its grid is drawn in the Table's anatomy, and it takes the Sheet's model and editing session. Where the Sheet's grid holds logic inline (the ring's keyboard, a cell's commit, pick and paste), that logic moves into shared hooks that both grids call. Nothing is copied.

## 7. Decisions

Ruled 6 November 2026:

1. **The journal is row fields, display only.** `Record.Types.Change` is a type a solution adds to its record; the Record reads it and never writes it; no signed-in identity and no e3 change.
2. **Time since takes the browser's clock** (§2.3), through an East function the renderer calls with it.
3. **The new kinds are shared, and the Sheet refuses them.** They join the Sheet's column vocabulary (one wire, one bridge, one cell part per kind); the Sheet refuses them at build in this epic, and a later change can admit them to its grid.
4. **Bands over the rail's rows, in this epic.** The rail's `rows` source reads in the record's key order; banding needs it read in the band column's index order, so the rows source gains an order (over the index-ordered windows, `OrderedRowSource`), as its own sub-issue.
5. **The inspector is Details and Issues.** No History tab: e3 keeps history record-wide, and the journal is one field.
6. **A column's field is editable wherever its column is.** `editable: false` makes it read only on every row; there is no "new rows only".
7. **Nothing holds Apply unseen** (#1527). The Record is one of the builders #1527 covers. Every refusal holding Apply, a new row's empty required field or the app's `ready` refusal, is listed and reachable (AD3, IN3, IN9). Every new row the Record makes, by Add or Duplicate, takes `newRow`'s values (AD2, IN7).

Open, for review:

- **O1 · The Table's rows.** The east-ui Table draws its rows 27 / 36 / 42 from the density tokens; the DS Row card and this spec say 36 / 32 / 28. The Record follows the DS. *Proposed:* the Table's drift is filed separately, not fixed here.

## 8. Where this departs from the mock

Each as **mock** · **proposed** · **consequence**.

1. **Apply stamps the audit.** *Mock:* Apply stamps a new record `created · You` and a changed one `changed · You`, and Days since restarts at 0. *Proposed:* the journal is the solution's fields (ruled); the Record writes nothing. *Consequence:* after an Apply, a row's audit and age keep their values until the solution's own process writes them; Pending covers the time a row holds drafts.
2. **Confirm.** *Mock:* the data holds `confirmed` entries, and its script builds a Confirm action that its page never draws. *Proposed:* no Confirm; `verb` is the solution's word. *Consequence:* none drawn.
3. **The inspector's History tab** (1e's figure). *Mock:* the live tables draw Details and Issues; 1e's figure draws Details and History. *Proposed (ruled):* Details and Issues, the live tables' and the Sheet's. *Consequence:* no per-row history; the journal is one field.
4. **Name and Role on a saved row.** *Mock:* the inspector shows Name and Role inputs only on a new row, and the strip calls Role `read only here`. *Proposed (ruled):* a column's field is editable wherever its column is; `editable: false` makes it read only on every row. *Consequence:* Name and Role are editable on saved rows in Examples 2 and 3.
5. **Role's cell.** *Mock:* Role is drawn as plain text. *Proposed:* a `reference` column, drawn as the Sheet draws one, its `▾` when editable. *Consequence:* the menu of roles in the grid.
6. **The tone legend.** *Mock:* each entry reads its label then its name lowercased (`can can work`). *Proposed:* the chip, then the member's `meta` (`Can work`). *Consequence:* the label is not repeated.
7. **boolean is not a Sheet column today.** *Mock:* 1c lists it among the Sheet's kinds. *Proposed:* it joins the shared kinds with the new ones (§7, decision 3).
8. **A quantity's unit.** *Mock:* `38.5 hrs`, "the unit from the driver row". *Proposed:* a Record has no driver; the shared quantity config gains a constant `unit`.
9. **The toolbar's title and status line.** Neither is a Sheet toolbar item today. *Proposed:* both are new items of the Record's toolbar, folding on the shared ladder (the status line first, then the title's count).
10. **Digits.** *Mock:* the script maps digits to states. *Proposed:* a member's label or alias, the register grammar's own (K4). *Consequence:* Example 3 gives its members the aliases `1`, `2` and `3`.
11. **A phone.** The page draws no phone. *Proposed:* the BuilderFrame's phone frame, with the grid paging its columns as the Sheet's `narrow` does, the title column pinned.
12. **Sources.** *Mock:* a static list. *Proposed:* a Record reads an e3 record (`record`, `window`, or the rail's `rows` source); a read-only Record needs no patch mutation.

## 9. Work breakdown

One epic, one branch (off #1481's, PR against `main`), one PR. The sub-issues:

1. **Spec and DX.** `Record Cells.dc.html` and this proposal in `docs/proposals/`.
2. **The shared kinds** (e3-ui `sheet/`). `SheetColumnKindType` gains `title`, `person`, `boolean`, `toggle`, `cycle`, `age` and `audit`, and `quantity` gains `unit`. Builders, `describeColumn`, the projection and rule cells, `elapsed`, `Record.Types.Change`, and the Sheet's refusal (§7, decision 3). Each in its spec and its examples.
3. **`<Record>` authoring** (e3-ui `record/`). The tag merged into the `Record` namespace (`bind`, `onApply`, `column`, `register`, `field`, `patch`, `Types`), the payload and carrier, the props' checks (§2.6), the `columns` mapped type (§2.4), column groups and bands. Examples 1–5 in `test/record/record.examples.tsx` wired into their spec, the e3-ui SKILL's Record section and the plugin index.
4. **The grid** (e3-ui-components `record/`). FR1, GR, HD, SL, BD, EM and ST, the Sheet's grid logic moved into shared hooks, P and K.
5. **The cells.** C1–C11, the age cell's clock (§2.3), the chips' and marks' recipes.
6. **The toolbar and footer.** The title, the status line, Add and Delete (AD1–AD7), the history bar with Issues, FT1–FT2.
7. **The inspector.** IN1–IN9 over the Sheet's inspector, FieldForm's one-line layout (east-ui-components) and sections by column group.
8. **Bands over the rail's rows** (§7, decision 4). The rows source read in an index's order.
9. **#1527, with the Record among its builders** (§7, decision 7). Its sub-issues #1525 (the refusals listed and reachable) and #1526 (a new row's own fields from the app) each name the Record. For the Record that means AD3, IN3 and IN9 over the app's `ready`, and Add and Duplicate over `newRow`.
10. **The showcase and the visual contract.** A Record page with Examples 1–5, and the responsive suite's invariants for GR, HD, SL, BD, ST, C, FT and IN, measured in the page in both themes and at the three densities. Each example is verified on e3-web through Apply and a remount.

**Verification:** `make build`, `make test` and `make lint` across e3-ui, e3-ui-components and east-ui-components; the examples' specs; the renderer's DOM tests (pointer, keyboard, drafts, Add, Delete, Issues, Apply, undo); the responsive suite in both themes; the plugin index regenerated.
