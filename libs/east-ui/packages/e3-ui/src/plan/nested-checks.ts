/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Plan's series held to its rows' nested series index as it is built
 * (#1435), whatever TypeScript could see: a series list held in a variable,
 * or typed loosely, is refused as one written in place is. Over paged rows —
 * `Data.bindPaged(record, { indexes })` as `data`, a Slice's `rows` source,
 * or `Data.bindPaged(record)` — a page carries each row without the
 * collections its record's nested series index declares, so:
 *
 * - no function of the row maps one of them: the walk reads each accessor's
 *   IR for a field read on its row, following each East function it calls,
 *   and refuses a call it cannot follow (a platform function given the row,
 *   or a function value it cannot read) rather than guess;
 * - a read by name reads only what the index declares, as it declares it —
 *   items or values, by the times it files them by;
 * - a parent's subtotals are only those e3 keeps — a rollup the index
 *   declares, of the values as stored, at a resolution from its tile up — and
 *   a span parent rolls up only runs filed under it.
 *
 * Over rows read whole nothing here is checked: a function may map a
 * collection there.
 *
 * @packageDocumentation
 */

import type { EastType, ExprType } from "@elaraai/east";
import { reifyAccessor } from "@elaraai/east-ui/internal";
import {
    drawsAsStored, planNestedSeriesFacts, planSeriesNestOf,
    type PlanSeriesNestFacts, type PlanSeriesRead,
} from "./series.js";
import type { PlanValuesReadSpec } from "./reads.js";

// ============================================================================
// The index, read back from the binding's type
// ============================================================================

/**
 * How a nested series index declares one collection, as the Plan's build
 * reads it from the binding's type.
 */
export type PlanNestedDeclaration =
    | { readonly kind: "items"; readonly times: PlanNestedTimes; readonly rollup: boolean }
    | { readonly kind: "values"; readonly rollups: readonly PlanNestedRollup[] }
    | { readonly kind: "rows"; readonly collections: ReadonlyMap<string, PlanNestedDeclaration> }
    | { readonly kind: "recursive" };

/** An item's times, by the fields they are read from. */
export type PlanNestedTimes = { readonly from: string; readonly to: string } | { readonly at: string };

/** A rollup a nested series index keeps a collection of values by. */
export interface PlanNestedRollup {
    /** How a node's own values in a tile fold. */
    readonly fold: string;
    /** How a parent aggregates its children's. */
    readonly aggregate: string;
}

/**
 * A source's nested series index, as the Plan's build reads it: its name,
 * its tile and its summary tile, and each collection by its field.
 */
export interface PlanNestedIndex {
    /** The index's name. */
    readonly name: string;
    /** The finest level it files at, and keeps subtotals from. */
    readonly tile: string;
    /** The tile it keeps each node's totals by; none where it keeps none. */
    readonly summary: string | undefined;
    /** Each collection's declaration, by its field. */
    readonly collections: ReadonlyMap<string, PlanNestedDeclaration>;
}

/** A struct type's fields. */
function fieldsOf(type: EastType | undefined): Readonly<Record<string, EastType>> | undefined {
    return type?.type === "Struct" ? type.fields as Readonly<Record<string, EastType>> : undefined;
}

/** The one name a marker's struct holds; none for the empty struct. */
function nameOf(type: EastType | undefined): string | undefined {
    const fields = fieldsOf(type);
    return fields === undefined ? undefined : Object.keys(fields)[0];
}

/** Each collection's declaration, by its field, from the marker the binding's type carries. */
function collectionsOf(marker: EastType | undefined): ReadonlyMap<string, PlanNestedDeclaration> {
    return new Map(Object.entries(fieldsOf(marker) ?? {}).map(([field, declared]) => [field, declarationOf(declared)]));
}

/** One collection's declaration, from its marker. */
function declarationOf(marker: EastType): PlanNestedDeclaration {
    const fields = fieldsOf(marker) ?? {};
    const items = fieldsOf(fields.items);
    if (items !== undefined) {
        const times: PlanNestedTimes = items.at !== undefined ? { at: nameOf(items.at)! } : { from: nameOf(items.from)!, to: nameOf(items.to)! };
        return { kind: "items", times, rollup: items.rollup !== undefined };
    }
    if (fields.values !== undefined) {
        const rollups = fieldsOf(fieldsOf(fields.values)?.rollup) ?? {};
        return {
            kind: "values",
            rollups: Object.entries(rollups).flatMap(([fold, aggregates]) => Object.keys(fieldsOf(aggregates) ?? {}).map((aggregate) => ({ fold, aggregate }))),
        };
    }
    if (fields.rows !== undefined) return { kind: "rows", collections: collectionsOf(fields.rows) };
    return { kind: "recursive" };
}

/**
 * Reads a source's nested series index at build, from its binding's nested
 * part's type (`Data.bindPaged(record, { indexes })`): its name, each
 * collection's place, what it holds, its times and its rollups, its tile and
 * its summary's.
 *
 * @param nested - The nested part's type, as the binding's type, or its Slice's `rows` source's, holds it
 * @returns The index's declaration; `undefined` for a binding listing none
 */
export function planNestedIndex(nested: EastType | undefined): PlanNestedIndex | undefined {
    if (nested?.type !== "Variant") return undefined;
    const part = fieldsOf((nested.cases as Readonly<Record<string, EastType>>).some);
    const name = nameOf(part?.index);
    if (part === undefined || name === undefined) return undefined;
    return { name, tile: nameOf(part.tile)!, summary: nameOf(part.summary), collections: collectionsOf(part.collections) };
}

/**
 * The nested part a Plan's rows source carries in its type: an indexed
 * binding's own (`Data.bindPaged(record, { indexes })` as `data`), or a
 * Slice's `rows` source's.
 *
 * @param source - The `data` prop's East type, or the Slice handle's
 * @returns The nested part's type; `undefined` for a source carrying none
 */
export function nestedPartOf(source: EastType | undefined): EastType | undefined {
    const fields = fieldsOf(source);
    if (fields === undefined) return undefined;
    if (fields.defaultIndex !== undefined && fields.nested !== undefined) return fields.nested;
    const rows = fieldsOf(fieldsOf(fields.sources)?.rows);
    return rows?.nested;
}

// ============================================================================
// A function of the row, walked
// ============================================================================

/** What a function of the row does that a page of lean rows cannot serve. */
type Found = { readonly kind: "reads"; readonly field: string } | { readonly kind: "opaque" };

/** An IR node: a variant of East's IR. */
interface IRNode {
    readonly type: string;
    readonly value: Readonly<Record<string, unknown>>;
}

/** East's IR variants: what the walk treats as a node, and nothing else. */
const IR_NODES = new Set([
    "Error", "TryCatch", "Value", "Variable", "Let", "Assign", "As", "Function", "AsyncFunction", "Call", "CallAsync",
    "NewRef", "NewArray", "NewSet", "NewDict", "NewVector", "NewMatrix", "Struct", "GetField", "Variant", "Block",
    "IfElse", "Match", "UnwrapRecursive", "WrapRecursive", "While", "ForArray", "ForSet", "ForDict", "Return",
    "Continue", "Break", "Builtin", "Platform",
]);

/** A node's own properties that hold no IR: its type, its location, its type arguments, a loop's label. */
const NOT_IR = new Set(["type", "loc_id", "type_parameters", "label"]);

/** Whether a value is an IR node. */
function isNode(x: unknown): x is IRNode {
    return typeof x === "object" && x !== null && typeof (x as { type?: unknown }).type === "string"
        && IR_NODES.has((x as { type: string }).type) && typeof (x as { value?: unknown }).value === "object";
}

/** A variable's name. */
function variableName(x: unknown): string | undefined {
    return isNode(x) && x.type === "Variable" ? x.value.name as string : undefined;
}

/** Whether a node is the row: a variable holding it, its node unwrapped, or it cast. */
function isRow(x: unknown, rows: ReadonlySet<string>): boolean {
    if (!isNode(x)) return false;
    if (x.type === "Variable") return rows.has(x.value.name as string);
    if (x.type === "UnwrapRecursive" || x.type === "As") return isRow(x.value.value, rows);
    return false;
}

/** The first finding of a list of walks. */
function firstOf<T>(xs: readonly T[], walk: (x: T) => Found | undefined): Found | undefined {
    for (const x of xs) {
        const found = walk(x);
        if (found !== undefined) return found;
    }
    return undefined;
}

/** The IR nodes a value holds: itself, or those of an array or a plain object of them (a struct's fields, a match's cases). */
function nodesIn(x: unknown): unknown[] {
    if (isNode(x)) return [x];
    if (Array.isArray(x)) return x.flatMap(nodesIn);
    if (typeof x === "object" && x !== null) return Object.values(x).flatMap(nodesIn);
    return [];
}

/**
 * Walks a node for a read of one of `fields` on the row, or a call the walk
 * cannot follow given the row.
 *
 * @param node - The node
 * @param rows - The variables holding the row, in scope
 * @param fields - The fields a page of lean rows carries empty
 * @returns What it found; `undefined` for nothing
 */
function walk(node: unknown, rows: ReadonlySet<string>, fields: ReadonlySet<string>): Found | undefined {
    if (!isNode(node)) return undefined;
    const value = node.value;
    switch (node.type) {
        case "GetField":
            if (isRow(value.struct, rows) && fields.has(value.field as string)) return { kind: "reads", field: value.field as string };
            return walk(value.struct, rows, fields);
        case "Platform": {
            const args = value.arguments as readonly unknown[];
            if (args.some((arg) => isRow(arg, rows))) return { kind: "opaque" };
            return firstOf(args, (arg) => walk(arg, rows, fields));
        }
        case "Call":
        case "CallAsync": {
            const fn = value.function;
            const args = value.arguments as readonly unknown[];
            const found = firstOf(args, (arg) => walk(arg, rows, fields));
            if (found !== undefined) return found;
            // An East function called in place is followed into, each parameter given the row holding it.
            if (isNode(fn) && (fn.type === "Function" || fn.type === "AsyncFunction")) {
                const params = (fn.value.parameters as readonly unknown[]).map(variableName);
                const inner = new Set([...rows].filter((name) => !params.includes(name)));
                params.forEach((param, i) => { if (param !== undefined && isRow(args[i], rows)) inner.add(param); });
                return walk(fn.value.body, inner, fields);
            }
            // Any other function given the row is one the walk cannot see into.
            if (args.some((arg) => isRow(arg, rows))) return { kind: "opaque" };
            return walk(fn, rows, fields);
        }
        case "Function":
        case "AsyncFunction": {
            // A function's own parameters shadow the row's names; what it captures keeps them.
            const params = (value.parameters as readonly unknown[]).map(variableName);
            return walk(value.body, new Set([...rows].filter((name) => !params.includes(name))), fields);
        }
        case "Block": {
            // A variable bound to the row holds it for the statements after.
            const scope = new Set(rows);
            for (const statement of value.statements as readonly unknown[]) {
                const found = walk(statement, scope, fields);
                if (found !== undefined) return found;
                if (isNode(statement) && statement.type === "Let" && isRow(statement.value.value, scope)) {
                    const name = variableName(statement.value.variable);
                    if (name !== undefined) scope.add(name);
                }
            }
            return undefined;
        }
        default:
            return firstOf(Object.entries(value).filter(([key]) => !NOT_IR.has(key)).flatMap(([, held]) => nodesIn(held)),
                (held) => walk(held, rows, fields));
    }
}

/**
 * Walks a function of the row (#1435) for a read of one of `fields` — the
 * collections a page of lean rows carries empty — or a call the walk cannot
 * follow given the row.
 *
 * @param rowType - The entry type
 * @param keyType - Its key type
 * @param fn - The function of the row (its node, when recursive) and its key
 * @param fields - The fields a page of lean rows carries empty
 * @returns What it found; `undefined` for nothing
 */
function findInFunction(rowType: EastType, keyType: EastType, fn: (node: ExprType<EastType>, key: ExprType<EastType>) => unknown,
    fields: ReadonlySet<string>): Found | undefined {
    const recursive = rowType.type === "Recursive";
    const node = (row: ExprType<EastType>) => (recursive ? (row as unknown as { unwrap(): ExprType<EastType> }).unwrap() : row);
    const built = reifyAccessor([rowType, keyType], (row: ExprType<EastType>, key: ExprType<EastType>) => fn(node(row), key));
    const ir = (built as unknown as { toIR(): { ir: unknown } }).toIR().ir;
    if (!isNode(ir)) return undefined;
    const param = variableName((ir.value.parameters as readonly unknown[])[0]);
    return param === undefined ? undefined : walk(ir.value.body, new Set([param]), fields);
}

// ============================================================================
// The checks, in their words
// ============================================================================

/** How a Plan's rows are paged, as its checks read it. */
export interface PlanNestedContext {
    /** The rows source's nested series index; `undefined` where it lists none. */
    readonly index: PlanNestedIndex | undefined;
    /** The axis's kind, where its build is known. */
    readonly axisKind: string | undefined;
    /** The resolutions the axis offers, as written — `undefined` where its build is not known. */
    readonly resolutions: readonly string[] | undefined;
}

/** A level of the rows: the place of its collections from the top row, and the declarations there. */
interface Level {
    readonly place: readonly string[];
    readonly collections: ReadonlyMap<string, PlanNestedDeclaration> | undefined;
}

/**
 * A collection a series reads by name, how, and where (#1435): what the
 * checks hold to the index, and what a Plan reads of it a cell at a time
 * (#1438).
 */
export interface PlanNestedRead {
    /** The series' key. */
    readonly series: string;
    /** The collection's place: its field names from the top row down. */
    readonly place: readonly string[];
    /** Its field. */
    readonly field: string;
    /** How the index declares it there; none where it declares nothing. */
    readonly declared: PlanNestedDeclaration | undefined;
    /** The series' read by name of it; none for a step-down's rows or a tree's field. */
    readonly read: PlanSeriesRead | undefined;
    /** What is read: items, values, a step-down's rows, or a tree's. */
    readonly kind: "items" | "values" | "rows" | "recursive";
    /** The rollup a parent subtotals its values by; none where no parent does. */
    readonly subtotal: PlanNestedRollup | undefined;
    /** What a span's runs roll up into its bands by; none where they do not. */
    readonly rolledUp: string | undefined;
    /** The entry type the series reads it of. */
    readonly rowType: EastType | undefined;
}

/** A place as a refusal names it: `"measures.readings"`. */
const placeOf = (place: readonly string[]) => place.join(".");
/** Times as code: `{ from: "start", to: "end" }`. */
const timesCode = (times: PlanNestedTimes) => ("at" in times ? `{ at: "${times.at}" }` : `{ from: "${times.from}", to: "${times.to}" }`);
/** Times in words: `from "start" to "end"`. */
const timesWords = (times: PlanNestedTimes) => ("at" in times ? `at "${times.at}"` : `from "${times.from}" to "${times.to}"`);
/** A rollup in words: `sum`, or `{ fold: "sum", aggregate: "mean" }`. */
const rollupWords = (r: PlanNestedRollup) => (r.fold === r.aggregate ? r.fold : `{ fold: "${r.fold}", aggregate: "${r.aggregate}" }`);
/** A rollup as code: `"sum"`, or `{ fold: "sum", aggregate: "mean" }`. */
const rollupCode = (r: PlanNestedRollup) => (r.fold === r.aggregate ? `"${r.fold}"` : `{ fold: "${r.fold}", aggregate: "${r.aggregate}" }`);
/** Names in words: `"jobs", "stops" and "load"`. */
const namesWords = (names: readonly string[]) => names.length <= 1 ? names.map((n) => `"${n}"`).join("")
    : `${names.slice(0, -1).map((n) => `"${n}"`).join(", ")} and "${names[names.length - 1]}"`;
/** How an index declares a collection, as code. */
function declarationCode(d: PlanNestedDeclaration): string {
    switch (d.kind) {
        case "items": return `items(${timesCode(d.times)}${d.rollup ? ", { rollup: true }" : ""})`;
        case "values": return d.rollups.length === 0 ? "values()" : `values({ rollup: [${d.rollups.map(rollupCode).join(", ")}] })`;
        case "rows": return "rows({ … })";
        case "recursive": return "recursive()";
    }
}
/** The builder a read by name asks of the index. */
function builderFor(use: PlanNestedRead): string {
    if (use.read?.read.kind === "items") return `items(${timesCode(use.read.read.times)})`;
    if (use.kind === "values") return "values()";
    if (use.kind === "rows") return "rows({ … })";
    return "recursive()";
}

/** A series' element fields that draw things people drag: what a read of items gives. */
const ITEM_FIELDS = new Set(["runs", "decisions", "events", "chips", "marks"]);
/** Its element fields that draw a value an instant: what a read of values gives. */
const VALUE_FIELDS = new Set(["ports", "markers"]);
/** Its fields that consume values: cells, a strip's summary, a table's positions, a chart's layers. */
const CONSUMER_FIELDS = new Set(["cells", "summary", "series", "layers"]);

/** The fields a page of lean rows carries empty at a level: the items and values the index declares there; every Dict and Array field with no index. */
function emptiedAt(rowType: EastType, level: Level, index: PlanNestedIndex | undefined): ReadonlySet<string> {
    if (index !== undefined) {
        return new Set([...(level.collections ?? new Map()).entries()].filter(([, d]) => d.kind === "items" || d.kind === "values").map(([field]) => field));
    }
    const node = rowType.type === "Recursive" ? rowType.node as EastType : rowType;
    const fields = fieldsOf(node) ?? {};
    return new Set(Object.entries(fields).filter(([, t]) => t.type === "Dict" || t.type === "Array").map(([field]) => field));
}

/**
 * Refuses a series' functions of the row that map a collection a page of its
 * rows carries empty, or call a function the walk cannot see into.
 */
function checkFunctions(facts: PlanSeriesNestFacts, level: Level, context: PlanNestedContext): void {
    const nest = facts.nest;
    if (nest?.rowType === undefined) return;
    const fields = emptiedAt(nest.rowType, level, context.index);
    const functions = [...nest.accessors, ...nest.steps.flatMap((step, i) => (step.of !== undefined ? [{ via: `children[${i}]`, fn: step.of }] : []))];
    for (const { via, fn } of functions) {
        const found = findInFunction(nest.rowType, nest.keyType, fn, fields);
        if (found === undefined) continue;
        if (found.kind === "opaque") {
            throw new Error(`Plan: series "${facts.key}"'s ${via} calls a function the Plan cannot see into, and its rows are paged without ` +
                `${namesWords([...fields])} — read the row's own fields in ${via}`);
        }
        const declared = level.collections?.get(found.field);
        const element = via.replace(/\[\d+\]$/, "");
        if (context.index !== undefined && declared !== undefined) {
            const give = declared.kind === "items" && ITEM_FIELDS.has(element) ? `give ${via} as Plan.items("${found.field}", ${timesCode(declared.times)}, (item) => ({ … }))`
                : declared.kind === "values" && VALUE_FIELDS.has(element) ? `give ${via} as Plan.values("${found.field}", (value) => ({ … }))`
                : declared.kind === "values" && CONSUMER_FIELDS.has(element) ? `give ${via} through Plan.values("${found.field}", draw)`
                : `read the row's own fields in ${via}`;
            throw new Error(`Plan: series "${facts.key}" reads "${found.field}" in a function (${via}), and its rows are paged — a page carries each ` +
                `row without its collections: ${give}`);
        }
        throw new Error(`Plan: series "${facts.key}" reads "${found.field}" in a function (${via}), and its rows are paged — a row's collections are ` +
            `read a cell at a time: ${ITEM_FIELDS.has(element) ? `give ${via} as Plan.items("${found.field}", { from, to }, (item) => ({ … })), and ` : ""}` +
            `declare index.nested({ collections: { ${found.field}: index.nested.items({ from, to }) }, tile, summary }) ` +
            "and list it in Data.bindPaged(record, { indexes })");
    }
}

/**
 * What a series reads by name at a level, and the series it steps down to
 * and lists, each at its own level: a read with its subtotal and its rollup,
 * a tree's field, a step-down's rows.
 */
function usesOf(facts: PlanSeriesNestFacts, level: Level, stepAggregate: string | undefined, out: PlanNestedRead[], context: PlanNestedContext): void {
    const nest = facts.nest;
    if (nest === undefined) return;
    checkFunctions(facts, level, context);
    const at = (field: string) => ({ place: [...level.place, field], declared: level.collections?.get(field) });
    for (const read of facts.reads) {
        if (read.read.kind === "items") {
            // A span's runs roll up into its bands where it has children or declares a rollup.
            out.push({
                series: facts.key, ...at(read.field), field: read.field, read, kind: "items", subtotal: undefined,
                rolledUp: facts.arm === "span" && read.via === "runs" ? nest.rollup : undefined, rowType: nest.rowType,
            });
            continue;
        }
        // Its values are subtotalled where a parent derives its numbers from them: a step-down's by the parent's
        // aggregate, a tree's own by the series' — each by the fold its consumer folds them by.
        const aggregate = stepAggregate ?? (nest.tree !== undefined && nest.subtotalsOwn ? nest.aggregate : undefined);
        const flaggedAny = facts.reads.some((r) => r.flagged === true);
        const feeds = stepAggregate !== undefined || !flaggedAny || read.flagged === true;
        const subtotal = aggregate !== undefined && read.fold !== undefined && feeds ? { fold: read.fold, aggregate } : undefined;
        out.push({ series: facts.key, ...at(read.field), field: read.field, read, kind: "values", subtotal, rolledUp: undefined, rowType: nest.rowType });
    }
    if (nest.tree !== undefined) {
        out.push({ series: facts.key, ...at(nest.tree), field: nest.tree, read: undefined, kind: "recursive", subtotal: undefined, rolledUp: undefined, rowType: nest.rowType });
    }
    const nested = planNestedSeriesFacts(nest);
    for (const member of nested.members) usesOf(member, level, undefined, out, context);
    // A parent that is no tree derives its numbers from a step-down's by its aggregate.
    const childAggregate = nest.tree === undefined ? nest.aggregate : undefined;
    for (const step of nested.steps) {
        if (step.field === undefined) continue;
        const { place, declared } = at(step.field);
        out.push({ series: facts.key, place, declared, field: step.field, read: undefined, kind: "rows", subtotal: undefined, rolledUp: undefined, rowType: nest.rowType });
        const child: Level = { place, collections: declared?.kind === "rows" ? declared.collections : undefined };
        for (const series of step.series) usesOf(series, child, childAggregate, out, context);
    }
}

/** Refuses a read by name the index does not serve as it is written. */
function checkUse(use: PlanNestedRead, index: PlanNestedIndex): void {
    const place = placeOf(use.place);
    const series = `Plan: series "${use.series}"`;
    const declared = use.declared;
    if (declared === undefined) {
        throw new Error(`${series} reads "${place}", and the rows source's nested series index "${index.name}" does not declare it — declare it: ` +
            `collections: { ${use.field}: index.nested.${builderFor(use)} }`);
    }
    if (use.kind === "items") {
        if (declared.kind !== "items") {
            throw new Error(`${series} reads "${place}" as items, and "${index.name}" declares it ${declarationCode(declared)} — ` +
                (declared.kind === "values" ? `read it with Plan.values("${use.field}", draw)` : "read it as it is declared"));
        }
        const times = (use.read!.read as { readonly times: PlanNestedTimes }).times;
        if (timesCode(times) !== timesCode(declared.times)) {
            throw new Error(`${series} reads "${place}" ${timesWords(times)}, and "${index.name}" files it ${timesWords(declared.times)} — name the times it is filed by`);
        }
        if (use.rolledUp !== undefined && !declared.rollup) {
            throw new Error(`${series} rolls its children's runs up by ${use.rolledUp}, and "${index.name}" files "${place}" under no parent — declare it ` +
                `index.nested.items(${timesCode(declared.times)}, { rollup: true })`);
        }
        return;
    }
    if (use.kind === "values") {
        if (declared.kind !== "values") {
            throw new Error(`${series} reads "${place}" as values, and "${index.name}" declares it ${declarationCode(declared)} — ` +
                (declared.kind === "items" ? `read it with Plan.items("${use.field}", ${timesCode(declared.times)}, draw)` : "read it as it is declared"));
        }
        const subtotal = use.subtotal;
        if (subtotal === undefined) return;
        // A count is the index's count, whatever its values fold to; any other subtotal is a rollup it keeps.
        const kept = subtotal.aggregate === "count"
            ? declared.rollups.some((r) => r.aggregate === "count")
            : declared.rollups.some((r) => r.fold === subtotal.fold && r.aggregate === subtotal.aggregate);
        if (!kept) {
            if (declared.rollups.length === 0) {
                throw new Error(`${series} subtotals "${place}" by ${rollupWords(subtotal)}, and "${index.name}" keeps no subtotals of it — declare it ` +
                    `index.nested.values({ rollup: ${rollupCode(subtotal)} })`);
            }
            const words = declared.rollups.map(rollupWords);
            throw new Error(`${series} subtotals "${place}" by ${rollupWords(subtotal)}, and "${index.name}" keeps it by ${words.join(" and ")} — add the ` +
                `rollup: index.nested.values({ rollup: [${[...declared.rollups.map(rollupCode), rollupCode(subtotal)].join(", ")}] }), or subtotal it by ${words[0]}`);
        }
        if (use.rowType !== undefined && !drawsAsStored(use.rowType, use.read!.read as PlanValuesReadSpec, `Plan: series "${use.series}"`)) {
            throw new Error(`${series} subtotals "${place}", and its cells draw another number than each value of it — e3 keeps the subtotals ` +
                "of the values as stored: draw value: some(v), and show it another way through format");
        }
        return;
    }
    if (use.kind === "rows" && declared.kind !== "rows") {
        throw new Error(`${series} steps down to "${place}"'s child rows, and "${index.name}" declares it ${declarationCode(declared)} — read it as it is declared`);
    }
    if (use.kind === "recursive" && declared.kind !== "recursive") {
        throw new Error(`${series} reads "${place}" as more rows of its own, and "${index.name}" declares it ${declarationCode(declared)} — read it as it is declared`);
    }
}

/** The levels a time axis offers, finest first: a tile's, and the hour below every tile. */
const LEVELS = ["hour", "day", "week", "month", "quarter", "year"] as const;

/**
 * Refuses a resolution the axis offers finer than the index keeps its
 * subtotals from: `hour`, finer than every tile; `auto`, as each unit it may
 * show — the day, the week and the month.
 */
function checkResolutions(series: string, index: PlanNestedIndex, resolutions: readonly string[]): void {
    const tile = LEVELS.indexOf(index.tile as typeof LEVELS[number]);
    for (const resolution of resolutions) {
        const shown = resolution === "auto" ? ["day", "week", "month"] : [resolution];
        const finer = shown.find((level) => LEVELS.indexOf(level as typeof LEVELS[number]) >= 0 && LEVELS.indexOf(level as typeof LEVELS[number]) < tile);
        if (finer === undefined) continue;
        const shows = resolution === "auto" ? ", which auto shows," : ",";
        const remedy = finer === "hour" ? `drop "${resolution}" from the axis's resolutions` : `declare tile: "${finer}", or drop "${resolution}" from the axis's resolutions`;
        throw new Error(`Plan: series "${series}" subtotals its children at ${finer} resolution${shows} and "${index.name}" keeps its subtotals from ` +
            `${index.tile} up — ${remedy}`);
    }
}

/**
 * Holds a Plan's series over paged rows to its rows' nested series index, as
 * the Plan is built (#1435): every series a `Plan.series.*` builder made, in
 * place or held in a variable, its step-downs' and its members' too. An East
 * expression of a series list is held to it as nothing here: what it reads is
 * known only as it runs.
 *
 * @param series - The `series` input
 * @param context - The rows source's nested series index, and the axis
 * @returns What the series read, each held to the index: what a Plan reads of it a cell at a time (#1438); none for an
 *   East expression of a series list
 * @throws {Error} The first refusal, in its words: a function mapping a collection of the paged rows, or one the Plan
 *   cannot see into; a read by name with no nested series index; a read of a collection the index does not declare, by
 *   other times than it files by, or as values where it declares items or items where values; a subtotal by a rollup it
 *   does not keep, of values drawn as another number, or at a resolution finer than its tile; runs rolled up that it
 *   files under no parent; a read by name on an axis other than time; and an index keeping no totals
 */
export function checkPlanNested(series: unknown, context: PlanNestedContext): readonly PlanNestedRead[] {
    if (!Array.isArray(series)) return [];
    const { index } = context;
    const top: Level = { place: [], collections: index?.collections };
    const uses: PlanNestedRead[] = [];
    for (const one of series) {
        const facts = planSeriesNestOf(one);
        if (facts !== undefined) usesOf(facts, top, undefined, uses, context);
    }
    const byName = uses.filter((use) => use.kind === "items" || use.kind === "values");
    const first = byName[0];
    if (first === undefined) return uses;
    if (index === undefined) {
        throw new Error(`Plan: series "${first.series}" reads "${placeOf(first.place)}" a cell at a time, and the rows source lists no nested series ` +
            `index — declare index.nested({ collections: { ${first.field}: index.nested.${builderFor(first)} }, ` +
            "tile, summary }) and list it in Data.bindPaged(record, { indexes })");
    }
    if (context.axisKind !== undefined && context.axisKind !== "time") {
        throw new Error(`Plan: series "${first.series}" reads "${placeOf(first.place)}" a cell at a time, which e3 files in time, and this is ` +
            `${context.axisKind === "number" ? "a number" : "an ordinal"} axis — bind the rows whole, or use a time axis`);
    }
    for (const use of uses) checkUse(use, index);
    if (index.summary === undefined) {
        throw new Error(`Plan: "${index.name}" keeps no totals — the Plan draws a view's items while they number 10,000 or fewer, and the ` +
            'totals\' shading past that: declare summary: "month"');
    }
    const subtotalled = uses.find((use) => use.subtotal !== undefined);
    if (subtotalled !== undefined && context.resolutions !== undefined) checkResolutions(subtotalled.series, index, context.resolutions);
    return uses;
}
