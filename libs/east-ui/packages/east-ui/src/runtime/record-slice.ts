/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Record narrowing, shared by the platform handle and its controls. */
import {
    StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, isFor, none, parseFor, printFor, some, toEastTypeValue, variant,
    type EastType, type StructType, type ValueTypeOf, type option,
} from "@elaraai/east";
import { keyQueryRange, toSeekQuery, type DatasetKeyQuery } from "../collections/value-tree/key-search.js";
import { recordSliceFieldSchema, recordSliceFieldTypes, type RecordSliceFieldSchema } from "../platform/slice/record.js";
import {
    MAX_RECORD_SLICE_RUNS, planRecordSlice, recordChoiceWhere, recordEntriesFields, recordIndexFields, recordIndexGenerated, recordPlanIndex,
    recordScopeEmpty, recordScopeSearchIndex, recordScopedWhere,
    type RecordSlicePlan,
} from "../platform/slice/record-plan.js";
import { recordOnPrinters, recordOnTypeOf, type RecordOnPrinters } from "../platform/slice/record-on.js";
import {
    RecordSliceChoiceType, RecordSliceConfigType, RecordSliceStateType,
    type RecordSliceAreaType, type RecordSliceWhereType, type RecordSliceCountType, type RecordSliceDomainType,
} from "../platform/slice/record-types.js";
import { RecordSliceSource, type RecordSliceEntryKey, type RecordSlicePlacement, type RecordSliceReader } from "./record-slice-source.js";
import type { SeekQueryType } from "../contracts/source.js";

type Config = ValueTypeOf<RecordSliceConfigType>;
type State = ValueTypeOf<RecordSliceStateType>;
type Where = ValueTypeOf<RecordSliceWhereType>;
type Choice = ValueTypeOf<RecordSliceChoiceType>;
type Count = ValueTypeOf<RecordSliceCountType>;
type Area = ValueTypeOf<RecordSliceAreaType>;

/** Only the index key is inspected; record rows and covering values stay opaque. */
export interface RecordSliceEntry {
    /** Tagged key of the index that served the entry. */
    ik: variant<string, unknown>;
    /** Original key, inspected only by editing confirmation; Null for a summary index's entry, which names no row. */
    key?: unknown;
    /** The entry's value: the binding's projection, or a summary index's totals, `{ count, ms }` (#1039). */
    value?: option<unknown>;
    /** Joined row, encoded whole only for editing confirmation. */
    row?: option<unknown>;
}
/** Some rows' maintained entries of an index, as a membership read asks them: each entry, and the row it is one of. */
interface RowEntries {
    readonly entries: readonly RecordSliceEntryKey[];
    /** Each entry's row, by its place among the rows. */
    readonly owners: readonly number[];
}

const stringEqual = equalFor(StringType);
const printString = printFor(StringType);
const sameChoice = equalFor(RecordSliceChoiceType);
/** East's own `Is` over a narrowing state: the same object, or, the two being frozen, equal ones. */
const sameState = isFor(RecordSliceStateType);
const encodeState = encodeBeast2For(RecordSliceStateType);
const frozenState = decodeBeast2For(RecordSliceStateType, { frozen: true });
const encodeConfig = encodeBeast2For(RecordSliceConfigType);
const frozenConfig = decodeBeast2For(RecordSliceConfigType, { frozen: true });

/** A run of rows, as a seek places one: where it starts, and how many it holds. */
type Range = { found: boolean; row: bigint; count: bigint };

/** A primary identity as the record names it: its key's `.east` text, as a search takes it, and the key. */
interface Identity {
    /** The key's `.east` text. */
    readonly text: string;
    /** The key, an East value of the record's key type. */
    readonly key: unknown;
}

/** What a batched membership read made of some rows at one revision ({@link RecordSliceController.containsAll}): each row once, however often the question is asked. */
interface AskedRows {
    /** The revision the rows are the record's at. */
    readonly revision: string;
    /** The index their entries are of. */
    readonly index: string;
    /** The identities the record holds a row of, in the order their entries are asked. */
    readonly present: readonly string[];
    /** The identities the record holds no row of. */
    readonly absent: readonly string[];
    /** The present rows' maintained entries. */
    readonly entries: RowEntries;
}

/** Indexed reads together with the binding's stable identity and default path. */
export interface RecordSliceBinding extends RecordSliceReader<RecordSliceEntry> {
    /** Binding identity. */
    id: string;
    /** Primary record identity, independent of the listed indexes. */
    recordId: string;
    /** Unfiltered source with one entry per primary row. */
    defaultIndex: string;
    /** Exact maintained entry keys for one row, for indexed membership checks. */
    entryKeys(index: string, key: unknown, row: unknown): string[];
    /** Follow a confirmed record state or the current state. */
    refresh(hash: option<string>): null;
}

/**
 * Validates all custom-control input and delegates every record query to the
 * indexed binding. It never evaluates a predicate over a record row.
 *
 * A source's scope is a narrowing its page holds (#1621). The store keeps the
 * viewer's own choices, and the state this controller reads is those choices
 * with the scope laid over them: the narrowing every read of the source
 * carries — its count, its narrowed data's pages and seeks, and whatever a
 * reader takes from `read`. A read given a narrowing of its own reads that
 * narrowing as it is given, so one that is to hold the scope names it. No
 * choice changes a scoped field, and a scope whose list is empty reads no row.
 */
