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
    inspector
    onApply={Record.onApply(people, { keyed: true })}
/>
```

Why this shape:

- **It is the Sheet's root in the Table's anatomy.** The rows, the columns' bridge, the drafts, readiness, the strip, the inspector's forms and `Record.onApply` are the Sheet's, unchanged. The Record contributes the grid's anatomy (DS Row card: 36/32/28, pad 0 12, first and last 20, the 46 select column), the column-group row, the new cell kinds and the toolbar's Add and Delete.
- **One namespace.** `Record` already carries `Record.bind` and `Record.onApply`; the tag, `Record.column.*`, `Record.register.*`, `Record.field`, `Record.patch` and `Record.Types` join it, as `Sheet` is its tag and its namespace.
- **A cycle's states are a register.** A register is declared once and named by every column over it, as `enum` and `reference` name theirs. Its members' order is the cycle's order, their labels its chips, their `meta` its names, their `tone` its colours, and a member's label or alias typed in a cell sets it, which is how the digits work.
- **The journal is the row's own fields** (ruled 6 November 2026). `Record.Types.Change` is a type a solution adds to its record, `{ at, by, verb }`. The `audit` column draws it and `age` counts from it. The Record only reads it and never writes it, and it needs no signed-in identity and no e3 change.
- **Time since takes the client's clock.** An age cell is `now − since`, where `since` comes from the row and `now` is the browser's. The factory compiles the elapsed count into an East function `(since, now) → Integer`, and the renderer calls it with the browser's clock. Nothing in the payload is built from a clock.

## 1. What a Record is

An interface and a renderer, as every e3-ui component is (CLAUDE.md, *never build a UI component from East UI components*). The factory computes one payload and returns it through its `EastUI.component("Record", RecordPayloadType)` carrier. The `Record` renderer in `@elaraai/e3-ui-components` builds the frame in the browser with east-ui-components' `BuilderFrame`: one toolbar, the grid in main with the Sheet's strip docked under it, the footer, and the inspector pane. It draws no outer border, so the host frames it.

The payload holds the Sheet's root (`SheetRootType`), built by the very code `<Sheet>` builds it with (`createSheetBuild`, the bridge, `recordRows`, the slice's sources), beside what only a Record has: its title and noun, its column groups (the Table's `TableColumnGroupType`) and its inspector pane (the Sheet's forms).

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
| `registers` | `{ name: Record.register.members(…) }` | The registers the `reference`, `enum`, `set`, `person` and `cycle` columns name. A member is typed by its label, its key or an alias, and kept by its key (§2.8) |
| `title` | `string` | The toolbar's lead: the title, then the count of the record's rows |
| `noun` | `{ singular, plural }` | What a row is called: `18 people`, `Added a person`, `No people match the search`, `Person · new` |
| `inspector` | `true` | The inspector pane: Details (the selected row's every field) and Issues |
| `fields` | `{ field: Record.field.* }` | Hints for the inspector's form, the Sheet's `fields` |
| `newRow` | `East.function([Record.Types.NewRow], Record.Types.Patch(R), …)` | A new row's values, the Sheet's `newRow`: a field it sets starts set, and a field it leaves `none` starts empty (§4, AD2). A required field no person can set comes from it (§2.7) |
| `newKey` | `East.function([SetType(K)], K, …)` | A new record's key (`K`, the record's key type), in the app's own scheme: given the keys taken, it returns one that is not. It is the Sheet's own `newKey`, which replaces its `newRowId`. Without it, a String key is a UUID, as every e3-ui builder mints one, and any other key needs it (§2.7) |
| `edits` | `{ insertRows?, removeRows? }` | Add and Delete, and the select column with them; both on by default, off on a read-only Record |
| `owned` | `(row) => Boolean` | Rows an upstream system owns: read only, as the Sheet's |
| `readOnly` | `boolean` | The whole Record read only: no Add, Delete, select column, hover or editor |
| `density` | `"comfortable" \| "compact" \| "condensed"` | Rows 36, 32 or 28 |
| `ready` | the Sheet's | Author readiness checks: a refusal holds Apply |
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
| reference | `Record.column.reference(R, register, cfg)` | `String`, `Option<String>` | Menu of the register · a member typed by its label, key or alias (§2.8); other text kept as typed |
| set | `Record.column.set(R, register, cfg)` | `Record.Types.Link`, `Array<Member>`, `String` | In place · comma-separated members |
| action | `Record.column.action(R, V, cfg)` | `V`, `Option<V>` | The Sheet's action column (#1474): the next half takes the first case, ▾ the rest |
| boolean | `Record.column.boolean(R, cfg)` | `Boolean` | Click or space · a Checkbox, centred |
| title | `Record.column.title(R, cfg)` | `String` | Not in place · selects the row and opens it in the inspector |
| person | `Record.column.person(R, register, cfg)` | `String`, `Option<String>` | Menu of the register's people, typed by name (§2.8) · neutral initials, never a colour per person |
| toggle | `Record.column.toggle(R, cfg)` | `Boolean` | Click or space flips · its two words |
| cycle | `Record.column.cycle(R, register, cfg)` | `String` | Click → next · ⇧-click → previous · a member's label or alias sets · ⌫ the first state |
| age | `Record.column.age(R, cfg)` | its own key | Read only · days (or `unit`) since `since`: days and weeks to the viewer's own day, turning over at their midnight; hours elapsed, to the browser's clock · warns at `stale` |
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
- **`now`, from the browser.** The factory compiles the count, `(since, now) => Integer`, into the column's kind. Days and weeks are the calendar's: they count from `since`'s date to the viewer's own day, so a count turns over at the viewer's midnight, whatever time of day `since` holds. Hours stay elapsed time: whole hours from `since` to the browser's clock, rounded down. The renderer calls it for each age cell it draws, with the browser's clock read once per render, and its day where the viewer is. It reads the clock again each minute, so a day that turns over moves every age cell, the stale dots, the footer's stale count and the inspector's facts together.

So the payload never holds a clock's reading, and the count is East's (`durationMilliseconds`), never JavaScript date arithmetic.

### 2.4 Column keys

A column is keyed by the field it sits on, the `<Table columns>` idiom, so a typo or a kind on the wrong field type is a type error. `age` is the one exception: it shows no field, so it is keyed by a name of its own that no field has, as the designer's `days_since` is. The `columns` prop is typed as a mapped type over its own keys. A row field's key must hold a column over that field, and any other key must hold an `age` column.

### 2.5 No group rows

A Record draws its rows in the record's order, under no group rows. A viewer narrows to one group through the rail: a field the rail filters by, read through the record's index on it, as Example 2's rail filters by role over `record_skills_by_role`. Its rows page as every narrowing's do (§7, decision 4).

### 2.6 What the compiler and the build catch

- A column on a field it cannot sit on; a non-field key holding anything but `age`; `age` under a field's key.
- At build: a register a column names that `registers` does not declare; `columnGroups` naming a key that is not a column, or a group whose columns are not adjacent, or a column in two groups; `title` given twice; `onApply` beside `record`; `record`, `window` and `slice`'s `rows` together; an action column without the Sheet's machine (as the Sheet checks it).
- At build, with Add on: a record keyed by anything but a String, with no `newKey`; and a required field no person can set in this Record, with no `newRow` (§2.7). Both are the Sheet's own checks, in its words.
- The Sheet refuses the Record's kinds at build in this epic (§7, decision 3).

### 2.7 A new record: its key, and the fields no one can set

A new record needs two things a person may have no way to give: its key, and any required field the Record shows read only or not at all. Both come from the app, and the Record never drafts a row that can't be applied.

**Its key.** `newKey` is an East function from the keys taken to a new one, over the record's key type. It is the Sheet's own option, and the Record passes it on: the Sheet's `newRowId`, which took nothing and returned a key's `.east` text, becomes `newKey`, typed over its rows' key (a record's `K`, else `String`) and given the keys taken. The keys taken are every key the Record holds, as far as it has read them, and every key the batch has drafted, the gesture's own among them. It is called once per new entry, at Add, at Duplicate and at a paste that adds rows; a group's lines keep their own keys within it. Without it, a String-keyed record's new entry is keyed by a UUID, retried until it is free, as the Roster's, the Allocation's, the Plan's, the Flowchart's and the Schematic's are, and the Sheet's `sheet-…` ids become UUIDs too. A page served over plain HTTP has no `crypto.randomUUID`, so there the shared minting (`mintKey`) draws the UUID from `crypto.getRandomValues`, and the Sheet adds rows on such a page as it does today. A record keyed by anything else needs `newKey`, and the build says so, in the Sheet's words: `Record: the rows are keyed by .Integer, and a new row's key is minted only for a String key — pass newKey, an East function from the keys taken to a new one, or edits={{ insertRows: false }}`. A key `newKey` returns that is already taken drafts nothing, and the status line says `The new key 7 is taken`. A key the record holds unread (on a window, or the rail's rows) is refused at Apply by the patch door's compare-and-swap, as a conflict naming the row, and is never written over.

