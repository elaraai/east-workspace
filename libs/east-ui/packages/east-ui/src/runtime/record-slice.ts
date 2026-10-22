/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Record narrowing, shared by the platform handle and its controls. */
import {
    StringType, compareFor, decodeBeast2For, encodeBeast2For, none, parseFor, printFor, some, variant,
    type EastType, type StructType, type ValueTypeOf, type option,
} from "@elaraai/east";
import { recordSliceFieldSchema, recordSliceFieldTypes, type RecordSliceFieldSchema } from "../platform/slice/record.js";
import { planRecordSlice, recordChoiceWhere, recordPlanIndex, type RecordSlicePlan } from "../platform/slice/record-plan.js";
import type { RecordSliceConfigType, RecordSliceStateType, RecordSliceWhereType, RecordSliceChoiceType, RecordSliceCountType, RecordSliceDomainType } from "../platform/slice/record-types.js";
import { RecordSliceSource, type RecordSliceReader } from "./record-slice-source.js";
import type { SeekQueryType } from "../contracts/source.js";

type Config = ValueTypeOf<RecordSliceConfigType>;
type State = ValueTypeOf<RecordSliceStateType>;
type Where = ValueTypeOf<RecordSliceWhereType>;
type Choice = ValueTypeOf<RecordSliceChoiceType>;
type Count = ValueTypeOf<RecordSliceCountType>;

/** Only the index key is inspected; record rows and covering values stay opaque. */
export interface RecordSliceEntry {
    /** Tagged key of the index that served the entry. */
    ik: variant<string, unknown>;
    /** Original key, inspected only by editing confirmation. */
    key?: unknown;
    /** Joined row, encoded whole only for editing confirmation. */
    row?: option<unknown>;
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
 */
export class RecordSliceController {
    /** Bounded, revision-aware windows shared by counts and data. */
    readonly windows: RecordSliceSource<RecordSliceEntry>;
    private readonly encodeRow: ReturnType<typeof encodeBeast2For>;
    private readonly decodeRow: ReturnType<typeof decodeBeast2For>;
    private readonly schemas = new Map<string, RecordSliceFieldSchema>();
    private readonly parse = new Map<string, ReturnType<typeof parseFor>>();
    private readonly print = new Map<string, ReturnType<typeof printFor>>();

    /**
     * @param source - Bound indexed reads.
     * @param config - Author-derived field metadata and paths.
     * @param row - Record row type recovered from the platform's source type.
     * @param readState - Tracked state read.
     * @param writeState - Shared store write, including persistence.
     * @param primaryKey - Original key type; String ids stay raw, other ids are East literals.
     * @param indexes - Type metadata for computed fields, carried by the source.
     */
    constructor(readonly source: RecordSliceBinding, readonly config: Config, row: StructType,
        readonly readState: () => State, private readonly writeState: (state: State) => void, private readonly primaryKey: EastType = StringType, indexes?: StructType) {
        this.encodeRow = encodeBeast2For(row);
        this.decodeRow = decodeBeast2For(row);
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
    }

    private schema(field: string): RecordSliceFieldSchema {
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
            if (values.length === 0 || (schema.set && values.length !== 1)) throw new Error(schema.set ? "Choose one value" : "Choose at least one value");
            return variant("values", values);
        }
        if (choice.type === "prefix") {
            if (schema.kind !== "string" || schema.set) throw new Error("Choose an exact value for this field");
            return choice;
        }
        // A window is a read's, under an area index's `__area`, never a field's choice (#1385).
        if (choice.type === "window") throw new Error("A window is given to a read by area, never chosen for a field");
        if (schema.set || !["datetime", "integer", "float"].includes(schema.kind)) throw new Error("This field does not support a range");
        const from = this.readValue(field, choice.value.from);
        const to = this.readValue(field, choice.value.to);
        if (schema.optional && ((from as option<unknown>).type === "none" || (to as option<unknown>).type === "none")) throw new Error("Choose two range endpoints");
        if (compareFor(schema.key)(from, to) >= 0) throw new Error("The range end must be after its start");
        return variant("range", { from: print(from), to: print(to) });
    }