export class RecordSliceController {
    /** Bounded, revision-aware windows shared by counts and data. */
    readonly windows: RecordSliceSource<RecordSliceEntry>;
    private readonly encodeRow: ReturnType<typeof encodeBeast2For>;
    private readonly decodeRow: ReturnType<typeof decodeBeast2For>;
    /** A primary key's `.east` text, as a search names it. */
    private readonly printKey: (key: unknown) => string;
    /**
     * A primary identity's key and its text, its parser built once: a String key's identity is its own text, any
     * other's its `.east` literal.
     */
    private readonly identity: (id: string) => Identity;
    private readonly schemas = new Map<string, RecordSliceFieldSchema>();
    private readonly parse = new Map<string, ReturnType<typeof parseFor>>();
    private readonly print = new Map<string, ReturnType<typeof printFor>>();
    /** Each page of the record's own rows' entries, by the page read — the window the source keeps it in — and the index asked of. */
    private readonly pageEntries = new WeakMap<readonly RecordSliceEntry[], Map<string, RowEntries>>();
    /** What a batched membership read made of its rows, by the identities asked: the same array while the question stands. */
    private readonly askedRows = new WeakMap<readonly string[], AskedRows>();
    /** Each generated index's `on` printer, by its name, from the binding's index key types (#1432): what a reader's planners name its leading values with. */
    readonly printOn: RecordOnPrinters;
    /** The entries fields (#1522): each a Dict field whose picked keys weigh a reader's rows and narrow none. */
    private readonly weighing: ReadonlySet<string>;
    /**
     * Author-derived field metadata and paths, and the page's scope as every read carries it (#1621): each scoped
     * field's values read at its type and printed again, each once. Frozen: the handle hands it to a page's East code,
     * which cannot change it in place.
     */
    readonly config: Config;
    /**
     * The narrowing every read of the source carries, tracked as the store's read is: the viewer's choices, as the
     * store keeps them, with the page's scope laid over them (#1621). Frozen, as the store's state is, since `read`
     * hands it to a page's East code, which cannot change it in place; and the same state while the store's is the
     * same, by East's own `Is`, which compares two frozen states by value.
     */
    readonly readState: () => State;
    /** Whether the page's scope holds no value of one of its fields (#1621): the source then reads no rows. */
    readonly unread: boolean;
    /**
     * The narrowing the rows a page holds of its source are (#1621): its scope alone — none on a page with no scope, the
     * record's own rows. What a reader of those rows by their place — a builder's Search Records and its lines — reads.
     */
    readonly base: Where;
    /** The plan {@link base} is read by, made once it is first read. */
    private basePlanned: RecordSlicePlan | undefined;

    /**
     * @param source - Bound indexed reads.
     * @param config - Author-derived field metadata and paths, and the page's scope.
     * @param row - Record row type recovered from the platform's source type.
     * @param readState - Tracked read of the state the store keeps: the viewer's choices, a frozen East value, which a
     *   source with no scope answers a page's East code as it is.
     * @param writeState - Shared store write, including persistence.
     * @param primaryKey - Original key type; String ids stay raw, other ids are East literals.
     * @param indexes - Type metadata for computed fields, carried by the source.
     * @param indexKeys - Each index's key type, by its name (`IndexedSourceType`'s `IK`): a generated index's `on` (#1432).
     * @throws {Error} When the scope names a field neither the record's rows nor its indexes' keys hold, or holds anything but a list of exact
     *   values, a value its field's type does not read, or other than one value of a field that fans out over a Set
     */
    constructor(readonly source: RecordSliceBinding, config: Config, row: StructType,
        readState: () => State, private readonly writeState: (state: State) => void, private readonly primaryKey: EastType = StringType, indexes?: StructType,
        private readonly indexKeys: Readonly<Record<string, EastType>> = {}) {
        this.printOn = recordOnPrinters(indexKeys);
        this.weighing = recordEntriesFields(config.indexes);
        this.encodeRow = encodeBeast2For(row);
        this.decodeRow = decodeBeast2For(row);
        this.printKey = printFor(primaryKey);
        const parseKey = parseFor(primaryKey);
        this.identity = (id) => {
            const text = primaryKey.type === "String" ? printString(id) : id;
            const key = parseKey(text);
            if (!key.success) throw new Error("Invalid record identity");
            return { text, key: key.value };
        };
        this.windows = new RecordSliceSource(source);
        const fieldTypes = recordSliceFieldTypes(row, indexes);
        for (const field of config.fields) {
            const type = fieldTypes[field.fieldId];
            if (type === undefined) throw new Error(`Unknown field '${field.label}'`);
            const schema = recordSliceFieldSchema(type, field.fieldId);
            this.schemas.set(field.fieldId, schema);
            this.parse.set(field.fieldId, parseFor(schema.key));
            this.print.set(field.fieldId, printFor(schema.key));
        }
        // The page's scope: its values are the page's to give when it runs, so each is read here at its field's type.
        const scope = new Map<string, Choice>();
        for (const [field, clause] of config.scope) {
            const type = fieldTypes[field];
            if (type === undefined) throw new Error(`The page's scope names '${field}', which is no field of the record's rows or of its indexes' keys`);
            if (clause.type !== "values") throw new Error(`The page's scope of '${field}' is a list of exact values, and holds a ${clause.type}`);
            const schema = recordSliceFieldSchema(type, field);
            const parse = parseFor(schema.key);
            const print = printFor(schema.key);
            const values = [...new Set(clause.value.map((text) => {
                const read = parse(text);
                if (!read.success) throw new Error(`The page's scope of '${field}' holds a value its type does not read: ${read.error}`);
                return print(read.value);
            }))];
            if (schema.set && values.length !== 1) {
                throw new Error(`The page's scope of '${field}' holds ${values.length} values, and a field that fans out over a Set is read by exactly one`);
            }
            // A search through an index the scope leads prints the scoped fields of its key as it does any other's.
            this.parse.set(field, parse);
            this.print.set(field, print);
            scope.set(field, variant("values", values));
        }
        this.config = frozenConfig(encodeConfig(scope.size === 0 ? config : { ...config, scope }));
        this.unread = [...scope.values()].some(clause => clause.type === "values" && clause.value.length === 0);
        this.base = recordScopedWhere(scope, new Map());
        if (scope.size === 0) {
            this.readState = readState;
        } else {
            let kept: State | undefined;
            let carried: State | undefined;
            this.readState = () => {
                const state = readState();
                if (kept === undefined || carried === undefined || !sameState(state, kept)) {
                    kept = state;
                    carried = frozenState(encodeState({ ...state, where: recordScopedWhere(scope, state.where) }));
                }
                return carried;
            };
        }
    }

    /** A field the rail offers, as a choice of it is read. A scoped field is none: the page holds it (#1621). */
    private schema(field: string): RecordSliceFieldSchema {
        if (this.config.scope.has(field)) throw new Error(`'${field}' is held by the page's scope, which no choice changes`);
        const schema = this.schemas.get(field);
        if (schema === undefined) throw new Error(`Unknown field '${field}'`);
        return schema;
    }

    private readValue(field: string, text: string): unknown {
        this.schema(field);
        const result = this.parse.get(field)!(text);
        if (!result.success) throw new Error(`Invalid value for ${this.config.fields.find(f => f.fieldId === field)!.label}: ${result.error}`);
        return result.value;
    }