```tsx
// A crew record keyed by number: the lowest free number from the count up.
newKey={East.function([SetType(IntegerType)], IntegerType, ($, taken) => {
    const next = $.let(taken.size().add(1n));
    $.while(taken.has(next), ($) => {
        $.assign(next, next.add(1n));
    });
    return next;
})}
```

**The fields no one can set.** A new row's required field, one that is not an `Option`, must be given before Apply. A person gives it in an editable column, or in the inspector's form, which shows every field a column does not. Some fields neither lets a person set:

- an `audit` on a `Change`, not its `Option`;
- a `stamped` field;
- a column with `editable: false`;
- an action column's field, or a value projection;
- a field with no column that the inspector hides or shows read only, or that has no inspector to show it in.

Such a field can come only from `newRow`:

- With Add on and no `newRow`, the build refuses the first of them, naming it and the remedies: `Record: a new row's "updated" is required, and no column or form sets it — give it in newRow, make it an Option, or edits={{ insertRows: false }}`.
- With a `newRow` that leaves one of them empty, Add drafts nothing, and the status line says `Can't add a person — the app gives no Last updated`. Duplicate takes the source row's own values, so it has them.

The check belongs to the Sheet's root, so `<Sheet>` takes it too, for every entry it adds: a row, or a line under a group, takes such a field from `newRow`, and a group from `newGroup`, which `edits={{ insertGroups: false }}` turns off. It refuses only what already makes a draft no one can apply.

