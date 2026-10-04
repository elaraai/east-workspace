/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Building and reading jq programs as East values (#933): the nodes of
 * `JqType` the steps print as, and the readers their recognisers parse back
 * with. A literal is the typed East value it writes (`JqLiteralType`), as
 * east's parser makes it.
 *
 * @packageDocumentation
 */

import {
    BooleanType,
    FloatType,
    IntegerType,
    NullType,
    StringType,
    none,
    some,
    variant,
    type EastType,
    type JqNode,
} from "@elaraai/east";
import type { StepValue } from "./values.js";

/**
 * A child's path, as the parser and the printer key a node's span: the
 * parent's path, then the step to the child.
 *
 * @param path - the parent's path, `""` for the root
 * @param step - the steps to the child: `"pipe.left"`, `"call.args[0]"`, …; `""` for the node itself
 * @returns the child's path
 */
export function at(path: string, step: string): string {
    if (path === "") return step;
    return step === "" ? path : `${path}.${step}`;
}

/** A name jq reads as an identifier: a variable's, a field's written bare. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The words jq keeps for itself, which no variable may be named. */
const KEYWORDS: ReadonlySet<string> = new Set([
    "and", "or", "not", "def", "if", "then", "elif", "else", "end", "as", "reduce", "foreach", "try", "catch",
    "label", "import", "include", "module", "break", "__loc__",
]);

/**
 * Whether a name can name a jq variable.
 *
 * @param name - the name
 * @returns whether `$name` reads as a variable
 */
export function isVariableName(name: string): boolean {
    return IDENTIFIER.test(name) && !KEYWORDS.has(name);
}

// ============================================================================
// Building
// ============================================================================

/** `.` */
export const IDENTITY: JqNode = variant("identity", null);

/** `target.name` */
export function fieldNode(target: JqNode, name: string): JqNode {
    return variant("field", { name, optional: false, target });
}

/**
 * The read of a field path: `.a.b` from `.`, or from another node.
 *
 * @param names - the fields read, outermost first
 * @param from - what they are read from; `.` by default
 * @returns the node
 */
export function pathNode(names: readonly string[], from: JqNode = IDENTITY): JqNode {
    return names.reduce((target, name) => fieldNode(target, name), from);
}

/** `left | right` */
export function pipe(left: JqNode, right: JqNode): JqNode {
    return variant("pipe", { left, right });
}

/**
 * Segments piped in order, as the parser nests them: `a | (b | c)`.
 *
 * @param nodes - the segments, one or more
 * @returns the pipe
 */
export function pipeAll(nodes: readonly JqNode[]): JqNode {
    if (nodes.length === 0) throw new Error("pipeAll: no segments");
    let node = nodes[nodes.length - 1]!;
    for (let i = nodes.length - 2; i >= 0; i--) node = pipe(nodes[i]!, node);
    return node;
}

/**
 * The path of the `i`th of `n` segments piped by {@link pipeAll}, relative
 * to the pipe.
 *
 * @param i - the segment's index
 * @param n - how many segments
 * @returns its path
 */
export function pipedPath(i: number, n: number): string {
    let path = "";
    for (let k = 0; k < i; k++) path = at(path, "pipe.right");
    return i === n - 1 ? path : at(path, "pipe.left");
}

/** `name(args…)` */
export function call(name: string, args: readonly JqNode[] = []): JqNode {
    return variant("call", { args: [...args], name });
}

/** `left op right` */
export function binary(left: JqNode, op: string, right: JqNode): JqNode {
    return variant("binary", { left, op, right });
}

/**
 * Operands joined by one operator, as the parser nests them: `(a and b) and c`.
 *
 * @param operands - the operands, one or more
 * @param op - `and` or `or`
 * @returns the chain
 */
export function chain(operands: readonly JqNode[], op: string): JqNode {
    if (operands.length === 0) throw new Error("chain: no operands");
    return operands.slice(1).reduce((left, right) => binary(left, op, right), operands[0]!);
}

/**
 * The path of the `i`th of `n` operands joined by {@link chain}, relative to
 * the chain.
 *
 * @param i - the operand's index
 * @param n - how many operands
 * @returns its path
 */
export function chainedPath(i: number, n: number): string {
    // `((e0 op e1) op e2) op e3`: e3 is the right of the root, e2 the right of its left, …, e0 the leftmost.
    const lefts = i === 0 ? n - 1 : n - 1 - i;
    let path = "";
    for (let k = 0; k < lefts; k++) path = at(path, "binary.left");
    return i === 0 ? path : at(path, "binary.right");
}

/** `-operand` */
export function negate(operand: JqNode): JqNode {
    return variant("negate", operand);
}

/** `$name` */
export function variable(name: string): JqNode {
    return variant("variable", name);
}

/**
 * `{key: value, key, …}`: each entry a name, with a value or none.
 *
 * @param entries - the entries
 * @returns the object
 */
export function objectNode(entries: readonly { key: string; value?: JqNode }[]): JqNode {
    return variant("object", entries.map(entry => ({
        key: variant("name", entry.key),
        value: entry.value === undefined ? none : some(entry.value),
    })));
}

/** `[body]`, or `[]` with no body. */
export function arrayNode(body?: JqNode): JqNode {
    return variant("array", body === undefined ? none : some(body));
}

/**
 * Outputs one after another, as the parser nests them: `(a, b), c`.
 *
 * @param nodes - the outputs, one or more
 * @returns the comma
 */
export function commaAll(nodes: readonly JqNode[]): JqNode {
    if (nodes.length === 0) throw new Error("commaAll: no outputs");
    return nodes.slice(1).reduce((left, right) => variant("comma", { left, right }), nodes[0]!);
}

/** `target[]` */
export function iterate(target: JqNode): JqNode {
    return variant("iterate", { optional: false, target });
}

/** `target[key]` */
export function index(target: JqNode, key: JqNode): JqNode {
    return variant("index", { index: key, optional: false, target });
}

/** `target[:to]` */
export function sliceTo(target: JqNode, to: JqNode): JqNode {
    return variant("slice", { from: none, optional: false, target, to: some(to) });
}

/** `source as $name | body` */
export function bind(source: JqNode, name: string, body: JqNode): JqNode {
    return variant("bind", { body, patterns: [variant("variable", name)], source });
}

/** `path op value`, for an update operator */
export function updateNode(path: JqNode, op: string, value: JqNode): JqNode {
    return variant("update", { op, path, value });
}

/** A String literal. */
export function stringLiteral(text: string): JqNode {
    return variant("literal", variant("string", text));
}

/** An Integer literal. */
export function integerLiteral(n: bigint): JqNode {
    return variant("literal", variant("integer", n));
}

/** A Float literal. */
export function floatLiteral(x: number): JqNode {
    return variant("literal", variant("float", x));
}

/** A Boolean literal. */
export function booleanLiteral(b: boolean): JqNode {
    return variant("literal", variant("boolean", b));
}

/** `null` */
export function nullLiteral(): JqNode {
    return variant("literal", variant("null", null));
}

/**
 * A number as jq writes it: an Integer when it is whole, which a Float
 * compares with as its own, and a Float otherwise.
 *
 * @param x - the number
 * @returns the literal
 */
export function numberLiteral(x: number): JqNode {
    return Number.isSafeInteger(x) ? integerLiteral(BigInt(x)) : floatLiteral(x);
}

/**
 * The literal of a step's value.
 *
 * @param value - the value
 * @returns its literal
 */
export function valueLiteral(value: StepValue): JqNode {
    switch (value.type) {
        case "text": return stringLiteral(value.value);
        case "number": return numberLiteral(value.value);
        case "boolean": return booleanLiteral(value.value);
        case "null": return nullLiteral();
    }
}

// ============================================================================
// Reading
// ============================================================================

/**
 * The fields a node reads in a row, from `.`: `.a.b` gives `["a", "b"]`.
 *
 * @param node - the node
 * @param from - what the reads start from; `.` when omitted, else a test of the base node
 * @returns the names, or `undefined` when the node is not a plain path
 */
export function readPath(node: JqNode, from?: (base: JqNode) => boolean): string[] | undefined {
    const names: string[] = [];
    let n = node;
    while (n.type === "field" && !n.value.optional) {
        names.unshift(n.value.name);
        n = n.value.target;
    }
    const based = from === undefined ? n.type === "identity" : from(n);
    return based ? names : undefined;
}

/**
 * A call's arguments.
 *
 * @param node - the node
 * @param name - the function's name
 * @param arity - how many arguments
 * @returns the arguments, or `undefined` when the node is not that call
 */
export function readCall(node: JqNode, name: string, arity: number): JqNode[] | undefined {
    return node.type === "call" && node.value.name === name && node.value.args.length === arity ? node.value.args : undefined;
}

/**
 * A literal's value, with its type.
 *
 * @param node - the node
 * @returns the type and value, or `undefined` when it is not a literal
 */
export function readLiteral(node: JqNode): { type: EastType; value: unknown } | undefined {
    if (node.type !== "literal") return undefined;
    const literal = node.value;
    switch (literal.type) {
        case "boolean": return { type: BooleanType, value: literal.value };
        case "float": return { type: FloatType, value: literal.value };
        case "integer": return { type: IntegerType, value: literal.value };
        case "null": return { type: NullType, value: null };
        case "string": return { type: StringType, value: literal.value };
    }
}

/**
 * A literal as a step's value: text, a number, yes or no, or nothing.
 *
 * @param node - the node
 * @returns the value, or `undefined` when it is not a literal
 */
export function readStepValue(node: JqNode): StepValue | undefined {
    if (node.type !== "literal") return undefined;
    const literal = node.value;
    switch (literal.type) {
        case "string": return variant("text", literal.value);
        case "integer": return variant("number", Number(literal.value));
        case "float": return variant("number", literal.value);
        case "boolean": return variant("boolean", literal.value);
        case "null": return variant("null", null);
    }
}

/**
 * A pipe's segments, in order.
 *
 * @param node - the node
 * @returns the segments; the node alone when it is no pipe
 */
export function readPipe(node: JqNode): JqNode[] {
    const segments: JqNode[] = [];
    let n = node;
    while (n.type === "pipe") {
        segments.push(n.value.left);
        n = n.value.right;
    }
    segments.push(n);
    return segments;
}

/**
 * An object's entries, when every key is a name.
 *
 * @param node - the node
 * @returns each entry's key and value, or `undefined` when it is no such object
 */
export function readObject(node: JqNode): { key: string; value: JqNode | undefined }[] | undefined {
    if (node.type !== "object") return undefined;
    const entries: { key: string; value: JqNode | undefined }[] = [];
    for (const entry of node.value) {
        if (entry.key.type !== "name") return undefined;
        entries.push({ key: entry.key.value, value: entry.value.type === "some" ? entry.value.value : undefined });
    }
    return entries;
}

/**
 * The operands of a chain of one operator, as {@link chain} builds it: the
 * left side read down while it is the same operator.
 *
 * @param node - the node
 * @param op - `and` or `or`
 * @returns the operands; the node alone when it is no such chain
 */
export function readChain(node: JqNode, op: string): JqNode[] {
    const operands: JqNode[] = [];
    let n = node;
    while (n.type === "binary" && n.value.op === op) {
        operands.unshift(n.value.right);
        n = n.value.left;
    }
    operands.unshift(n);
    return operands;
}