    private validate(field: string, choice: Choice): Choice {
        const schema = this.schema(field);
        const print = this.print.get(field)!;
        if (choice.type === "values") {
            const values = [...new Set(choice.value.map(text => print(this.readValue(field, text))))];
            // An entries field takes several keys, which weigh the rows (#1522); a Set field one, which narrows them.
            const one = schema.set && !this.weighing.has(field);
            if (values.length === 0 || (one && values.length !== 1)) throw new Error(one ? "Choose one value" : "Choose at least one value");
            return variant("values", values);
        }
        if (choice.type === "prefix") {
            if (schema.kind !== "string" || schema.set) throw new Error("Choose an exact value for this field");
            return choice;
        }
        if (schema.set || !["datetime", "integer", "float"].includes(schema.kind)) throw new Error("This field does not support a range");
        const from = this.readValue(field, choice.value.from);
        const to = this.readValue(field, choice.value.to);
        if (schema.optional && ((from as option<unknown>).type === "none" || (to as option<unknown>).type === "none")) throw new Error("Choose two range endpoints");
        if (compareFor(schema.key)(from, to) >= 0) throw new Error("The range end must be after its start");
        return variant("range", { from: print(from), to: print(to) });
    }

    /**
     * Validate the whole state before a custom control or saved view writes it. The store keeps the viewer's choices
     * (#1621): a scoped field's clause is the page's, so a state that holds the scope's own — one made from what
     * `readState` answers — is kept without it, and one that holds another clause for it is refused. The choices are
     * planned with the scope, as every read of them will be.
     * @param state - The state: its choices, with or without the scope's clauses.
     * @returns Null.
     * @throws {Error} When a choice is invalid, a scoped field holds another clause than the scope's, no index answers
     *   the choices and the scope together, or the preset is unknown
     */
    write(state: State): null {
        const where = new Map<string, Choice>();
        for (const [field, choice] of state.where) {
            const held = this.config.scope.get(field);
            if (held === undefined) where.set(field, this.validate(field, choice));
            else if (!sameChoice(held, choice)) throw new Error(`'${field}' is held by the page's scope, which no choice changes`);
        }
        this.plan(recordScopedWhere(this.config.scope, where));
        if (state.preset.type === "some" && !this.config.presets.some(preset => preset.id === state.preset.value)) throw new Error("Unknown preset");
        this.writeState({ ...state, where });
        return null;
    }

    /**
     * Compile a supported narrowing, refusing an incompatible saved/custom state. The narrowing is planned as it is
     * given: the one `readState` answers holds the page's scope, and one a reader makes holds it where the reader put
     * it there. A narrowing whose scoped field holds no value holds no row (#1621), and its plan searches nothing.
     * @param where - The narrowing.
     * @param area - A read by area's clause, beside it (#1432).
     * @returns The plan.
     */
    plan(where: Where, area?: Area): RecordSlicePlan {
        if (recordScopeEmpty(this.config.scope, where)) return { index: this.source.defaultIndex, queries: [], empty: true };
        const plan = planRecordSlice(this.config.indexes, where, this.source.defaultIndex, area, this.printOn);
        if (plan === null) throw new Error("These choices cannot be combined; clear a field and try again");
        return plan;
    }

    /** The next valid state for one choice, the page's scope with it; shared with prospective counts. */
    proposed(field: string, choice: Choice | undefined): Where {
        this.schema(field);
        const next = recordChoiceWhere(this.config, this.readState().where, field,
            choice === undefined ? undefined : this.validate(field, choice));
        if (next === null) throw new Error("Choose the preceding fields before this field");
        this.plan(next);
        return next;
    }

    /** Apply one choice, clearing incompatible trailing clauses together. */
    choose(field: string, choice: Choice | undefined): null {
        return this.write({ ...this.readState(), where: this.proposed(field, choice), preset: none });
    }

    /** Clear the viewer's choices while preserving presentation resolution; the page's scope stays (#1621). */
    clearAll(): null { return this.write({ ...this.readState(), where: new Map(), preset: none }); }

    /** Set or clear a named narrowing; the page's scope stays beside either (#1621). */
    togglePreset(id: string): null {
        const state = this.readState();
        if (state.preset.type === "some" && state.preset.value === id) return this.clearAll();
        const preset = this.config.presets.find(value => value.id === id);
        if (preset === undefined) throw new Error("Unknown preset");
        return this.write({ ...state, where: preset.where, preset: some(id) });
    }

    /**
     * Exact count, never a partial sum while another query is pending.
     * @param where - The narrowing; the Slice's own when absent.
     * @param area - A read by area's clause, beside it (#1432).
     * @returns The count, none while pending.
     */
    count(where: Where = this.readState().where, area?: Area): option<bigint> {
        const result = this.windows.resolve(this.plan(where, area));
        return result.type === "some" ? some(result.value.total) : none;
    }

    /**
     * The rows the source holds, what a narrowed count is out of: the record's primary rows, or on a scoped source the
     * rows its page's scope holds (#1621), since every read of the source carries the scope. A viewer of a scoped page
     * is told no count of the rows beyond it.
     * @returns The count, none while pending.
     */
    total(): option<bigint> {
        return this.config.scope.size === 0 ? this.source.total("primary") : this.count(this.config.scope);
    }

    /**
     * Measure a numeric/date field using only boundary index entries. Leading
     * choices remain applied; this field's own range is ignored. Unset entries
     * are skipped with one exact search, never by walking their rows.
     */
    domain(field: string): option<ValueTypeOf<RecordSliceDomainType>> {
        const schema = this.schema(field);
        if (schema.set || !["datetime", "integer", "float"].includes(schema.kind)) throw new Error("This field has no range");
        // A scope that holds no value holds no row, and so no extent.
        if (this.unread) return none;
        const proposal = recordChoiceWhere(this.config, this.readState().where, field,
            variant("range", { from: "", to: "" }));
        if (proposal === null) return none;
        const index = recordPlanIndex(this.config.indexes, proposal);
        if (index === undefined) return none;
        const path = recordIndexFields(index);
        const position = path.indexOf(field);
        const leading = new Map([...proposal].filter(([name]) => path.indexOf(name) < position));
        const plan = planRecordSlice([index], leading, index.name, undefined, this.printOn)!;
        const bounds = this.windows.resolve(plan);
        if (bounds.type === "none") return none;
        const compare = compareFor(schema.key);
        const print = this.print.get(field)!;
        let min: unknown;
        let max: unknown;
        let pending = false;
        // A generated key nests its leading fields under `on`, an interval's start its `at` (#1432).
        const generated = recordIndexGenerated(index);
        const byStart = index.interval.type === "some" && field === index.interval.value.from;
        const keyOf = (entry: RecordSliceEntry): unknown => {
            if (entry.ik.type !== index.name) throw new Error("The source returned a different ordering");
            if (!index.structured) return entry.ik.value;
            const key = entry.ik.value as Record<string, unknown>;
            return !generated ? key[field] : byStart ? key.at : (key.on as Record<string, unknown>)[field];
        };
        for (const run of bounds.value.runs) {
            if (run.count === 0n) continue;
            let start = run.row;
            let first = this.source.page(index.name, start, 1n);
            const last = this.source.page(index.name, run.row + run.count - 1n, 1n);
            if (first.type === "none" || last.type === "none") { pending = true; continue; }
            let entry = first.value[0];
            const end = last.value[0];
            if (entry === undefined || end === undefined) throw new Error("The results changed while reading the range; retry");
            if (schema.optional && (keyOf(entry) as option<unknown>).type === "none") {
                const key = entry.ik.value as Record<string, unknown>;
                // An interval's unset starts sit at its tree's root with no instant: `[on, 0, none]` (#1432).
                const fields = !index.structured ? []
                    : byStart ? [printFor(recordOnTypeOf(this.indexKeys[index.name])!)(key.on as never), "0", print(none)]
                        : index.fields.slice(0, position + 1).map(name => this.print.get(name)!(key[name]));
                const query: ValueTypeOf<SeekQueryType> = !index.structured ? variant("key", print(none))
                    : variant("fields", { values: fields, prefix: none });
                const unset = this.source.seek(index.name, query);
                if (unset.type === "none") { pending = true; continue; }
                start = unset.value.row + unset.value.count;
                if (start >= run.row + run.count) continue;
                if (start <= run.row) throw new Error("Range search did not advance; retry");
                first = this.source.page(index.name, start, 1n);
                if (first.type === "none") { pending = true; continue; }
                entry = first.value[0];
                if (entry === undefined) throw new Error("The results changed while reading the range; retry");
            }
            const low = keyOf(entry);
            const high = keyOf(end);
            if (min === undefined || compare(low, min) < 0) min = low;
            if (max === undefined || compare(high, max) > 0) max = high;
        }
        const revision = this.source.revision();
        if (pending || min === undefined || revision.type === "none" || revision.value !== bounds.value.revision) return none;
        return some({ from: print(min), to: print(max) });
    }