    /** Validate the whole state before a custom control or saved view writes it. */
    write(state: State): null {
        const where = new Map([...state.where].map(([field, choice]) => [field, this.validate(field, choice)]));
        this.plan(where);
        if (state.preset.type === "some" && !this.config.presets.some(preset => preset.id === state.preset.value)) throw new Error("Unknown preset");
        this.writeState({ ...state, where });
        return null;
    }

    /** Compile a supported narrowing, refusing an incompatible saved/custom state. */
    plan(where: Where): RecordSlicePlan {
        const plan = planRecordSlice(this.config.indexes, where, this.source.defaultIndex);
        if (plan === null) throw new Error("These choices cannot be combined; clear a field and try again");
        return plan;
    }

    /** The next valid state for one choice; shared with prospective counts. */
    proposed(field: string, choice: Choice | undefined): Where {
        this.schema(field);
        const next = recordChoiceWhere(this.config.indexes, this.readState().where, field,
            choice === undefined ? undefined : this.validate(field, choice));
        if (next === null) throw new Error("Choose the preceding fields before this field");
        this.plan(next);
        return next;
    }

    /** Apply one choice, clearing incompatible trailing clauses together. */
    choose(field: string, choice: Choice | undefined): null {
        return this.write({ ...this.readState(), where: this.proposed(field, choice), preset: none });
    }

    /** Clear narrowing while preserving presentation resolution. */
    clearAll(): null { return this.write({ ...this.readState(), where: new Map(), preset: none }); }

    /** Set or clear a named narrowing. */
    togglePreset(id: string): null {
        const state = this.readState();
        if (state.preset.type === "some" && state.preset.value === id) return this.clearAll();
        const preset = this.config.presets.find(value => value.id === id);
        if (preset === undefined) throw new Error("Unknown preset");
        return this.write({ ...state, where: preset.where, preset: some(id) });
    }

    /** Exact count, never a partial sum while another query is pending. */
    count(where: Where = this.readState().where): option<bigint> {
        const result = this.windows.resolve(this.plan(where));
        return result.type === "some" ? some(result.value.total) : none;
    }

