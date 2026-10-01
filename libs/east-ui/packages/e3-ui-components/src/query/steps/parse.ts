/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Parsing steps (#933): a jq program back into the steps it is made of. Each
 * canonical form (`Query Editor Spec.md` §4.7) is recognised on the program
 * east's `parseJq` makes, never on its text, so layout and comments do not
 * matter; a segment no recogniser takes is a jq step, and so is every
 * segment after it.
 *
 * @packageDocumentation
 */

import {
    SortedMap, StringType, checkJq, compareFor, none, parseJq, some, toQuerySpan, variant,
    type EastType, type JqNode, type ParsedJq, type QueryErrorType, type ValueTypeOf,
} from "@elaraai/east";
import { comparisonsFor, fieldsOf, type StepField } from "./fields.js";
import {
    at, readCall, readChain, readLiteral, readObject, readPath, readPipe, readStepValue,
} from "./jq.js";
import { SEP, itemShape, knownAfter, nameFor, pathFor, scalarFieldsOf, stageAt, variableName } from "./print.js";
import { UNKNOWN, shapeOf, singular, unwrapRecursive, type Shape } from "./shape.js";
import {
    comparison, freshId, type Aggregate, type ComparisonKind, type Condition, type PickField, type Step, type StepInput,
    type StepQuery, type StepValue,
} from "./values.js";

/** A problem that keeps a program from being steps, as the query wire types hold one. */
export type StepParseError = ValueTypeOf<typeof QueryErrorType>;

/** A segment of the program's pipeline, and where it is. */
interface Segment {
    readonly node: JqNode;
    readonly path: string;
    readonly from: number;
    readonly to: number;
}

/** jq's comparison operators, by the comparison each is. */
const COMPARISON: Readonly<Record<string, ComparisonKind>> = { "==": "eq", "!=": "ne", ">=": "ge", "<=": "le", ">": "gt", "<": "lt" };

/**
 * A problem, at a range of the text.
 *
 * @param text - the program's text
 * @param code - its code
 * @param message - its sentence
 * @param from - where it starts
 * @param to - where it ends
 * @returns the problem
 */
function problem(text: string, code: string, message: string, from: number, to: number): StepParseError {
    return { code, fixes: [], message, severity: variant("error", null), span: some(toQuerySpan(text, from, to)), suggestions: [] };
}

/**
 * The field a path reads, when printing that field reads the same path: so a
 * step parsed prints back as it was read.
 *
 * @param shape - the rows the path reads in
 * @param names - the fields read, as `readPath` gives them
 * @param whole - the field is read as a whole value: a variant, not its case
 * @returns the field's ref, or `undefined` when no field reads that path
 */
function refOf(shape: Shape, names: readonly string[], whole = false): string | undefined {
    const same = (path: readonly string[]): boolean => path.length === names.length && path.every((n, i) => n === names[i]);
    const field = fieldsOf(shape).find(f => same(pathFor(shape, f.ref, whole)));
    if (field !== undefined) return field.ref;
    // A field the rows do not have is read as written, so the check can say so.
    return names.length === 1 && same(pathFor(shape, names[0]!, whole)) ? names[0] : undefined;
}

/** The field a node reads, as {@link refOf} finds it. */
function refOfNode(shape: Shape, node: JqNode | undefined, whole = false): string | undefined {
    const names = node === undefined ? undefined : readPath(node);
    return names === undefined ? undefined : refOf(shape, names, whole);
}

/** A test of a field. */
function test(ref: string, kind: ComparisonKind, value: StepValue | undefined, extra: { inner?: Condition; whole?: boolean } = {}): Condition {
    return variant("test", {
        id: freshId("condition"),
        field: some(ref),
        cmp: some(comparison(kind)),
        value: value === undefined ? none : some(value),
        inner: extra.inner === undefined ? none : some(extra.inner),
        whole: extra.whole ?? false,
    }) as Condition;
}

/** Whether a field takes a comparison: one the rows do not have takes any, which the check judges. */
function takes(field: StepField | undefined, kind: ComparisonKind, whole: boolean): boolean {
    if (field === undefined) return true;
    if (whole) return field.kind === "case" && (kind === "eq" || kind === "ne");
    return comparisonsFor(field).includes(kind);
}

/**
 * Reads one condition: a test in a canonical form, or a group.
 *
 * @param node - the condition's node
 * @param shape - the rows it tests
 * @returns the condition, or `undefined` when it is no canonical form
 */
function readCondition(node: JqNode, shape: Shape): Condition | undefined {
    if (node.type === "binary" && (node.value.op === "and" || node.value.op === "or")) {
        const op = node.value.op;
        const conds = readChain(node, op).map(n => readCondition(n, shape));
        if (conds.some(c => c === undefined)) return undefined;
        return variant("group", { id: freshId("condition"), match: variant(op === "or" ? "any" : "all", null), conds: conds as Condition[] }) as Condition;
    }
    const field = (ref: string): StepField | undefined => fieldsOf(shape).find(f => f.ref === ref);
    if (node.type === "binary") {
        const { left, op, right } = node.value;
        const segments = readPipe(left);
        // `(p | year) == 2026`, `(p | strftime("%Y-%m")) == "2026-03"`, `(p | length) >= 1`
        if (segments.length === 2) {
            const ref = refOfNode(shape, segments[0]);
            const read = segments[1]!;
            const value = readStepValue(right);
            if (ref === undefined || value === undefined) return undefined;
            let kind: ComparisonKind | undefined;
            if (op === "==" && readCall(read, "year", 0) !== undefined && value.type === "number") kind = "inYear";
            else if (op === ">=" && readCall(read, "length", 0) !== undefined && value.type === "number") kind = "lengthAtLeast";
            else if (op === "==" && value.type === "text") {
                const format = readCall(read, "strftime", 1);
                const literal = format === undefined ? undefined : readLiteral(format[0]!);
                if (literal?.type.type === "String" && literal.value === "%Y-%m") kind = "inMonth";
            }
            return kind !== undefined && takes(field(ref), kind, false) ? test(ref, kind, value) : undefined;
        }
        const cmp = COMPARISON[op];
        if (cmp === undefined) return undefined;
        const literal = readLiteral(right);
        if (literal === undefined) return undefined;
        // A variant compared as a whole value, which the check refuses: kept, so it can say so.
        const wholeRef = refOfNode(shape, left, true);
        const whole = wholeRef !== undefined && field(wholeRef)?.kind === "case" && refOfNode(shape, left) === undefined;
        const ref = whole ? wholeRef : refOfNode(shape, left);
        if (ref === undefined) return undefined;
        const f = field(ref);
        if (literal.type.type === "Null") {
            const kind: ComparisonKind | undefined = op === "==" ? "missing" : op === "!=" ? "present" : undefined;
            return kind !== undefined && takes(f, kind, false) ? test(ref, kind, undefined) : undefined;
        }
        if (literal.type.type === "Boolean" && op === "==") {
            const kind: ComparisonKind = literal.value === true ? "yes" : "no";
            return takes(f, kind, false) ? test(ref, kind, undefined) : undefined;
        }
        const value = readStepValue(right);
        if (value === undefined) return undefined;
        let kind: ComparisonKind = cmp;
        if (f?.kind === "date" && value.type === "text") {
            if (op === ">=") kind = "onOrAfter";
            else if (op === "<") kind = "before";
            else return undefined;
        }
        return takes(f, kind, whole) ? test(ref, kind, value, { whole }) : undefined;
    }
    // `(p | contains("x"))`, `(p | startswith("x"))`
    if (node.type === "pipe") {
        const segments = readPipe(node);
        if (segments.length !== 2) return undefined;
        const ref = refOfNode(shape, segments[0]);
        const contains = readCall(segments[1]!, "contains", 1);
        const starts = readCall(segments[1]!, "startswith", 1);
        const arg = contains ?? starts;
        const value = arg === undefined ? undefined : readStepValue(arg[0]!);
        if (ref === undefined || value?.type !== "text") return undefined;
        const kind: ComparisonKind = contains !== undefined ? "contains" : "startsWith";
        return takes(field(ref), kind, false) ? test(ref, kind, value) : undefined;
    }
    // `any(p[]; inner)`
    const any = readCall(node, "any", 2);
    if (any !== undefined && any[0]!.type === "iterate" && !any[0]!.value.optional) {
        const ref = refOfNode(shape, any[0]!.value.target);
        if (ref === undefined || !takes(field(ref), "anyWhere", false)) return undefined;
        const inner = readCondition(any[1]!, itemShape(field(ref)));
        return inner === undefined ? undefined : test(ref, "anyWhere", undefined, { inner });
    }
    return undefined;
}

/** Reads a Keep rows where step: `map(select(c) | …)`. */
function readFilter(node: JqNode, shape: Shape): Step | undefined {
    const map = readCall(node, "map", 1);
    if (map === undefined) return undefined;
    const selects = readPipe(map[0]!).map(s => readCall(s, "select", 1)?.[0]);
    if (selects.length === 0 || selects.some(s => s === undefined)) return undefined;
    const bodies = selects as JqNode[];
    let match: "all" | "any" = "all";
    const conds: Condition[] = [];
    if (bodies.length === 1) {
        const body = bodies[0]!;
        const op = body.type === "binary" && (body.value.op === "and" || body.value.op === "or") ? body.value.op : "and";
        match = op === "or" ? "any" : "all";
        for (const n of readChain(body, op)) {
            const c = readCondition(n, shape);
            if (c === undefined) return undefined;
            conds.push(c);
        }
    } else {
        for (const body of bodies) {
            const operands = body.type === "binary" && body.value.op === "or" ? [body] : readChain(body, "and");
            for (const n of operands) {
                const c = readCondition(n, shape);
                if (c === undefined) return undefined;
                conds.push(c);
            }
        }
    }
    return variant("filter", { id: freshId("step"), match: variant(match, null), conds });
}

/** The name a total takes until its author names it: count, the field's name for a sum, `fn_field` otherwise. */
export function defaultTotalName(shape: Shape, fn: Aggregate["fn"]["type"], ref: string | undefined): string {
    if (fn === "count") return "count";
    const name = ref === undefined ? "value" : nameFor(shape, ref);
    return fn === "sum" ? name : `${fn}_${name}`;
}

/** Reads one total of a Group and total step. */
function readAggregate(shape: Shape, as: string, node: JqNode | undefined): Aggregate | undefined {
    if (node === undefined) return undefined;
    const total = (fn: Aggregate["fn"]["type"], ref: string | undefined): Aggregate => ({
        id: freshId("aggregate"),
        fn: variant(fn, null) as Aggregate["fn"],
        field: ref === undefined ? none : some(ref),
        as,
    });
    if (readCall(node, "length", 0) !== undefined) return total("count", undefined);
    const segments = readPipe(node);
    const map = segments.length >= 2 ? readCall(segments[0]!, "map", 1) : undefined;
    const ref = map === undefined ? undefined : refOfNode(shape, map[0]);
    if (ref === undefined) return undefined;
    const rest = segments.slice(1);
    if (rest.length === 1 && readCall(rest[0]!, "add", 0) !== undefined) return total("sum", ref);
    if (rest.length === 1 && readCall(rest[0]!, "min", 0) !== undefined) return total("min", ref);
    if (rest.length === 1 && readCall(rest[0]!, "max", 0) !== undefined) return total("max", ref);
    if (rest.length === 1 && rest[0]!.type === "binary" && rest[0]!.value.op === "/"
        && readCall(rest[0]!.value.left, "add", 0) !== undefined && readCall(rest[0]!.value.right, "length", 0) !== undefined) {
        return total("mean", ref);
    }
    if (rest.length === 2 && readCall(rest[0]!, "unique", 0) !== undefined && readCall(rest[1]!, "length", 0) !== undefined) return total("distinct", ref);
    return undefined;
}

/** Reads the totals of an object: `{name: total, …}`. */
function readTotals(shape: Shape, entries: readonly { key: string; value: JqNode | undefined }[]): Aggregate[] | undefined {
    const aggs = entries.map(e => readAggregate(shape, e.key, e.value));
    return aggs.some(a => a === undefined) ? undefined : aggs as Aggregate[];
}

/** Whether a node is `.[0]`, the first row of a group. */
function isFirstRow(node: JqNode): boolean {
    if (node.type !== "index" || node.value.optional || node.value.target.type !== "identity") return false;
    const literal = readLiteral(node.value.index);
    return literal?.type.type === "Integer" && literal.value === 0n;
}

/**
 * Recognises the step a segment, and maybe the next, are.
 *
 * @param seg - the segment
 * @param next - the segment after it, for the forms that take two
 * @param shape - the rows it takes
 * @param binds - the prologue's variables, each a dataset of its own name
 * @returns the step and how many segments it took, or `undefined`
 */
function recognise(seg: JqNode, next: JqNode | undefined, shape: Shape, binds: ReadonlySet<string>): { step: Step; used: 1 | 2 } | undefined {
    const one = (step: Step | undefined): { step: Step; used: 1 } | undefined => step === undefined ? undefined : { step, used: 1 };

    // group_by(p) | map({name: .[0]p, totals…})
    const groupBy = readCall(seg, "group_by", 1);
    if (groupBy !== undefined && next !== undefined) {
        const byRef = refOfNode(shape, groupBy[0]);
        const entries = readCall(next, "map", 1)?.[0];
        const object = entries === undefined ? undefined : readObject(entries);
        if (byRef !== undefined && object !== undefined && object.length >= 1) {
            const [key, ...rest] = object;
            const firstPath = key!.value === undefined ? undefined : readPath(key!.value, isFirstRow);
            const byPath = pathFor(shape, byRef);
            const same = firstPath !== undefined && firstPath.length === byPath.length && firstPath.every((n, i) => n === byPath[i]);
            const aggs = readTotals(shape, rest);
            if (same && key!.key === nameFor(shape, byRef) && aggs !== undefined) {
                return { step: variant("group", { id: freshId("step"), by: some(variant("field", byRef)), aggs }), used: 2 };
            }
        }
        return undefined;
    }
    // sort_by(-p), sort_by(p), sort_by(p) | reverse
    const sortBy = readCall(seg, "sort_by", 1);
    if (sortBy !== undefined) {
        const arg = sortBy[0]!;
        if (arg.type === "negate") {
            const ref = refOfNode(shape, arg.value);
            const f = ref === undefined ? undefined : fieldsOf(shape).find(x => x.ref === ref);
            if (ref === undefined || f === undefined || (f.kind !== "int" && f.kind !== "num") || f.optional) return undefined;
            return one(variant("sort", { id: freshId("step"), field: some(ref), dir: variant("desc", null) }));
        }
        const ref = refOfNode(shape, arg);
        if (ref === undefined) return undefined;
        const reversed = next !== undefined && readCall(next, "reverse", 0) !== undefined;
        return { step: variant("sort", { id: freshId("step"), field: some(ref), dir: variant(reversed ? "desc" : "asc", null) }), used: reversed ? 2 : 1 };
    }
    // .[:n]
    if (seg.type === "slice" && !seg.value.optional && seg.value.target.type === "identity" && seg.value.from.type === "none" && seg.value.to.type === "some") {
        const value = readStepValue(seg.value.to.value);
        const n: StepInput | undefined = value?.type === "number" ? variant("number", value.value) : value?.type === "text" ? variant("text", value.value) : undefined;
        return n === undefined ? undefined : one(variant("limit", { id: freshId("step"), n }));
    }
    // length
    if (readCall(seg, "length", 0) !== undefined) return one(variant("count", { id: freshId("step") }));
    // {totals…}: all rows together
    const allTotals = readObject(seg);
    if (allTotals !== undefined && allTotals.length > 0) {
        const aggs = readTotals(shape, allTotals);
        return aggs === undefined ? undefined : one(variant("group", { id: freshId("step"), by: some(variant("all", null)), aggs }));
    }
    const map = readCall(seg, "map", 1)?.[0];
    if (map !== undefined) {
        // map(. + {…}): a Look up, or a part of a date
        if (map.type === "binary" && map.value.op === "+" && map.value.left.type === "identity") {
            const entries = readObject(map.value.right);
            if (entries === undefined || entries.length === 0) return undefined;
            return one(readLookup(entries, shape, binds) ?? readDatePart(entries, shape));
        }
        // map(p //= v)
        if (map.type === "update" && map.value.op === "//=") {
            const ref = refOfNode(shape, map.value.path, true);
            const value = readStepValue(map.value.value);
            if (ref === undefined || value === undefined) return undefined;
            return one(variant("fill", { id: freshId("step"), field: some(ref), value: some(value) }));
        }
        // map({a, b: p})
        const picked = readObject(map);
        if (picked !== undefined && picked.length > 0) {
            const fields: PickField[] = [];
            for (const entry of picked) {
                const ref = entry.value === undefined ? refOf(shape, [entry.key], true) : refOfNode(shape, entry.value, true);
                if (ref === undefined) return undefined;
                fields.push({ id: freshId("pick"), field: some(ref), as: entry.key });
            }
            return one(variant("pick", { id: freshId("step"), fields }));
        }
        return one(readFilter(seg, shape));
    }
    if (seg.type === "array" && seg.value.type === "some") return one(readArrayStep(seg.value.value, shape));
    return undefined;
}

/** `map(. + {f: $ds[k].f, …})` */
function readLookup(entries: readonly { key: string; value: JqNode | undefined }[], shape: Shape, binds: ReadonlySet<string>): Step | undefined {
    let dataset: string | undefined;
    let key: JqNode | undefined;
    const fields: string[] = [];
    for (const entry of entries) {
        const value = entry.value;
        if (value?.type !== "field" || value.value.optional || value.value.name !== entry.key) return undefined;
        const target = value.value.target;
        if (target.type !== "index" || target.value.optional || target.value.target.type !== "variable") return undefined;
        const name = target.value.target.value;
        if (!binds.has(name) || (dataset !== undefined && dataset !== name)) return undefined;
        dataset = name;
        key ??= target.value.index;
        fields.push(entry.key);
    }
    const keyRef = refOfNode(shape, key);
    if (dataset === undefined || keyRef === undefined) return undefined;
    // Every entry reads by the same key.
    for (const entry of entries) {
        const index = (entry.value as Extract<JqNode, { type: "field" }>).value.target as Extract<JqNode, { type: "index" }>;
        if (refOfNode(shape, index.value.index) !== keyRef) return undefined;
    }
    return variant("lookup", { id: freshId("step"), dataset: some(dataset), key: some(keyRef), fields });
}

/** `map(. + {name: (p | year)})` */
function readDatePart(entries: readonly { key: string; value: JqNode | undefined }[], shape: Shape): Step | undefined {
    if (entries.length !== 1 || entries[0]!.value === undefined) return undefined;
    const segments = readPipe(entries[0]!.value);
    if (segments.length !== 2) return undefined;
    const ref = refOfNode(shape, segments[0]);
    let part: "year" | "month" | "weekday" | undefined;
    if (readCall(segments[1]!, "year", 0) !== undefined) part = "year";
    else {
        const format = readCall(segments[1]!, "strftime", 1);
        const literal = format === undefined ? undefined : readLiteral(format[0]!);
        if (literal?.type.type === "String") part = literal.value === "%Y-%m" ? "month" : literal.value === "%A" ? "weekday" : undefined;
    }
    if (ref === undefined || part === undefined) return undefined;
    return variant("datepart", { id: freshId("step"), field: some(ref), part: variant(part, null), as: entries[0]!.key });
}

/** `[.[] | p[]]`, `[.[] | . as $row | p[] | . + {row_id: $row.id}]`, `[recurse(.p[]) | {…}]`, `[range(…) as $x | {…}]` */
function readArrayStep(body: JqNode, shape: Shape): Step | undefined {
    // Open each list.
    const segments = readPipe(body);
    if (segments.length === 2 && segments[0]!.type === "iterate" && !segments[0]!.value.optional && segments[0]!.value.target.type === "identity") {
        const rest = segments[1]!;
        if (rest.type === "iterate" && !rest.value.optional) {
            const ref = refOfNode(shape, rest.value.target);
            return ref === undefined ? undefined : variant("drill", { id: freshId("step"), field: some(ref) });
        }
        if (rest.type === "bind" && rest.value.source.type === "identity" && rest.value.patterns.length === 1) {
            const pattern = rest.value.patterns[0]!;
            const name = variableName(shape.noun);
            if (pattern.type !== "variable" || pattern.value !== name) return undefined;
            const inner = readPipe(rest.value.body);
            if (inner.length !== 2 || inner[0]!.type !== "iterate" || inner[0]!.value.optional) return undefined;
            const ref = refOfNode(shape, inner[0]!.value.target);
            const keep = inner[1]!;
            if (keep.type !== "binary" || keep.value.op !== "+" || keep.value.left.type !== "identity") return undefined;
            const entries = readObject(keep.value.right);
            const idRead = entries?.length === 1 ? entries[0]!.value : undefined;
            const idPath = idRead === undefined ? undefined : readPath(idRead, base => base.type === "variable" && base.value === name);
            if (ref === undefined || entries![0]!.key !== `${shape.noun}_id` || idPath?.length !== 1 || idPath[0] !== "id") return undefined;
            return variant("drill", { id: freshId("step"), field: some(ref) });
        }
        return undefined;
    }
    // List every part in the tree.
    if (segments.length === 2) {
        const recurse = readCall(segments[0]!, "recurse", 1);
        const via = recurse?.[0]?.type === "iterate" && !recurse[0].value.optional ? readPath(recurse[0].value.target) : undefined;
        const kept = readObject(segments[1]!);
        const node = unwrapRecursive(shape.type);
        if (via?.length === 1 && kept !== undefined && node.type === "Struct") {
            const scalars = scalarFieldsOf(node);
            const same = kept.length === scalars.length && kept.every((e, i) => e.value === undefined && e.key === scalars[i]);
            return same ? variant("walk", { id: freshId("step"), via: some(via[0]!) }) : undefined;
        }
        return undefined;
    }
    // Try the model over a range.
    if (body.type === "bind" && body.value.patterns.length === 1 && body.value.patterns[0]!.type === "variable") {
        const name = body.value.patterns[0]!.value;
        const range = readCall(body.value.source, "range", 3);
        const object = readObject(body.value.body);
        if (range === undefined || object?.length !== 2) return undefined;
        const [overEntry, resultEntry] = object;
        if (overEntry!.value?.type !== "variable" || overEntry!.value.value !== name || name !== variableName(overEntry!.key)) return undefined;
        const from = readStepValue(range[0]!);
        const by = readStepValue(range[2]!);
        const upto = range[1]!;
        if (from?.type !== "number" || by?.type !== "number" || upto.type !== "binary" || upto.value.op !== "+") return undefined;
        const to = readStepValue(upto.value.left);
        const half = upto.value.right;
        if (to?.type !== "number" || half.type !== "binary" || half.value.op !== "/") return undefined;
        const halfStep = readStepValue(half.value.left);
        const two = readLiteral(half.value.right);
        if (halfStep?.type !== "number" || halfStep.value !== by.value || two?.type.type !== "Integer" || two.value !== 2n) return undefined;
        const called = resultEntry!.value === undefined ? undefined : readCall(resultEntry!.value, "call", 2);
        const args = called === undefined || called[0]!.type !== "identity" ? undefined : readObject(called[1]!);
        if (args === undefined) return undefined;
        const fixed: [string, StepValue][] = [];
        for (const arg of args) {
            if (arg.key === overEntry!.key) {
                if (arg.value?.type !== "variable" || arg.value.value !== name) return undefined;
                continue;
            }
            const value = arg.value === undefined ? undefined : readStepValue(arg.value);
            if (value === undefined) return undefined;
            if (value.type !== "null") fixed.push([arg.key, value]);
        }
        return variant("tabulate", {
            id: freshId("step"), over: overEntry!.key,
            from: variant("number", from.value), to: variant("number", to.value), step: variant("number", by.value),
            fixed: new SortedMap(fixed, compareFor(StringType)), as: resultEntry!.key,
        });
    }
    return undefined;
}

/**
 * Parses a jq program into steps.
 *
 * @param program - the program's text, or what east's `parseJq` made of it
 * @param root - the root's type: a struct of the data sources
 * @returns the query as steps, or the problem that keeps it from being steps
 *
 * @remarks
 * The program starts with the `.ds as $ds` binds of its Look ups, then reads
 * a data source; every canonical form after it becomes its step, and a
 * segment no form takes is a jq step, as is every segment after it. Ids are
 * fresh on every parse. A program that does not parse, or does not start
 * from a data source, is not steps.
 */
export function parseSteps(program: string | ParsedJq, root: EastType): { query: StepQuery } | { error: StepParseError } {
    const parsed = typeof program === "string" ? parseJq(program) : program;
    const text = parsed.text;
    if (parsed.program.type === "none") return { error: parsed.diagnostics[0]! };
    const span = (path: string): { from: number; to: number } => parsed.spans.get(path)!;

    // The prologue: `.ds as $ds` for each dataset a Look up reads.
    let node = parsed.program.value;
    let path = "";
    const binds: { name: string; from: number; to: number; text: string }[] = [];
    while (node.type === "bind" && node.value.patterns.length === 1 && node.value.patterns[0]!.type === "variable") {
        const source = readPath(node.value.source);
        const name = node.value.patterns[0]!.value;
        const at0 = span(at(path, "bind.source"));
        if (source?.length !== 1 || source[0] !== name) {
            return { error: problem(text, "unsupported", "unsupported: the visual editor binds a dataset only as itself, like .customers as $customers.", at0.from, span(at(path, "bind.patterns[0]")).to) };
        }
        binds.push({ name, from: at0.from, to: span(at(path, "bind.patterns[0]")).to, text: `${text.slice(at0.from, at0.to)} as $${name}` });
        path = at(path, "bind.body");
        node = node.value.body;
    }

    // The pipeline's segments; a bind among them takes the rest.
    const segments: Segment[] = [];
    for (;;) {
        if (node.type === "pipe") {
            const left = at(path, "pipe.left");
            segments.push({ node: node.value.left, path: left, ...span(left) });
            path = at(path, "pipe.right");
            node = node.value.right;
            continue;
        }
        segments.push({ node, path, ...span(path) });
        break;
    }

    const first = segments[0]!;
    const sourceNames = readPath(first.node);
    if (sourceNames?.length !== 1) {
        return { error: problem(text, "unsupported", "unsupported: the visual editor starts from a dataset, like .orders.", first.from, first.to) };
    }
    const source = sourceNames[0]!;
    const sliceOf = (s: Segment): string => text.slice(s.from, s.to);

    // Shapes come from the checker, a prefix at a time, as printing finds them.
    let working: string[] = [...binds.map(b => b.text), sliceOf(first)];
    const offsetOf = (list: readonly string[]): number => list.reduce((n, s) => n + s.length + SEP.length, 0);
    const sourceCheck = checkJq(parseJq(working.join(SEP)), root, { root: true });
    const sourceStage = stageAt(sourceCheck, offsetOf(working.slice(0, -1)));
    if (sourceStage === undefined) {
        const problemAt = sourceCheck.diagnostics.find(d => d.severity.type === "error");
        if (problemAt !== undefined) {
            // The checker's words, and its fixes, at the source's place in the program.
            const shift = BigInt(first.from - offsetOf(working.slice(0, -1)));
            const s = problemAt.span.type === "some" ? problemAt.span.value : undefined;
            return {
                error: {
                    ...problemAt,
                    span: s === undefined ? none : some(toQuerySpan(text, Number(s.offset + shift), Number(s.offset + s.length + shift))),
                    fixes: problemAt.fixes.map(f => ({ label: f.label, edits: f.edits.map(e => ({ ...e, offset: e.offset + shift })) })),
                },
            };
        }
    }
    let shape: Shape = sourceStage === undefined ? { ...UNKNOWN, noun: singular(source) } : shapeOf(sourceStage.type, sourceStage.multiplicity, { noun: singular(source) });

    const bound = new Set(binds.map(b => b.name));
    const steps: Step[] = [];
    let jqFrom: number | undefined;
    for (let i = 1; i < segments.length;) {
        const seg = segments[i]!;
        const next = segments[i + 1];
        const found = jqFrom === undefined ? recognise(seg.node, next?.node, shape, bound) : undefined;
        if (found === undefined) {
            jqFrom ??= i;
            steps.push(variant("jq", { id: freshId("step"), text: sliceOf(seg) }));
            i += 1;
            continue;
        }
        const taken = segments.slice(i, i + found.used).map(sliceOf);
        const tentative = [...working, ...taken];
        const check = checkJq(parseJq(tentative.join(SEP)), root, { root: true });
        const stage = stageAt(check, offsetOf(tentative.slice(0, -1)));
        if (stage !== undefined && !check.diagnostics.some(d => d.severity.type === "error")) {
            shape = shapeOf(stage.type, stage.multiplicity, knownAfter(found.step, shape));
            working = tentative;
        }
        steps.push(found.step);
        i += found.used;
    }

    // A dataset bound but read by no Look up would be lost when the steps print again.
    const looked = new Set(steps.flatMap(s => s.type === "lookup" && s.value.dataset.type === "some" ? [s.value.dataset.value] : []));
    const unused = binds.find(b => !looked.has(b.name));
    if (unused !== undefined) {
        return { error: problem(text, "unsupported", `unsupported: $${unused.name} is bound but no Look up reads it, so the visual editor cannot keep it.`, unused.from, unused.to) };
    }
    return { query: { source, steps } };
}