    /** Confirm a saved entry without confusing a filtered-out row with a deletion. */
    readEntry(id: string): option<option<Uint8Array>> {
        const { text, key } = this.identity(id);
        return this.entryAt(text, key);
    }

    /**
     * Confirm several saved entries in one read (#1596), each as
     * {@link RecordSliceController.readEntry} answers it — its row as the read
     * decoded it, never encoded again — without confusing a filtered-out row
     * with a deletion.
     *
     * @param ids - The entries' primary identities
     * @returns Each entry's row, a value of the record's row type, `none` for one the record does not hold, by identity;
     *   none while the read is pending; `undefined` for a binding that does not batch its reads, whose entries are read
     *   one at a time
     */
    readEntries(ids: readonly string[]): option<ReadonlyMap<string, option<unknown>>> | undefined {
        if (this.source.rowsAll === undefined) return undefined;
        const read = this.rows(ids.map(id => this.identity(id).key));
        if (read.type === "none") return none;
        return some(new Map(ids.map((id, i) => [id, read.value[i]!] as const)));
    }

    /**
     * One entry of the record by its key, read at one revision: its key sought,
     * then a one-row page at its row.
     *
     * @param text - The key's `.east` text, as a search names it
     * @param key - The key, an East value of the record's key type
     * @returns Its row as bytes, `none` for a key the record does not hold; none while either read is pending
     * @throws {Error} When the row found is another key's: the record changed between the two reads
     */
    private entryAt(text: string, key: unknown): option<option<Uint8Array>> {
        const revision = this.source.revision();
        if (revision.type === "none") return none;
        const found = this.source.seek("primary", variant("key", text));
        if (found.type === "none") return none;
        let result: option<Uint8Array> = none;
        if (found.value.found) {
            const page = this.source.page("primary", found.value.row, 1n);
            if (page.type === "none") return none;
            const entry = page.value[0];
            if (entry === undefined || entry.row?.type !== "some" || compareFor(this.primaryKey)(entry.key, key) !== 0) {
                throw new Error("The record changed while confirming the edit; retry");
            }
            result = some(this.encodeRow(entry.row.value));
        }
        const current = this.source.revision();
        return current.type === "some" && current.value === revision.value ? some(result) : none;
    }

    /**
     * The rows the record holds under several of its own keys, at its current
     * revision (#1039): in one request when the binding batches its reads, else
     * each read by its key, all started together — what a reader asks of rows
     * it names by key and has not read, as the Plan does of the events a link
     * names and those drafted outside the cells it draws.
     *
     * @param keys - The keys, East values of the record's key type
     * @returns Each key's row, `none` for a key the record does not hold, in order; none while any read is pending
     */
    rows(keys: readonly unknown[]): option<option<unknown>[]> {
        const revision = this.source.revision();
        if (revision.type === "none") return none;
        if (keys.length === 0) return some([]);
        let read: option<option<unknown>[]>;
        if (this.source.rowsAll !== undefined) {
            read = this.source.rowsAll(keys);
        } else {
            const rows: option<unknown>[] = [];
            let pending = false;
            for (const key of keys) {
                const entry = this.entryAt(this.printKey(key), key);
                if (entry.type === "none") pending = true;
                else rows.push(entry.value.type === "some" ? some(this.decodeRow(entry.value.value)) : none);
            }
            read = pending ? none : some(rows);
        }
        if (read.type === "some" && read.value.length !== keys.length) throw new Error("The record answered a different number of rows than it was asked");
        const current = this.source.revision();
        return read.type === "some" && current.type === "some" && current.value === revision.value ? read : none;
    }

    /**
     * Exact membership of one primary identity, independent of loaded pages.
     * Reads that row once, then seeks its maintained keys against the selected
     * server bounds. Interval fan-out and Set indexes keep primary identity;
     * no predicate is evaluated over the row or a fetched run.
     */
    contains(where: Where, id: string): option<boolean> {
        return this.membership(where, id, () => this.readEntry(id));
    }

    /**
     * Exact membership of an entry whose row the caller holds at the record's
     * current revision — a Save's: the row its request began from, or the one
     * its confirmation read back — its maintained keys sought against the
     * selected server bounds, as {@link RecordSliceController.contains} seeks
     * them, without reading the row again.
     *
     * @param where - The narrowing
     * @param id - The entry's primary identity
     * @param row - Its row as the record holds it now: beast2 of the record's row type
     * @returns Whether the narrowing holds it; none while its bounds or a seek are pending
     */
    containsRow(where: Where, id: string, row: Uint8Array): option<boolean> {
        return this.membership(where, id, () => some(some(row)));
    }