### 2.8 Registers: typed by what they show, kept by their keys

A register's member has a `key`, which is what a cell holds; a `label`, which is what the cell, the editor, the menu and the strip show; `aliases`, its other spellings; and `meta`, the line beside it in the menu. Every column that names one member (`enum`, `reference`, `person` and `cycle`, and the Sheet's `lookup`) is edited in the words its cells show:

- Typed text finds a member by its label, its key or an alias. Text that names one whole is that member.
- A member a gesture chooses is written by its key: the cell's own as the editor opens, a menu option, a strip chip, a taken candidate. It is never looked up again by its label.
- Two members may show one label. Typed, the first in the register's order is meant; a pick tells them apart.
- Text that names no member is an invalid draft on an `enum`, `person` or `cycle` column, and is kept as typed on a `reference` or `lookup` column.

It is one rule, the shared grammar's, for every register kind: the Record adds no path of its own for people. A register whose labels are its keys, as §3's roles are, reads as it always has; one whose labels differ, as Example 4's statuses do (`active` shows `Active`), is typed either way. A person register over a record, keyed by id:

```tsx
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, DictType, East, OptionType, StringType, StructType, none, some } from "@elaraai/east";
import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
import { Data, Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

export const Person = StructType({ name: StringType, role: StringType, aliases: ArrayType(StringType) });
export const recordPeople = e3.record("record_people", DictType(StringType, Person), {
    initial: new Map([
        ["P-1", { name: "A. Morgan", role: "Shift lead", aliases: [] }],
        ["P-7", { name: "J. Smith",  role: "Picker",     aliases: ["Jo"] }],
        ["P-9", { name: "J. Smith",  role: "Driver",     aliases: [] }],
    ]),
});
export const Shift = StructType({ name: StringType, lead: OptionType(StringType) });
export const recordShifts = e3.record("record_shifts", DictType(StringType, Shift), {
    initial: new Map([
        ["S-01", { name: "Mon early", lead: some("P-1") }],
        ["S-02", { name: "Mon late",  lead: some("P-9") }],
        ["S-03", { name: "Tue early", lead: none }],
    ]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

const shifts = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const rows = $.let(Record.bind(recordShifts));
        const people = $.let(Data.bind(recordPeople));
        return (
            <Box height="240px">
                <Record
                    record={rows}
                    title="Shifts"
                    noun={{ singular: "shift", plural: "shifts" }}
                    registers={{
                        people: Record.register.members(people.read(), {
                            kind:    "person",
                            key:     (_p, id) => id,     // what a Lead cell holds: "P-9"
                            label:   p => p.name,        // what the cell, the editor, the menu and the strip show, and a spelling typing finds
                            meta:    p => some(p.role),  // the line beside each name in the menu, which tells the two J. Smiths apart
                            aliases: p => p.aliases,     // other spellings typing finds: "Jo"
                        }),
                    }}
                    columns={{
                        name: Record.column.title(Shift, { header: "Shift", width: "160px" }),
                        lead: Record.column.person(Shift, "people", { header: "Lead", width: "184px", unassigned: "No lead" }),
                    }}
                />
            </Box>
        );
    }}</Reactive>
));
```

