/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A function of a row, walked: whether an East function reads one of its
 * row's fields, told from its IR. The walk follows each East function called
 * in place, each parameter given the row holding it, and each variable bound
 * to the row; a call it cannot follow given the row — a platform function, or
 * a function value it cannot read — it reports as one it cannot see into,
 * rather than guess. The row taken whole anywhere else — handed to a builtin
 * that prints, encodes, hashes or compares it, held in a struct or a
 * collection, or returned — reads every field.
 *
 * What a Plan holds its series' functions to over paged rows, and what holds
 * a kind's `rowKey` off the field its `keyField` names.
 *
 * @packageDocumentation
 */

/** What a function of the row does: reads one of the fields asked after, or calls a function the walk cannot see into. */
export type RowRead = { readonly kind: "reads"; readonly field: string } | { readonly kind: "opaque" };

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

/** What a use of the row whole reads: every field asked after, the first of them named; nothing where none is asked after. */
function readsEvery(fields: ReadonlySet<string>): RowRead | undefined {
    const [field] = fields;
    return field === undefined ? undefined : { kind: "reads", field };
}

/** The first finding of a list of walks. */
function firstOf<T>(xs: readonly T[], walk: (x: T) => RowRead | undefined): RowRead | undefined {
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
 * @param fields - The fields asked after
 * @returns What it found; `undefined` for nothing
 */
function walk(node: unknown, rows: ReadonlySet<string>, fields: ReadonlySet<string>): RowRead | undefined {
    if (!isNode(node)) return undefined;
    const value = node.value;
    switch (node.type) {
        case "Variable":
            // The row reached here is taken whole: never a field read's struct, a call's argument followed into, or a
            // variable bound to it, which the cases below take before they walk on.
            return rows.has(value.name as string) ? readsEvery(fields) : undefined;
        case "GetField":
            if (isRow(value.struct, rows)) return fields.has(value.field as string) ? { kind: "reads", field: value.field as string } : undefined;
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
            // The row given as an argument is followed into the function below, or the call is one the walk cannot see into.
            const found = firstOf(args.filter((arg) => !isRow(arg, rows)), (arg) => walk(arg, rows, fields));
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
                if (isNode(statement) && statement.type === "Let" && isRow(statement.value.value, scope)) {
                    const name = variableName(statement.value.variable);
                    if (name !== undefined) scope.add(name);
                    continue;
                }
                const found = walk(statement, scope, fields);
                if (found !== undefined) return found;
            }
            return undefined;
        }
        default:
            return firstOf(Object.entries(value).filter(([key]) => !NOT_IR.has(key)).flatMap(([, held]) => nodesIn(held)),
                (held) => walk(held, rows, fields));
    }
}

/**
 * Walks a function of a row for a read of one of `fields` on the row, or a
 * call the walk cannot follow given the row.
 *
 * @param fn - The East function, reified: its first parameter is the row
 * @param fields - The fields asked after
 * @returns What it found; `undefined` for nothing
 */
export function rowReadIn(fn: unknown, fields: ReadonlySet<string>): RowRead | undefined {
    const ir = (fn as { toIR(): { ir: unknown } }).toIR().ir;
    if (!isNode(ir)) return undefined;
    const param = variableName((ir.value.parameters as readonly unknown[])[0]);
    return param === undefined ? undefined : walk(ir.value.body, new Set([param]), fields);
}