    /**
     * Exact membership of several entries in one read (#1596): the rows the
     * caller does not hold read by their keys in one request, and every row's
     * maintained keys asked of the narrowing's runs in one more, as
     * {@link RecordSliceController.within} asks them — what a Save's view check
     * asks of every entry it wrote, however many, and however many different
     * index keys they have. An entry the record does not hold is outside it.
     *
     * @param where - The narrowing
     * @param ids - The entries' primary identities: the same array while the question stands, so each row is read and its entries made once
     * @param held - The rows the caller holds at the record's current revision, each beast2 of the record's row type, by identity
     * @returns Whether the narrowing holds each, by identity; none while a read is pending; `undefined` for a binding that
     *   does not batch its reads, whose entries are asked one at a time ({@link RecordSliceController.containsRow})
     */
    containsAll(where: Where, ids: readonly string[], held: ReadonlyMap<string, Uint8Array> | undefined): option<ReadonlyMap<string, boolean>> | undefined {
        if (this.source.withinAll === undefined || this.source.rowsAll === undefined) return undefined;
        if (ids.length === 0) return some(new Map());
        const plan = this.plan(where);
        // A narrowing that holds no row holds none of these.
        if (plan.empty === true) return some(new Map(ids.map(id => [id, false] as const)));
        // The runs and the rows are asked in the one pass, never one after the other.
        const runs = this.windows.resolve(plan);
        const asked = this.rowsAsked(plan.index, ids, held);
        if (runs.type === "none" || asked.type === "none") return none;
        if (!stringEqual(asked.value.revision, runs.value.revision)) return none;
        const answers = new Map<string, boolean>(asked.value.absent.map(id => [id, false] as const));
        if (plan.index === "primary" || plan.queries.length === 0) {
            for (const id of asked.value.present) answers.set(id, true);
            return some(answers);
        }
        const inside = this.held(plan, asked.value.entries, asked.value.present.length);
        if (inside.type === "none") return none;
        asked.value.present.forEach((id, i) => answers.set(id, inside.value[i]!));
        return some(answers);
    }

    /** Some entries' rows and maintained entries of an index, at the record's current revision: made once, by the identities asked. */
    private rowsAsked(index: string, ids: readonly string[], held: ReadonlyMap<string, Uint8Array> | undefined): option<AskedRows> {
        const revision = this.source.revision();
        if (revision.type === "none") return none;
        const known = this.askedRows.get(ids);
        if (known !== undefined && stringEqual(known.revision, revision.value) && stringEqual(known.index, index)) return some(known);
        const unheld = ids.filter(id => held?.has(id) !== true);
        const read = this.rows(unheld.map(id => this.identity(id).key));
        if (read.type === "none") return none;
        const stored = new Map(unheld.map((id, i) => [id, read.value[i]!] as const));
        const present: string[] = [];
        const absent: string[] = [];
        const rows: { key: unknown; row: unknown }[] = [];
        for (const id of ids) {
            const bytes = held?.get(id);
            const row = bytes !== undefined ? some(this.decodeRow(bytes)) : stored.get(id)!;
            if (row.type === "none") { absent.push(id); continue; }
            present.push(id);
            rows.push({ key: this.identity(id).key, row: row.value });
        }
        const made: AskedRows = { revision: revision.value, index, present, absent, entries: index === "primary" ? { entries: [], owners: [] } : this.entriesOf(index, rows) };
        this.askedRows.set(ids, made);
        return some(made);
    }

    /** An entry's membership, its row read or held: the row read once, its maintained keys sought. */
    private membership(where: Where, id: string, readRow: () => option<option<Uint8Array>>): option<boolean> {
        const plan = this.plan(where);
        // A narrowing that holds no row holds no entry, whatever the record holds.
        if (plan.empty === true) return some(false);
        const runs = this.windows.resolve(plan);
        const row = readRow();
        if (runs.type === "none" || row.type === "none") return none;
        const current = this.source.revision();
        if (current.type === "none" || current.value !== runs.value.revision) return none;
        if (row.value.type === "none") return some(false);
        if (plan.index === "primary") return some(true);
        const keys = this.source.entryKeys(plan.index, this.identity(id).key, this.decodeRow(row.value.value));
        let pending = false;
        let included = false;
        for (const key of keys) {
            const found = this.windows.seek(plan, variant("key", key));
            if (found.type === "none") pending = true;
            else included ||= found.value.found;
        }
        const revision = this.source.revision();
        if (revision.type === "none" || revision.value !== runs.value.revision || (pending && !included)) return none;
        return some(included);
    }

    /**
     * Where a narrowing's rows sit in the record (#1349): how many of them each
     * record segment holds, read from the index alone, as far as they are
     * placed. With no narrowing every row is the record's own, and there is
     * nothing to place. A narrowing that holds no row (#1621) places none.
     *
     * @param where - The narrowing; the one the Slice holds when absent
     * @returns The placement so far, or none while the narrowing's bounds or its first window are pending
     * @throws {Error} With no narrowing, or when the binding reads no placements
     */
    place(where: Where = this.readState().where): option<RecordSlicePlacement> {
        const plan = this.plan(where);
        if (plan.queries.length === 0 && plan.empty !== true) throw new Error("A placement places a narrowing's rows, and nothing narrows this record");
        return this.windows.place(plan);
    }

    /**
     * Which of some rows a narrowing holds (#1349), each row's maintained entry
     * keys asked of the narrowing's runs in one read: the server decides by the
     * runs, and no predicate runs over a row here. A row is held when any of its
     * entries is, as {@link RecordSliceController.contains} decides it one row at a time.
     *
     * @param where - The narrowing
     * @param rows - The rows asked of, each its primary key and its row as the record holds them at its current revision
     * @returns Whether the narrowing holds each row, in order; none while its bounds or the read are pending
     * @throws {Error} When the binding reads no memberships
     */
    within(where: Where, rows: readonly { key: unknown; row: unknown }[]): option<boolean[]> {
        const plan = this.plan(where);
        // A narrowing that holds no row holds none of these; no narrowing holds every row.
        if (plan.empty === true) return some(rows.map(() => false));
        if (plan.queries.length === 0) return some(rows.map(() => true));
        return this.held(plan, this.entriesOf(plan.index, rows), rows.length);
    }