In the Lead column:

| The viewer | What happens |
|---|---|
| Looks at Mon late | `JS  J. Smith`: the initials, then the label |
| Presses ⏎ on it | The editor opens on `J. Smith`, holding `P-9`; ⏎ again changes nothing |
| Types `smi` | The menu lists both, each with its meta: `J. Smith · Picker`, `J. Smith · Driver` |
| Steps ↓ to the second, then ⏎ | The cell holds `P-9`, the pick's key |
| Types `j. smith`, then ⏎ | The first in the register's order: `P-7` |
| Types `P-9`, or the alias `Jo` | `P-9`, or `P-7` |
| Types `nobody`, then ⏎ | An invalid draft; a `reference` column would keep `nobody` as typed |

## 3. Worked examples

Each example is complete: the record, its binding, the Record. All six go into `test/record/record.examples.tsx`, wired into its spec per EXAMPLES_AUTHORING, and onto a Record page of the showcase. Examples 2 and 3 are the designer's 1a and 1b, and Example 6 is its looks and densities.

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

Ten cycle columns on the heat ramp under three column groups. The rail searches names and roles and filters by role, the age warns past 90 days, and the audit is in blame mode.

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
        // What the rail searches and filters by.
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
                fields: { name: { label: "Name" }, role: { label: "Role", hints: ["Operator", "Contractor", "Team lead"] } },
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
| The rail | Role · Contractor: C. Patel alone, the footer's `1 of 5 people` | The rail's Role filter, read through `record_skills_by_role`; no group rows (§2.5) |
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
import { Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

export const Operator = StructType({
    name: StringType, badge: StringType, notes: StringType, shifts: IntegerType, hours: FloatType,
    started: OptionType(DateTimeType), status: StringType, role: StringType, certificates: Record.Types.Link,
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
                    // The operators and their badges come from the Gatehouse: this Record edits them, and adds none.
                    edits={{ insertRows: false }}
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

A badge is stamped, so no person can give a new operator one, and the build would refuse Add with no `newRow` to give it (§2.7). The Gatehouse adds the operators, so this Record turns Add off.

### Example 5 — read only

Example 2 with `readOnly` draws the same cells with no hover, the default cursor, no select column and no Add or Delete. The rail still narrows and counts, and the inspector shows every field read only. The example is `recordSkillsReadOnly`: Example 2's body with `readOnly` and no `onApply`.

### Example 6 — the looks

A cell of every kind only a Record draws, each cycle and toggle in both looks side by side, under a density control. It is the page the responsive suite steps through the three densities in both themes (§9).

```tsx
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, DictType, East, NullType, OptionType, StringType, StructType, none, some, variant } from "@elaraai/east";
import { Box, Configurator, Reactive, SegmentGroup, State, StatusValueType, Style, Text, UIComponentType } from "@elaraai/east-ui";
import { Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

export const Rota = StructType({
    name: StringType, supervisor: OptionType(StringType), inducted: BooleanType,
    nights: BooleanType, weekends: BooleanType, forklift: StringType, scanner: StringType, days: StringType, evenings: StringType,
    updated: OptionType(Record.Types.Change),
});
export const recordRota = e3.record("record_rota", DictType(StringType, Rota), {
    initial: new Map([
        ["R-01", { name: "A. Morgan", supervisor: some("S. Park"), inducted: true, nights: false, weekends: true, forklift: "2", scanner: "1",
            days: "prefer", evenings: "can", updated: some({ at: new Date("2026-09-18T09:12:00Z"), by: "M. Hale", verb: "confirmed" }) }],
        ["R-02", { name: "B. Ellis", supervisor: none, inducted: false, nights: true, weekends: false, forklift: "0", scanner: "2",
            days: "can", evenings: "cannot", updated: none }],
        ["R-03", { name: "C. Patel", supervisor: some("J. Ortiz"), inducted: true, nights: true, weekends: true, forklift: "1", scanner: "0",
            days: "cannot", evenings: "prefer", updated: some({ at: new Date("2026-05-13T09:41:00Z"), by: "S. Park", verb: "changed" }) }],
    ]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

const looks = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const rota = $.let(Record.bind(recordRota));
        // The density control: each segment a density, and the Record takes the one chosen.
        const densities = $.const([variant("comfortable", null), variant("compact", null), variant("condensed", null)], ArrayType(Style.Types.Density));
        const densityBind = $.let(State.bind([StringType], "record_looks_density", "comfortable"));
        const densityKey = $.let(densityBind.read());
        const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
        const density = $.let(densities.filter((_$, d) => d.getTag().equal(densityKey)).get(0n));
        const LevelType = StructType({ key: StringType, name: StringType });
        const levels = $.let([
            { key: "0", name: "Not trained" },
            { key: "1", name: "Supervised" },
            { key: "2", name: "Competent" },
        ], ArrayType(LevelType));
        const ChoiceType = StructType({ key: StringType, label: StringType, name: StringType, tone: StatusValueType });
        const choices = $.let([
            { key: "can",    label: "can",    name: "Can work",   tone: variant("neutral", null) },
            { key: "prefer", label: "prefer", name: "Prefers",    tone: variant("success", null) },
            { key: "cannot", label: "can't",  name: "Can't work", tone: variant("danger", null) },
        ], ArrayType(ChoiceType));
        const supervisors = $.let(["S. Park", "M. Hale", "J. Ortiz"], ArrayType(StringType));
        return (
            <Configurator
                controls={[
                    Configurator.Control("Density", densityKey,
                        <SegmentGroup value={densityKey} onChange={onDensity} size="sm"
                            items={densities.map((_$, d) => SegmentGroup.Item(d.getTag(), <Text>{d.getTag().upperCase()}</Text>))} />),
                ]}
                preview={
                    <Box height="360px" width="100%">
                        <Record
                            record={rota}
                            title="Rota"
                            noun={{ singular: "person", plural: "people" }}
                            density={density}
                            registers={{
                                levels:      Record.register.members(levels, { kind: "level", key: l => l.key, label: l => l.key, meta: l => some(l.name) }),
                                choices:     Record.register.members(choices, { kind: "choice", key: c => c.key, label: c => c.label, meta: c => some(c.name), tone: c => some(c.tone) }),
                                supervisors: Record.register.members(supervisors, { kind: "person", key: p => p, label: p => p }),
                            }}
                            columns={{
                                name:       Record.column.title(Rota, { header: "Name", width: "176px", avatar: true }),
                                supervisor: Record.column.person(Rota, "supervisors", { header: "Supervisor", width: "152px" }),
                                inducted:   Record.column.boolean(Rota, { header: "Inducted", width: "80px" }),
                                nights:     Record.column.toggle(Rota, { header: "Nights", width: "80px", on: "yes", off: "no" }),
                                weekends:   Record.column.toggle(Rota, { header: "Weekends", width: "88px", on: "yes", off: "no", look: "mark" }),
                                forklift:   Record.column.cycle(Rota, "levels", { header: "Forklift", width: "72px", scale: true }),
                                scanner:    Record.column.cycle(Rota, "levels", { header: "Scanner", width: "72px", scale: true, look: "mark" }),
                                days:       Record.column.cycle(Rota, "choices", { header: "Days", width: "80px" }),
                                evenings:   Record.column.cycle(Rota, "choices", { header: "Evenings", width: "112px", look: "mark" }),
                                days_since: Record.column.age(Rota, { header: "Days since", width: "136px", since: r => r.updated, stale: 90n, absent: "not confirmed" }),
                                updated:    Record.column.audit(Rota, { header: "Last updated", width: "232px", mode: "blame" }),
                            }}
                            columnGroups={[
                                { label: "Shifts", columnKeys: ["nights", "weekends"] },
                                { label: "Skills", columnKeys: ["forklift", "scanner"] },
                                { label: "Preferences", columnKeys: ["days", "evenings"] },
                            ]}
                            name="looks"
                        />
                    </Box>
                }
            />
        );
    }}</Reactive>
));
```

Each group sets a chip beside its mark:

| Group | Chip | Mark |
|---|---|---|
| Shifts | Nights: `yes` at `--heat-4`, `no` empty (C5) | Weekends: one pip, filled for yes (C6) |
| Skills | Forklift: `0`, `1` and `2` up the heat ramp | Scanner: two pips, filled up to the level |
| Preferences | Days: `prefer` in the success wash, `can` neutral, `can't` in the danger wash | Evenings: the tone's dot, then the label in its text step |

B. Ellis's Supervisor is the dashed ring and `Unassigned`, and their Days since and Last updated read `not confirmed` and `—`. Compact and condensed set each chip 15 tall and each avatar 20 (C1, C4).

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
| HD4 | No sorting | Headers sort nothing; order is the record's |
| SL1 | Select column | 46 wide, pad left 20: a checkbox 14, radius 3, `--rule-strong` edge on `--paper`; ticked `--brand-d` fill and edge, `fa-check` 9 `--paper`. The header's ticks every row shown (`Select all shown`); some ticked draws `fa-minus` `--ink-4`; all ticked, ticked (`Deselect all`) |
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
| AD1 | Add | Drafts one record first in the rows, keyed by `newKey` (else a UUID, §2.7), and selects it. The rail's search clears so the draft is never hidden. The ring is on the title; the inspector opens on Details with the title's field focused. Status: `Added a person`. One undo step removes the draft |
| AD2 | The new row | Every field starts empty unless `newRow` sets it: the draft invents no defaults of its own. The row takes ST7, each empty editable cell ST8. Its audit and age cells stay empty until the record holds it. A required field no person can set comes from `newRow`: when `newRow` leaves one empty, Add drafts nothing and the status line says `Can't add a person — the app gives no Last updated` (§2.7) |
| AD3 | Issues | Each empty field of a new row is an incomplete issue, and each refusal of the app's `ready` (`incomplete` or `invalid`, each `field: message`) stands beside them: Issues shows in the history bar and Apply waits. Issues takes the ring to the first of them, selecting its row and opening it on Details; status `N required fields empty`, or `N issues hold Apply` when the app's refusals are among them |
| AD4 | Apply | Writes every draft: the new record with its key, each change, each removal, as one batch through the patch door. A new record's key the record already holds is a conflict naming the row, never written over. Status `Applied 3 changes to 2 people · deleted 1` |
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
| IN7 | Actions | Duplicate (a new draft after the row, keyed by `newKey` or a UUID: `newRow`'s values with the row's over them, and the title empty) and Delete (AD5), the Sheet's |
| IN8 | No row | Three stats, `Shown`, `Pending` and `Stale` (value mono `--fs-body` 500 over a mono `--fs-label-lg` 600 0.18em caps `--ink-4` label), then `Select a row to see its fields here.` |
| IN9 | Issues tab | Every refusal holding Apply, the empty required fields and the app's `ready` refusals together. Each is a row: `row 3 · Intake` mono `--fs-label-sm` caps `--ink-4` (a row outside the rail's narrowing by its key) over its message `--warn-text`; a click selects the row, opens Details and rings the field. Only with no refusal: `No issues` · `Every draft in the batch is ready to apply.`; never while Apply waits |

## 5. Wire

Package-borne, as every UI payload's change is (WIRE_MIGRATION): the Sheet's column kinds gain cases, its root trades `newRowId` for `newKey`, and its editing gains `unsettable`, so a UI value encoded under either type does not decode under the other. Packages are re-exported and each UI task's output is computed again; a UI task's output is not stored state, so no repository upgrade step ships.

```text
RecordPayloadType = {
    sheet:        Sheet.Types.Root,                       // the rows, the columns, the session, the registers, the rail
    title:        Option<String>,
    noun:         Option<Sheet.Types.Noun>,
    columnGroups: Array<Table.Types.ColumnGroup>,         // the Table's own
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
Sheet.Types.Root trades  newRowId: Option<Function([], String)>   for
    newKey:     Option<Function([Set<String>], String)>   // a new entry's key from the keys taken, over the keys' text
Sheet.Types.Editing gains
    unsettable: { row: Array<{ field: String, label: String }>,     // a new row's (or line's) required fields only the app gives,
                  group: Array<{ field: String, label: String }> }  // and a new group's, each with what the sheet calls it
Record.Types.Change = { at: DateTime, by: String, verb: String }

Every editing session's fields (east-ui's EditingSessionFields: the Sheet's, the Plan's, SnapGrid's, Schedule's) lose
    mode:       Variant{ batch, auto }                    // decision 11: every edit waits for Apply
Plan's settings lose  applyMode: Variant{ batch, auto }
```

- **The cells.** A title, person or cycle cell is the `String` arm; a boolean or toggle cell is `Boolean`. An age cell is its `since` as `DateTime`, or `Null`. An audit cell is its Change's `at` as `DateTime`, or `Null`, with `by` and `verb` projected into unrendered rule cells (`$by:updated`, `$verb:updated`), as a date's `actual` is. No new cell arm.
- **The clock.** `elapsed` is compiled by the factory from `unit` (`since.durationMilliseconds(now)` over the unit's milliseconds, rounded down) and called by the renderer with the browser's clock (§2.3). Nothing else on the wire reads a clock.
- **A new entry's key.** The Sheet's `newKey` crosses as text, as the rows' ids do: a String key is itself, and any other key is its `.east` printing. The Sheet's factory wraps the author's typed function in East, reading each taken key back with `parse` (as `Record.onApply` reads an id) and printing the key it returns; a String key's function crosses as it is. The Sheet's machine mints every new entry through it, with the keys taken, or else through `mintKey`.
- **The fields only the app gives.** `unsettable` names, for a new row or line and for a new group, each required field no editable column and no form of the inspector sets (§2.7), with its label as the inspector's form gives it: the hint's label, else its column's header, else its name spelled out. The build has refused it already when `newRow` or `newGroup` is absent; the shared creation path reads it to draft nothing when the app's values leave one empty, and the status line names the field by its label, with an inspector or without one.
- **No apply mode.** The editing session's `mode` told the shared session to apply each ready gesture at once; with it gone, every builder's batch waits for Apply (§7, decision 11). Every type that carried it changes, so this too is package-borne.
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
| The avatar, checkbox, Status parts | east-ui-components `avatar`, `checkbox`, `status` recipes | C1–C3, C6 |
| The Sheet's action column | e3-ui `sheet/actions.ts`, e3-ui-components `sheet/actions/` | `Record.column.action` |

The renderer is a new `record/` in e3-ui-components: the Sheet's provider over the payload's `sheet`, laid out in `BuilderFrame` with the Record's own toolbar, footer and inspector. The Sheet's machine (the ring and its keys, a cell's commit, pick and paste, the paging, the lens, the session and the inspector's reads) stays in its one hook, and its grid takes its rows, its header and its gutter from the host, so the same grid draws the Record's in the Table's anatomy (§7, decision 8). A gesture that belongs to a kind (a click that steps a cycle, Space on a toggle) is the shared machine's, by the kind, and a member typed by its label is the shared grammar's, for every register kind (§2.8). Nothing is copied.

## 7. Decisions

Ruled 6 November 2026:

1. **The journal is row fields, display only.** `Record.Types.Change` is a type a solution adds to its record; the Record reads it and never writes it; no signed-in identity and no e3 change.
2. **Time since takes the browser's clock** (§2.3), through an East function the renderer calls with it.
3. **The new kinds are shared, and the Sheet refuses them.** They join the Sheet's column vocabulary (one wire, one bridge, one cell part per kind); the Sheet refuses them at build in this epic, and a later change can admit them to its grid.
4. **No group rows** (ruled 6 November 2026). A Record draws no group rows. Grouping a paged record would read each group in its field's index order, and e3 places a search's or a filter's rows only in the record's key order, so a group could not keep them. A viewer filters by the group's field through the rail instead, over the record's index on it, and a filter pages its rows as every narrowing does (§2.5).
5. **The inspector is Details and Issues.** No History tab: e3 keeps history record-wide, and the journal is one field.
6. **A column's field is editable wherever its column is.** `editable: false` makes it read only on every row; there is no "new rows only".
7. **Nothing holds Apply unseen** (#1527). The Record is one of the builders #1527 covers. Every refusal holding Apply, a new row's empty required field or the app's `ready` refusal, is listed and reachable (AD3, IN3, IN9). Every new row the Record makes, by Add or Duplicate, takes `newRow`'s values (AD2, IN7).
8. **The Record's grid is the Sheet's, through its host** (ruled 6 November 2026). The Sheet's machine is one hook whose grid reads its state where it builds it. Rather than lift that state into hooks for a second grid, the host hands the grid the Record's rows, header and gutter, and the kinds' own gestures live in the shared input by kind.
9. **A new record's key is the app's** (ruled 6 November 2026). `newKey` gives it, and it is the Sheet's own option, typed over the rows' key and given the keys taken, in place of its `newRowId`. Without it a String key is a UUID, as every e3-ui builder mints one, the Sheet's included, and any other key needs `newKey` (§2.7).
10. **No draft the Record can't apply** (ruled 6 November 2026). A required field no person can set comes from the app. The build refuses one with no `newRow`, and an Add whose `newRow` leaves it empty drafts nothing. The check belongs to the Sheet's root, so the Sheet takes it too, for every entry: a row or a line from `newRow`, a group from `newGroup` (§2.7). The editing declaration carries each such field with its label, the inspector form's, so the status line names it whether or not the sheet has an inspector (§5).
11. **No apply mode** (ruled 6 November 2026). Every edit waits for Apply, in every builder. The shared session's auto mode, which applied each ready gesture at once, goes. So do the options that chose it: the Sheet's, the Record's and the Plan's `applyMode`, and SnapGrid's and `Plan.Root`'s `editing.mode`. A Save another writer refused is still sent again once its drafts carry over, as it is today.

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
11. **A phone.** The page draws no phone. *Proposed (ruled):* the BuilderFrame's phone frame, with the grid paging its columns as the Sheet's `narrow` does: the title column pinned, and the Sheet's pager's ‹ › stepping through the rest. The select column is dropped, as the Sheet drops its gutter on a phone. *Consequence:* on a phone a row is picked by its title and deleted from the inspector (IN7).
12. **Sources.** *Mock:* a static list. *Proposed:* a Record reads an e3 record (`record`, `window`, or the rail's `rows` source); a read-only Record needs no patch mutation.
13. **A new record's key.** *Mock:* a new person is `NEW-n` while it is a draft, and Apply keys it `P-0607`. *Proposed:* the key is `newKey`'s, given at Add; without it, a UUID (decision 9). *Consequence:* a draft carries its key from Add; the inspector's head still marks it `NEW`.
14. **Row bands.** *Mock:* 1a and 1b band their rows by role, each band folding. *Proposed (ruled):* no group rows; the rail filters by role (§2.5, decision 4). *Consequence:* every role shows in its column, and a viewer narrows to one through the rail's Role filter.

## 9. Work breakdown

One epic, one branch (off #1481's, PR against `main`), one PR. The sub-issues:

1. **Spec and DX.** `Record Cells.dc.html` and this proposal in `docs/proposals/`.
2. **The shared kinds** (e3-ui `sheet/`). `SheetColumnKindType` gains `title`, `person`, `boolean`, `toggle`, `cycle`, `age` and `audit`, and `quantity` gains `unit`. Builders, `describeColumn`, the projection and rule cells, `elapsed`, `Record.Types.Change`, and the Sheet's refusal (§7, decision 3). Each in its spec and its examples.
3. **`<Record>` authoring** (e3-ui `record/`). The tag merged into the `Record` namespace (`bind`, `onApply`, `column`, `register`, `field`, `patch`, `Types`), the payload and carrier, the props' checks (§2.6), the `columns` mapped type (§2.4) and column groups. Examples 1–5 in `test/record/record.examples.tsx` wired into their spec, the e3-ui SKILL's Record section and the plugin index.
4. **The grid** (e3-ui-components `record/`). FR1, GR, HD, SL, EM and ST over the Sheet's grid through its host (§7, decision 8), P and K.
5. **The cells.** C1–C11, the age cell's clock (§2.3), the chips' and marks' recipes, and Example 6 (the looks) with its spec.
6. **The phone** (§8, item 11). The BuilderFrame's phone frame: the title column pinned, the Sheet's pager over the rest, no select column.
7. **The toolbar and footer.** The title, the status line, Add and Delete (AD1–AD7), the history bar with Issues, FT1–FT2.
8. **The inspector.** IN1–IN9 over the Sheet's inspector, FieldForm's one-line layout (east-ui-components) and sections by column group.
9. **#1527, with the Record among its builders** (§7, decision 7). Its sub-issues #1525 (the refusals listed and reachable) and #1526 (a new row's own fields from the app) each name the Record. For the Record that means AD3, IN3 and IN9 over the app's `ready`, and Add and Duplicate over `newRow`. It also covers a new entry's key from the Sheet's `newKey`, in place of its `newRowId`, and the build's refusal of a required field no one can set, for rows, lines and groups, with the runtime check beside it in the shared creation path (§2.7, decisions 9 and 10).
10. **The showcase and the visual contract.** A Record page with Examples 1–6, and the responsive suite's invariants for GR, HD, SL, ST, C, FT and IN, measured in the page in both themes and at the three densities. Each example is verified on e3-web through Apply and a remount.
11. **No apply mode** (§7, decision 11). The shared session's auto mode goes, with every option that chose it, its wire field (§5), and its examples, tests and docs, the older proposals among them. It lands after the cells, before the phone.

**Verification:** `make build`, `make test` and `make lint` across e3-ui, e3-ui-components and east-ui-components; the examples' specs; the renderer's DOM tests (pointer, keyboard, drafts, Add, Delete, Issues, Apply, undo); the responsive suite in both themes; the plugin index regenerated.