    /**
     * Measure a numeric/date field using only boundary index entries. Leading
     * choices remain applied; this field's own range is ignored. Unset entries
     * are skipped with one exact search, never by walking their rows.
     */
    domain(field: string): option<ValueTypeOf<RecordSliceDomainType>> {
        const schema = this.schema(field);
        if (schema.set || !["datetime", "integer", "float"].includes(schema.kind)) throw new Error("This field has no range");
        const proposal = recordChoiceWhere(this.config.indexes, this.readState().where, field,
            variant("range", { from: "", to: "" }));
        if (proposal === null) return none;
        const index = recordPlanIndex(this.config.indexes, proposal);
        if (index === undefined) return none;
        const position = index.fields.indexOf(field);
        const leading = new Map([...proposal].filter(([name]) => index.fields.indexOf(name) < position));
        const plan = planRecordSlice([index], leading, index.name)!;
        const bounds = this.windows.resolve(plan);
        if (bounds.type === "none") return none;
        const compare = compareFor(schema.key);
        const print = this.print.get(field)!;
        let min: unknown;
        let max: unknown;
        let pending = false;
        const keyOf = (entry: RecordSliceEntry): unknown => {
            if (entry.ik.type !== index.name) throw new Error("The source returned a different ordering");
            return !index.structured ? entry.ik.value : (entry.ik.value as Record<string, unknown>)[field];
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
                const fields = index.structured
                    ? index.fields.slice(0, position + 1).map(name => this.print.get(name)!((entry!.ik.value as Record<string, unknown>)[name])) : [];
                if (index.interval.type === "some") fields.splice(index.fields.length - 1, 0, "0");
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
        const revision = this.source.revision();
        if (revision.type === "none") return none;
        const text = this.primaryKey.type === "String" ? printFor(StringType)(id) : id;
        const key = parseFor(this.primaryKey)(text);
        if (!key.success) throw new Error("Invalid record identity");
        const found = this.source.seek("primary", variant("key", text));
        if (found.type === "none") return none;
        let result: option<Uint8Array> = none;
        if (found.value.found) {
            const page = this.source.page("primary", found.value.row, 1n);
            if (page.type === "none") return none;
            const entry = page.value[0];
            if (entry === undefined || entry.row?.type !== "some" || compareFor(this.primaryKey)(entry.key, key.value) !== 0) {
                throw new Error("The record changed while confirming the edit; retry");
            }
            result = some(this.encodeRow(entry.row.value));
        }
        const current = this.source.revision();
        return current.type === "some" && current.value === revision.value ? some(result) : none;
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

    /** An entry's membership, its row read or held: the row read once, its maintained keys sought. */
    private membership(where: Where, id: string, readRow: () => option<option<Uint8Array>>): option<boolean> {
        const plan = this.plan(where);
        const runs = this.windows.resolve(plan);
        const row = readRow();
        if (runs.type === "none" || row.type === "none") return none;
        const current = this.source.revision();
        if (current.type === "none" || current.value !== runs.value.revision) return none;
        if (row.value.type === "none") return some(false);
        if (plan.index === "primary") return some(true);
        const key = parseFor(this.primaryKey)(this.primaryKey.type === "String" ? printFor(StringType)(id) : id);
        if (!key.success) throw new Error("Invalid record identity");
        const keys = this.source.entryKeys(plan.index, key.value, this.decodeRow(row.value.value));
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

    /** Labels a typical exact choice would replace, for advance explanation. */
    replaces(field: string): string[] {
        const state = this.readState();
        const where = recordChoiceWhere(this.config.indexes, state.where, field, variant("values", [""]));
        if (where === null) return [];
        return this.config.fields.filter(value => state.where.has(value.fieldId) && !where.has(value.fieldId)).map(value => value.label);
    }

    private counted(field: string, value: string, label: string, toggle = false): Count {
        const selected = this.readState().where.get(field);
        const base = { value, label, selected: selected?.type === "values" && selected.value.includes(value) };
        try {
            const active = selected?.type === "values" ? selected.value : [];
            const multiple = this.config.fields.find(candidate => candidate.fieldId === field)!.multiple;
            const values = !toggle ? [value] : base.selected ? active.filter(candidate => candidate !== value) : multiple ? [...active, value] : [value];
            return { ...base, count: this.count(this.proposed(field, values.length === 0 ? undefined : variant("values", values))), error: none };
        } catch (error) {
            return { ...base, count: none, error: some(error instanceof Error ? error.message : "Could not load the count") };
        }
    }

    /** Known choices with exact prospective counts; one failure does not hide others. */
    values(field: string): Count[] {
        this.schema(field);
        return this.config.fields.find(value => value.fieldId === field)!.values.map(value => this.counted(field, value.value, value.label, true));
    }

    /**
     * Find up to eight distinct String values by jumping over each value's exact
     * bounds. At most one entry is read for a visited value, even if that value
     * appears millions of times. Set searches only suggest exact membership;
     * they never turn their potentially duplicated prefix ranges into rows.
     */
    suggest(field: string, text: string): option<Count[]> {
        const schema = this.schema(field);
        if (schema.kind !== "string") throw new Error("This field does not support text search");
        const exact = this.print.get(field)!(schema.optional ? some(text) : text);
        const proposal = this.proposed(field, variant("values", [exact]));
        const plan = this.plan(proposal);
        const index = this.config.indexes.find(value => value.name === plan.index)!;
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
}