    /**
     * Where a row stands among a narrowing's rows, in their order (#1513): its
     * maintained keys sought in the narrowing, the first that holds it; where
     * several rows share that key — every row of a status, under a status's
     * narrowing — the run's rows, which an index keeps in their primary keys'
     * order, read a row at a time by halves. What a reader that pages the
     * narrowing's rows goes to a row by, where a row's place in the record says
     * nothing of its place there.
     *
     * @param where - The narrowing
     * @param key - The row's primary key, an East value of the record's key type
     * @param row - The row, as the record holds it at its current revision
     * @returns Its place, `null` where the narrowing does not hold it; none while a read is pending
     * @throws {Error} When the rows read run out inside the run: the record changed between the reads
     */
    position(where: Where, key: unknown, row: unknown): option<bigint | null> {
        const plan = this.plan(where);
        // A narrowing that holds no row holds this one nowhere.
        if (plan.empty === true) return some(null);
        const keys = plan.index === "primary" ? [this.printKey(key)] : this.source.entryKeys(plan.index, key, row);
        let run: { row: bigint; count: bigint } | undefined;
        let pending = false;
        for (const ik of keys) {
            const found = this.windows.seek(plan, variant("key", ik));
            if (found.type === "none") pending = true;
            else if (found.value.found && (run === undefined || found.value.row < run.row)) run = found.value;
        }
        if (pending) return none;
        if (run === undefined) return some(null);
        const compare = compareFor(this.primaryKey);
        let low = run.row;
        let high = run.row + run.count - 1n;
        while (low < high) {
            const middle = (low + high) / 2n;
            const page = this.windows.page(plan, middle, 1n);
            if (page.type === "none") return none;
            const entry = page.value[0];
            if (entry === undefined) throw new Error("The results changed while finding the row; retry");
            const order = compare(entry.key, key);
            if (order === 0) return some(middle);
            if (order < 0) low = middle + 1n;
            else high = middle;
        }
        return some(low);
    }

    /**
     * The index a scoped source's rows are read in their keys' order through (#1621): the one on exactly the scope's
     * fields ({@link recordScopeSearchIndex}), which the record Slice's bind requires of a scoped source.
     * @returns The index; `undefined` on a page with no scope
     * @throws {Error} When the source lists none, naming the one to declare
     */
    private scopeIndex(): Config["indexes"][number] | undefined {
        const scoped = [...this.config.scope.keys()];
        if (scoped.length === 0) return undefined;
        const index = recordScopeSearchIndex(this.config.indexes, scoped);
        if (index === undefined) {
            throw new Error(`Search Records finds a row among the page's scope by its key, through an index on exactly the scope's fields — ` +
                `by_${scoped.join("_")}: index.on([${scoped.map(name => JSON.stringify(name)).join(", ")}]) among the record's indexes, listed in Data.bindPaged's indexes`);
        }
        return index;
    }

    /**
     * The plan the rows a page holds of its source are read by (#1621): with no scope, the record's own, in its order;
     * on a scoped page, the scope's, through the index on exactly its fields, so they run in their keys' order under
     * each of the scope's values — the order its Search Records seeks them in.
     */
    private basePlan(): RecordSlicePlan {
        if (this.basePlanned !== undefined) return this.basePlanned;
        const index = this.scopeIndex();
        const plan = index === undefined ? this.plan(new Map())
            : this.unread ? { index: index.name, queries: [], empty: true as const }
                : planRecordSlice([index], this.base, this.source.defaultIndex, undefined, this.printOn)!;
        this.basePlanned = plan;
        return plan;
    }

    /**
     * A window of the rows a page holds of its source, in their order (#1621): the record's own, with no scope; the
     * scope's, in their keys' order under each of its values. What a builder's Search Records lists its matches from,
     * by the places {@link keySearch} gives them.
     * @param offset - The window's first row, among the page's rows
     * @param limit - How many rows it holds at most
     * @returns The window's entries, in order; none while pending
     */
    basePage(offset: bigint, limit: bigint): option<RecordSliceEntry[]> {
        return this.windows.page(this.basePlan(), offset, limit);
    }

    /**
     * Which of the rows a page holds of its source `[offset, offset + limit)`, in their order, a narrowing holds
     * (#1621): {@link withinAt} over those rows — the scope's, on a scoped page — rather than the record's own.
     * @param where - The narrowing
     * @param offset - The first row, among the page's rows
     * @param limit - How many rows
     * @returns Whether the narrowing holds each row read, in order; none while the rows or the read are pending
     * @throws {Error} When the binding reads the rows without joining them, or reads no memberships
     */
    baseWithinAt(where: Where, offset: bigint, limit: bigint): option<boolean[]> {
        return this.withinOver(this.basePlan(), where, offset, limit);
    }

    /**
     * Where a key query over the record's primary key lands among the rows a page holds of its source (#1621): what
     * each builder's Search Records seeks. With no scope, in the record's own order: one block, as a seek with no
     * narrowing places it. On a scoped page, among the scope's rows ({@link basePage}): through the index on exactly
     * the scope's fields, the query restated as one range of the primary key's leaves ({@link keyQueryRange}) after
     * the literals of each of the scope's values — one block a value that holds a match, each placed after the rows
     * of the values before it. A scope's field is one a narrowing chooses (a primitive, a variant of unit cases, or
     * an Option of one, held whole or in a Set), so each of its values is one leaf of the index's key.
     * @param query - The key query, as a Search Records box makes it: over the record's primary key
     * @returns Each block of matches, in the page's rows' order; none while a read is pending
     * @throws {Error} When the source lists no index on exactly its scope's fields, or the query's leading parts are
     *   exact and East writes no value after the last of them, naming the part ({@link keyQueryRange})
     */
    keySearch(query: DatasetKeyQuery): option<Range[]> {
        const index = this.scopeIndex();
        if (index === undefined) {
            const found = this.windows.seek(this.plan(new Map()), toSeekQuery(query));
            return found.type === "none" ? none : some(found.value.found ? [found.value] : []);
        }
        const base = this.basePlan();
        if (base.empty === true) return some([]);
        const runs = this.windows.resolve(base);
        if (runs.type === "none") return none;
        const range = keyQueryRange(toEastTypeValue(this.primaryKey), query);
        if (range === null) return some([]);
        const blocks: Range[] = [];
        let pending = false;
        for (const values of this.scopeValues(index)) {
            // The value's own run, read alone: a range open at its end is held to it.
            const plan = planRecordSlice([index], new Map(index.fields.map((field, i) => [field, variant("values", [values[i]!])] as const)),
                this.source.defaultIndex, undefined, this.printOn)!;
            const own = this.windows.resolve(plan);
            if (own.type === "none") { pending = true; continue; }
            const run = own.value.runs[0];
            if (run === undefined) continue;
            const found = this.windows.seek(plan, variant("range", { from: [...values, ...range.from], to: range.to === undefined ? [] : [...values, ...range.to] }));
            if (found.type === "none") { pending = true; continue; }
            let at = found.value;
            if (range.exact !== undefined && at.count > 0n) {
                // A key with no value after it to write: the first row at or past it is it, or no row is.
                const first = this.windows.page(plan, at.row, 1n);
                if (first.type === "none") { pending = true; continue; }
                const entry = first.value[0];
                at = entry !== undefined && equalFor(this.primaryKey)(entry.key, range.exact) ? { found: true, row: at.row, count: 1n } : { found: false, row: at.row, count: 0n };
            }
            if (at.count === 0n) continue;
            // Its place among the page's rows: after the rows of every value before it in the index's order.
            let before = 0n;
            for (const other of runs.value.runs) if (other.row < run.row) before += other.count;
            blocks.push({ found: true, row: before + at.row, count: at.count });
        }
        if (pending) return none;
        blocks.sort((a, b) => (a.row < b.row ? -1 : a.row > b.row ? 1 : 0));
        return some(blocks);
    }

    /** Each of the scope's values, as the index on exactly its fields keys a run of it: its fields' literals, in their order. */
    private scopeValues(index: Config["indexes"][number]): string[][] {
        let combinations: string[][] = [[]];
        for (const field of index.fields) {
            const clause = this.config.scope.get(field);
            const values = clause?.type === "values" ? clause.value : [];
            combinations = combinations.flatMap(leading => values.map(value => [...leading, value]));
        }
        return combinations;
    }

    /**
     * Some rows' maintained entries of an index, each beside the row it is one of: each row's keys, as the binding
     * maintains them — an East function of the row, evaluated row by row.
     */
    private entriesOf(index: string, rows: readonly { key: unknown; row: unknown }[]): RowEntries {
        const entries: RecordSliceEntryKey[] = [];
        const owners: number[] = [];
        for (const [i, { key, row }] of rows.entries()) {
            for (const ik of this.source.entryKeys(index, key, row)) {
                entries.push({ ik, key });
                owners.push(i);
            }
        }
        return { entries, owners };
    }

    /** Which of `count` rows a narrowing holds, their entries asked of its runs: a row is held when any of its entries is. */
    private held(plan: RecordSlicePlan, asked: RowEntries, count: number): option<boolean[]> {
        const answers = this.windows.within(plan, asked.entries);
        if (answers.type === "none") return none;
        const held: boolean[] = new Array<boolean>(count).fill(false);
        for (const [j, inside] of answers.value.entries()) if (inside) held[asked.owners[j]!] = true;
        return some(held);
    }

    /**
     * Which of the record's own rows `[offset, offset + limit)`, in its order,
     * a narrowing holds (#1349): those rows read from the record's own pages —
     * the very window a view over the record reads them in, so a view that
     * draws them asks for nothing more — and their maintained keys asked of the
     * narrowing's runs, as {@link RecordSliceController.within} asks them.
     *
     * @param where - The narrowing
     * @param offset - The first row, in the record's order
     * @param limit - How many rows: a page's, at most 2,048 of them read
     * @returns Whether the narrowing holds each row read, in order; none while the rows or the read are pending
     * @throws {Error} When the binding reads its own rows without joining them, or reads no memberships
     */
    withinAt(where: Where, offset: bigint, limit: bigint): option<boolean[]> {
        return this.withinOver(this.plan(new Map()), where, offset, limit);
    }

    /**
     * {@link withinAt} over the rows a plan reads, `[offset, offset + limit)` in its order: the record's own, or the rows a
     * page holds of its source ({@link baseWithinAt}).
     */
    private withinOver(rows: RecordSlicePlan, where: Where, offset: bigint, limit: bigint): option<boolean[]> {
        const page = this.windows.page(rows, offset, limit);
        if (page.type === "none") return none;
        const plan = this.plan(where);
        // A narrowing that holds no row holds none of these; no narrowing holds every row.
        if (plan.empty === true) return some(page.value.map(() => false));
        if (plan.queries.length === 0) return some(page.value.map(() => true));
        // The page's entries are made once, by the page read and the index: a membership asked again — every
        // evaluation that reads it while its answer is in flight — evaluates no row's maintained keys again.
        let byIndex = this.pageEntries.get(page.value);
        if (byIndex === undefined) {
            byIndex = new Map();
            this.pageEntries.set(page.value, byIndex);
        }
        let asked = byIndex.get(plan.index);
        if (asked === undefined) {
            asked = this.entriesOf(plan.index, page.value.map((entry) => {
                if (entry.row?.type !== "some") throw new Error("Asking which of a record's own rows a narrowing holds reads them with their rows: bind the record with its rows joined");
                return { key: entry.key, row: entry.row.value };
            }));
            byIndex.set(plan.index, asked);
        }
        return this.held(plan, asked, page.value.length);
    }

    /** Labels a typical exact choice would replace, for advance explanation. */
    replaces(field: string): string[] {
        const state = this.readState();
        const where = recordChoiceWhere(this.config, state.where, field, variant("values", [""]));
        if (where === null) return [];
        return this.config.fields.filter(value => state.where.has(value.fieldId) && !where.has(value.fieldId)).map(value => value.label);
    }

    /**
     * A value's own count under the other fields' choices — the rows the
     * narrowing holds with that value alone chosen for its field, as a faceted
     * search counts (#1393, ruled 23 Oct 2026) — and whether it is chosen; or
     * why the narrowing cannot take it. A key of an entries field counts the
     * rows holding it, whatever else is chosen ({@link holding}).
     */
    private counted(field: string, value: string, label: string): Count {
        const selected = this.readState().where.get(field);
        const base = { value, label, selected: selected?.type === "values" && selected.value.includes(value) };
        try {
            const count = this.weighing.has(field) ? this.holding(field, value) : this.count(this.proposed(field, variant("values", [value])));
            return { ...base, count, error: none };
        } catch (error) {
            return { ...base, count: none, error: some(error instanceof Error ? error.message : "Could not load the count") };
        }
    }

    /**
     * How many rows hold one key of an entries field (#1522): the key's range
     * of the entries index, which files each row's entry under it once, read
     * from the index alone. Its picks weigh the rows and narrow none, so the
     * count is the record's, whatever else is chosen.
     *
     * @param field - The entries field
     * @param value - The key, as a `.east` literal of the Dict's key type
     * @returns The count; none while its search is pending
     */
    private holding(field: string, value: string): option<bigint> {
        const index = this.config.indexes.find(candidate => candidate.entries && candidate.fields[0] === field);
        if (index === undefined) throw new Error(`No entries index files '${field}'`);
        const result = this.windows.resolve({ index: index.name, queries: [variant("key", value)] });
        return result.type === "some" ? some(result.value.total) : none;
    }

    /**
     * Known choices, each with its own exact count under the other fields'
     * choices, the chosen marked — never what a click on it would show; one
     * failure does not hide others.
     */
    values(field: string): Count[] {
        this.schema(field);
        return this.config.fields.find(value => value.fieldId === field)!.values.map(value => this.counted(field, value.value, value.label));
    }

    /**
     * Find up to eight distinct String values by jumping over each value's exact
     * bounds. At most one entry is read for a visited value, even if that value
     * appears millions of times. Set searches only suggest exact membership;
     * they never turn their potentially duplicated prefix ranges into rows.
     */
    suggest(field: string, text: string): option<Count[]> {
        const schema = this.schema(field);
        if (schema.kind !== "string" || this.weighing.has(field)) throw new Error("This field does not support text search");
        const exact = this.print.get(field)!(schema.optional ? some(text) : text);
        const proposal = this.proposed(field, variant("values", [exact]));
        // A scope that holds no value holds no row, and so no value to suggest.
        if (this.unread) return some([]);
        // The values found are the page's (#1621): the search reads an index that takes every scoped field before the field.
        const scoped = [...this.config.scope.keys()];
        const led = this.config.indexes.filter(candidate => scoped.every((name) => {
            const at = candidate.fields.indexOf(name);
            return at >= 0 && at < candidate.fields.indexOf(field);
        }));
        // A prefix searches a plain index's key, where one takes the field; else a generated one's, whose leading
        // values are its key's `on` (#1432).
        const index = recordPlanIndex(led.filter(candidate => !recordIndexGenerated(candidate)), proposal);
        if (index === undefined) {
            const generated = recordPlanIndex(led, proposal);
            if (generated === undefined || !generated.fields.includes(field)) {
                const path = [...scoped, field];
                throw new Error(`Searching '${field}' reads an index led by ${scoped.length === 0 ? "it" : "the page's scope, then it"} — by_${path.join("_")}: ` +
                    `index.on([${path.map(name => JSON.stringify(name)).join(", ")}]) among the record's indexes, listed in Data.bindPaged's indexes`);
            }
            return this.suggestOn(generated, field, text, proposal, schema.optional);
        }
        const position = index.fields.indexOf(field);
        const leading = new Map([...proposal].filter(([name]) => index.fields.indexOf(name) < position));
        leading.set(field, variant("prefix", text));
        // Suggestion bounds may include fan-out entries; each displayed value
        // gets its count from a separately validated exact-membership path.
        const searchPlan = planRecordSlice([{ ...index, sets: new Set(), interval: none, area: none }], leading, this.source.defaultIndex)!;
        const ranges = this.windows.resolve(searchPlan);
        if (ranges.type === "none") return none;
        const values: Count[] = [];
        const seen = new Set<string>();
        for (const run of ranges.value.runs) {
            let offset = run.row;
            while (offset < run.row + run.count && values.length < 8) {
                const page = this.source.page(index.name, offset, 1n);
                if (page.type === "none") return none;
                const entry = page.value[0];
                if (entry === undefined) throw new Error("The results changed while searching; retry");
                if (entry.ik.type !== index.name) throw new Error("The source returned a different ordering");
                const key = !index.structured ? entry.ik.value : (entry.ik.value as Record<string, unknown>)[field];
                const literal = this.print.get(field)!(key);
                if (!seen.has(literal)) {
                    seen.add(literal);
                    const optional = key as option<string>;
                    const value = schema.optional ? optional.type === "some" ? optional.value : "Unset" : key as string;
                    values.push(this.counted(field, literal, value));
                }
                const query: ValueTypeOf<SeekQueryType> = !index.structured ? variant("key", literal)
                    : variant("fields", { values: index.fields.slice(0, position + 1).map(name => this.print.get(name)!((entry.ik.value as Record<string, unknown>)[name])), prefix: none });
                const next = this.source.seek(index.name, query);
                if (next.type === "none") return none;
                const end = next.value.row + next.value.count;
                if (end <= offset) throw new Error("Search did not advance; retry");
                offset = end;
            }
            if (values.length === 8) break;
        }
        const current = this.source.revision();
        if (current.type === "none" || current.value !== ranges.value.revision) return none;
        return some(values);
    }

    /**
     * {@link suggest} through a generated index (#1432), whose key nests the row's leading fields under `on`: the
     * values starting with the text are read from where the leading fields chosen before the field and the text bound
     * its flattened key — one run for each combination of their values — an entry a value, each value's own run passed
     * over by its bounds, from it to the String just after it, `value + "\u0000"`, which no other value lies between.
     * A run ends at the first entry whose leading values, or whose field, no longer match.
     */
    private suggestOn(index: Config["indexes"][number], field: string, text: string, proposal: Where, optional: boolean): option<Count[]> {
        const revision = this.source.revision();
        if (revision.type === "none") return none;
        const print = this.print.get(field)!;
        const before = index.fields.slice(0, index.fields.indexOf(field));
        let combinations: string[][] = [[]];
        for (const name of before) {
            const choice = proposal.get(name);
            if (choice?.type !== "values") throw new Error(`Searching '${field}' through '${index.name}' needs an exact choice of '${name}' first`);
            combinations = combinations.flatMap(leading => [...new Set(choice.value)].map(value => [...leading, value]));
            if (combinations.length > MAX_RECORD_SLICE_RUNS) {
                throw new Error(`This combination needs more than ${MAX_RECORD_SLICE_RUNS} searches; choose fewer values`);
            }
        }
        const values: Count[] = [];
        const seen = new Set<string>();
        for (const leading of combinations) {
            const first = this.source.seek(index.name, variant("range", { from: [...leading, print(optional ? some(text) : text)], to: [] }));
            if (first.type === "none") return none;
            let offset = first.value.row;
            const end = first.value.row + first.value.count;
            while (offset < end && values.length < 8) {
                const page = this.source.page(index.name, offset, 1n);
                if (page.type === "none") return none;
                const entry = page.value[0];
                if (entry === undefined) throw new Error("The results changed while searching; retry");
                if (entry.ik.type !== index.name) throw new Error("The source returned a different ordering");
                const on = (entry.ik.value as Record<string, unknown>).on as Record<string, unknown>;
                if (before.some((name, at) => this.print.get(name)!(on[name]) !== leading[at])) break;
                const found = optional ? on[field] as option<string> : some(on[field] as string);
                if (found.type === "none" || !found.value.startsWith(text)) break;
                const literal = print(on[field]);
                if (!seen.has(literal)) {
                    seen.add(literal);
                    values.push(this.counted(field, literal, found.value));
                }
                const after = found.value + "\u0000";
                const own = this.source.seek(index.name, variant("range", { from: [...leading, literal], to: [...leading, print(optional ? some(after) : after)] }));
                if (own.type === "none") return none;
                const next = own.value.row + own.value.count;
                if (next <= offset) throw new Error("Search did not advance; retry");
                offset = next;
            }
            if (values.length === 8) break;
        }
        const current = this.source.revision();
        if (current.type === "none" || current.value !== revision.value) return none;
        return some(values);
    }
}
