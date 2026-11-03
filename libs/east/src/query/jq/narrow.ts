/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A query's rows narrowed to the fields its later steps read (#1141).
 *
 * A stage that builds each row, `map(. + {region: …})`, gives it every field
 * of the row it came from, and one that keeps each row, `map(select(…))`, keeps
 * the dataset's row whole, though the steps after either may read two fields.
 * The translator and the split planner run the program {@link narrowRows}
 * gives them: the checked program, with each such row built of the fields read
 * after it, checked again.
 *
 * - An object a step builds, `{a: f, b: g}` or `. + {c: h}`, keeps the fields
 *   the steps after it read. A field none reads is left out where making it
 *   can neither raise nor give other than one value, so no answer changes:
 *   `{a: .x, b: (.y / .z)} | .a` keeps `b`, whose division may raise.
 * - A stage over a dataset's rows that passes them on, `map(select(p))`, ends
 *   by building each row of the fields read after it: `map(select(p) | {id,
 *   total})`. A row built of what it reads is what the paged loops of #1112
 *   decode a dataset's rows to, and what a piece keeps and sends on.
 * - A value read whole — reaching the output, `keys`, `tojson`, `length` of
 *   an object, `==`, a variable bound to it, anything not understood here — is
 *   built whole, and so is every value in a `try`'s body, where the checker
 *   lets a value of the wrong kind by, to raise; a program with a `def` is
 *   left as written.
 *
 * The narrowed program is checked again over the program's text, each node at
 * the range of the text it came from, so a runtime error and an explanation
 * name the query as written; where it does not check to the same output type,
 * multiplicity and reads, the program runs as written.
 *
 * @packageDocumentation
 */

import { none, some, variant } from "../../containers/variant.js";
import { isTypeEqual, type EastType } from "../../types.js";
import { checkJq, type CheckJqResult } from "./check.js";
import type { ParsedJq } from "./parse.js";
import { unwrap } from "./shapes.js";
import { childPath, jqChildren, jqPatternChildren, type JqNode, type JqPattern, type JqRange } from "./spans.js";

// ─── What a step leaves unmade ─────────────────────────────────────────────

/**
 * Builtins that raise for nothing the checker lets reach them, by name and
 * arity: given arguments that never raise, they never raise. The checker
 * refuses a value of a kind a builtin cannot take, outside a lenient place,
 * so what is left to raise at run time is a value's own: a zero divisor, a
 * string that is no number, a count below zero, `error`.
 */
const NEVER_RAISE: ReadonlySet<string> = new Set([
  "select/1", "not/0", "length/0", "utf8bytelength/0", "type/0", "tostring/0", "tojson/0", "empty/0", "keys/0", "keys_unsorted/0",
  "has/1", "in/1", "contains/1", "inside/1", "startswith/1", "endswith/1", "ltrimstr/1", "rtrimstr/1", "ascii_downcase/0", "ascii_upcase/0",
  "floor/0", "ceil/0", "round/0", "fabs/0", "sqrt/0", "abs/0", "values/0", "nulls/0", "numbers/0", "strings/0", "booleans/0", "arrays/0",
  "objects/0", "iterables/0", "scalars/0", "map/1", "add/0", "any/0", "all/0", "min/0", "max/0",
]);

/**
 * Whether a filter never raises, whatever its input: what a step may leave
 * unmade, a stage's rows past the ones a step needs (#1140) or a field no step
 * reads (#1141), since a value that raises makes the whole query raise.
 * Conservative: paths, literals, comparisons, `and`, `or`, `+`, `-` and `*`,
 * objects, arrays, strings, `if`, `//`, `try`, a `label` and a `break` to it,
 * and the builtins in {@link NEVER_RAISE}, of parts that never raise. `/` and
 * `%` (a zero divisor), a `def` or a call of one, a function value, any other
 * builtin, and a `break` out of the filter, which leaves it as a raise does,
 * may raise.
 *
 * @param node - the filter
 * @param defs - the defs in scope, by `name/arity`: a call of one may raise
 * @param labels - the labels the filter is inside, which a `break` may leave
 * @returns whether it never raises
 *
 * @internal
 */
export function cannotRaise(node: JqNode, defs: { has(key: string): boolean }, labels: ReadonlySet<string> = new Set()): boolean {
  const all = (nodes: readonly JqNode[]): boolean => nodes.every(n => cannotRaise(n, defs, labels));
  switch (node.type) {
    case "identity": case "literal": case "variable": case "descend":
      return true;
    case "break": return labels.has(node.value);
    case "field": return all([node.value.target]);
    // An index or a bound jq may refuse for its value (`null`, a key of another kind) only when computed: a literal never is.
    case "index": return node.value.index.type === "literal" && all([node.value.target]);
    case "slice": {
      const { from, target, to } = node.value;
      return (from.type === "none" || (from.value as JqNode).type === "literal") && (to.type === "none" || (to.value as JqNode).type === "literal")
        && all([target]);
    }
    case "iterate": return all([node.value.target]);
    case "pipe": case "comma": case "alternative": return all([node.value.left, node.value.right]);
    case "binary": return node.value.op !== "/" && node.value.op !== "%" && all([node.value.left, node.value.right]);
    case "negate": return all([node.value]);
    case "array": return node.value.type === "none" || all([node.value.value as JqNode]);
    // A computed key that is no string raises.
    case "object":
      return node.value.every(entry => entry.key.type !== "computed" && (entry.value.type === "none" || all([entry.value.value as JqNode])));
    case "string":
      return node.value.every(part => part.type === "text" || all([part.value as JqNode]));
    case "if": {
      const { branches, otherwise } = node.value;
      return branches.every(b => all([b.condition, b.then])) && (otherwise.type === "none" || all([otherwise.value as JqNode]));
    }
    // What `try` runs raises into its handler, which may raise; a `break` leaves it.
    case "try": return !breaksOut(node.value.body, labels) && (node.value.catch.type === "none" || all([node.value.catch.value as JqNode]));
    case "label": return cannotRaise(node.value.body, defs, new Set(labels).add(node.value.name));
    // A pattern that destructures may not match its value.
    case "bind": return node.value.patterns.every(pattern => pattern.type === "variable") && all([node.value.source, node.value.body]);
    case "call": {
      const key = `${node.value.name}/${node.value.args.length}`;
      return NEVER_RAISE.has(key) && !defs.has(key) && all(node.value.args);
    }
    default:
      return false;
  }
}

/** Whether a filter may `break` to a label it is not inside: leave itself, as a raise does. */
function breaksOut(node: JqNode, labels: ReadonlySet<string>): boolean {
  if (node.type === "break") return !labels.has(node.value);
  const inner = node.type === "label" ? new Set(labels).add(node.value.name) : labels;
  return jqChildren(node).some(child => child.node !== undefined && breaksOut(child.node, inner));
}

// ─── What later steps read ─────────────────────────────────────────────────

/**
 * What the steps after a filter read of each of its outputs: all of it,
 * nothing, some fields of a struct (each whole), or each element of an array
 * (its length and order with them).
 */
type Demand =
  | { readonly kind: "whole" }
  | { readonly kind: "none" }
  | { readonly kind: "fields"; readonly fields: ReadonlySet<string> }
  | { readonly kind: "elements"; readonly element: Demand };

const WHOLE: Demand = { kind: "whole" };
const NONE: Demand = { kind: "none" };

function fieldsOf(...names: string[]): Demand {
  return { kind: "fields", fields: new Set(names) };
}

function elementsOf(element: Demand): Demand {
  return { kind: "elements", element };
}

/** What two readers of one value read between them. */
function both(a: Demand, b: Demand): Demand {
  if (a.kind === "none") return b;
  if (b.kind === "none") return a;
  if (a.kind === "fields" && b.kind === "fields") return { kind: "fields", fields: new Set([...a.fields, ...b.fields]) };
  if (a.kind === "elements" && b.kind === "elements") return elementsOf(both(a.element, b.element));
  return WHOLE;
}

/** What is read of each element of an array read as `d` reads it. */
function elementOf(d: Demand): Demand {
  return d.kind === "elements" ? d.element : d.kind === "none" ? NONE : WHOLE;
}

/** Builtins of no arguments that give their input or nothing: a type's `select`. */
const PASS_THROUGH: ReadonlySet<string> = new Set([
  "values", "nulls", "booleans", "numbers", "strings", "arrays", "objects", "iterables", "scalars",
]);

/** Where a filter is: what its input is, and whether a value of the wrong kind may reach it. */
interface Place {
  /** In a `try`'s body, where the checker lets a value of the wrong kind by, to raise (#1140): every value is made. */
  readonly lenient: boolean;
  /** The input is the root of a query checked as an e3 root. */
  readonly root: boolean;
  /** The input is a dataset's rows, read from the root: a stage that passes them on is narrowed. */
  readonly rows: boolean;
}

/** A filter's input as a step after the root reads it: a dataset's rows. */
function readsRootField(node: JqNode): boolean {
  return node.type === "field" && node.value.target.type === "identity" && !node.value.optional;
}

/** Whether a filter's outputs are its input or none: `select(p)`, `.`, and pipes, commas and branches of them. */
function passesThrough(node: JqNode): boolean {
  switch (node.type) {
    case "identity": return true;
    case "pipe": case "comma": return passesThrough(node.value.left) && passesThrough(node.value.right);
    case "if":
      return node.value.branches.every(b => passesThrough(b.then))
        && (node.value.otherwise.type === "none" || passesThrough(node.value.otherwise.value as JqNode));
    case "call":
      return (node.value.name === "select" && node.value.args.length === 1) || (node.value.name === "empty" && node.value.args.length === 0)
        || (node.value.args.length === 0 && PASS_THROUGH.has(node.value.name));
    default: return false;
  }
}

/** Whether a program defines a function anywhere: a call may then be of it, not of the builtin. */
function definesAny(node: JqNode): boolean {
  return node.type === "def" || jqChildren(node).some(child => child.node !== undefined && definesAny(child.node));
}

type Entry = Extract<JqNode, { type: "object" }>["value"][number];

/** A field `{name}` reads of its input, as an object's entry. */
function shorthand(name: string): Entry {
  return { key: variant("name", name), value: none } as Entry;
}

/** A filter narrowed to what is read of its outputs, and what it reads of its input. */
interface Narrowed {
  readonly node: JqNode;
  readonly reads: Demand;
}

/** The demand analysis and the rewrite over one checked program. */
class Narrower {
  /** Each node the rewrite made, and the path of the node whose text it stands for. */
  readonly from = new Map<object, string>();
  /** What the steps after each node read of its outputs, by its path. */
  readonly demands = new Map<string, Demand>();
  /** Whether any node was rewritten. */
  changed = false;

  constructor(readonly checked: CheckJqResult) {}

  /** The type of a node's outputs, as the checker gave it. */
  private typeOf(path: string): EastType | undefined {
    return this.checked.typeAt(path)?.type;
  }

  /** Whether a node's input is an array. */
  private arrayInput(path: string): boolean {
    const shape = this.checked.inputAt(path, "");
    return shape !== null && shape.kind === "type" && unwrap(shape.type).type === "Array";
  }

  /** Whether an entry's value may be left out: making it never raises, and gives exactly one value. */
  private droppable(value: JqNode | undefined, path: string, place: Place): boolean {
    if (place.lenient) return false;
    if (value === undefined) return true;
    return cannotRaise(value, new Set()) && this.checked.typeAt(path)?.multiplicity === "one";
  }

  /** A node made by the rewrite, standing for the node at `path`. */
  private made(node: JqNode, path: string): JqNode {
    this.from.set(node, path);
    return node;
  }

  /** `node` with a new payload, where any of its children changed. */
  private remade(node: JqNode, path: string, value: unknown, changed: boolean): JqNode {
    return changed ? this.made(variant(node.type, value) as JqNode, path) : node;
  }

  /**
   * Narrows a filter to what the steps after it read of its outputs.
   *
   * @param node - the filter
   * @param path - its path
   * @param out - what the steps after it read of each output
   * @param place - where it is
   * @returns the filter, rewritten where it builds fields none reads, and
   *   what it reads of its input
   */
  narrow(node: JqNode, path: string, out: Demand, place: Place): Narrowed {
    this.demands.set(path, out);
    const at = (step: string): string => childPath(path, step);
    const keep = (reads: Demand): Narrowed => ({ node, reads });
    // Where a filter's input is not the root, nor a dataset's rows.
    const inner: Place = { lenient: place.lenient, root: false, rows: false };
    switch (node.type) {
      case "identity": return keep(out);
      case "literal": case "variable": case "break": return keep(NONE);
      case "field": {
        const target = this.narrow(node.value.target, at("field.target"), fieldsOf(node.value.name), place);
        return { node: this.remade(node, path, { ...node.value, target: target.node }, target.node !== node.value.target), reads: target.reads };
      }
      case "index": {
        const { index, target } = node.value;
        if (index.type === "literal" && index.value.type === "string") {
          const t = this.narrow(target, at("index.target"), fieldsOf(index.value.value), place);
          return { node: this.remade(node, path, { ...node.value, target: t.node }, t.node !== target), reads: t.reads };
        }
        const t = this.narrow(target, at("index.target"), elementsOf(out), place);
        const i = this.narrow(index, at("index.index"), WHOLE, place);
        return { node: this.remade(node, path, { ...node.value, index: i.node, target: t.node }, t.node !== target || i.node !== index), reads: both(t.reads, i.reads) };
      }
      case "slice": {
        const { from, target, to } = node.value;
        const t = this.narrow(target, at("slice.target"), out, place);
        const f = from.type === "some" ? this.narrow(from.value as JqNode, at("slice.from.some"), WHOLE, place) : undefined;
        const e = to.type === "some" ? this.narrow(to.value as JqNode, at("slice.to.some"), WHOLE, place) : undefined;
        const changed = t.node !== target || (f !== undefined && f.node !== from.value) || (e !== undefined && e.node !== to.value);
        const value = { ...node.value, from: f === undefined ? from : some(f.node), target: t.node, to: e === undefined ? to : some(e.node) };
        return { node: this.remade(node, path, value, changed), reads: both(t.reads, both(f?.reads ?? NONE, e?.reads ?? NONE)) };
      }
      case "iterate": {
        const type = this.typeOf(at("iterate.target"));
        const array = type !== undefined && unwrap(type).type === "Array";
        const t = this.narrow(node.value.target, at("iterate.target"), array ? elementsOf(out) : WHOLE, place);
        return { node: this.remade(node, path, { ...node.value, target: t.node }, t.node !== node.value.target), reads: t.reads };
      }
      case "pipe": {
        const { left, right } = node.value;
        const r = this.narrow(right, at("pipe.right"), out, { lenient: place.lenient, root: false, rows: place.root && readsRootField(left) });
        const l = this.narrow(left, at("pipe.left"), r.reads, place);
        return { node: this.remade(node, path, { left: l.node, right: r.node }, l.node !== left || r.node !== right), reads: l.reads };
      }
      case "comma": case "alternative": {
        const { left, right } = node.value;
        const l = this.narrow(left, at(`${node.type}.left`), out, place);
        const r = this.narrow(right, at(`${node.type}.right`), out, place);
        return { node: this.remade(node, path, { left: l.node, right: r.node }, l.node !== left || r.node !== right), reads: both(l.reads, r.reads) };
      }
      case "binary": {
        const { left, op, right } = node.value;
        if (op === "+" && left.type === "identity" && right.type === "object" && (out.kind === "fields" || out.kind === "none") && !place.lenient) {
          const merged = this.merged(right, path, out, place);
          if (merged !== undefined) return merged;
        }
        const l = this.narrow(left, at("binary.left"), WHOLE, place);
        const r = this.narrow(right, at("binary.right"), WHOLE, place);
        return { node: this.remade(node, path, { left: l.node, op, right: r.node }, l.node !== left || r.node !== right), reads: both(l.reads, r.reads) };
      }
      case "negate": {
        const v = this.narrow(node.value, at("negate"), WHOLE, place);
        return { node: this.remade(node, path, v.node, v.node !== node.value), reads: v.reads };
      }
      case "array": {
        if (node.value.type === "none") return keep(NONE);
        const body = node.value.value as JqNode;
        const element = elementOf(out);
        const b = this.narrow(body, at("array.some"), element, { ...place, rows: false });
        // `[.[] | f]` over a dataset's rows, as `map(f)` is.
        let made = b.node;
        if (place.rows && made.type === "pipe" && made.value.left.type === "iterate" && made.value.left.value.target.type === "identity") {
          const f = this.project(made.value.right, at("array.some.pipe.right"), element, place);
          if (f !== undefined) made = this.made(variant("pipe", { left: made.value.left, right: f }) as JqNode, at("array.some"));
        }
        return { node: this.remade(node, path, some(made), made !== body), reads: b.reads };
      }
      case "object": return this.object(node, path, out, place);
      case "string": {
        let reads = NONE;
        let changed = false;
        const parts = node.value.map((part, i) => {
          if (part.type !== "interpolate") return part;
          const p = this.narrow(part.value as JqNode, at(`string[${i}].interpolate`), WHOLE, place);
          reads = both(reads, p.reads);
          if (p.node === part.value) return part;
          changed = true;
          return variant("interpolate", p.node);
        });
        return { node: this.remade(node, path, parts, changed), reads };
      }
      case "format": {
        // `@csv` formats its input; `@csv "\(f)"` each value it interpolates.
        if (node.value.string.type === "none") return keep(WHOLE);
        const s = this.narrow(node.value.string.value as JqNode, at("format.string.some"), WHOLE, place);
        return { node: this.remade(node, path, { ...node.value, string: some(s.node) }, s.node !== node.value.string.value), reads: s.reads };
      }
      case "if": {
        let reads = NONE;
        let changed = false;
        const branches = node.value.branches.map((branch, i) => {
          const c = this.narrow(branch.condition, at(`if.branches[${i}].condition`), WHOLE, place);
          const t = this.narrow(branch.then, at(`if.branches[${i}].then`), out, place);
          reads = both(reads, both(c.reads, t.reads));
          if (c.node === branch.condition && t.node === branch.then) return branch;
          changed = true;
          return { condition: c.node, then: t.node };
        });
        let otherwise = node.value.otherwise;
        if (otherwise.type === "some") {
          const o = this.narrow(otherwise.value as JqNode, at("if.otherwise.some"), out, place);
          reads = both(reads, o.reads);
          if (o.node !== otherwise.value) {
            changed = true;
            otherwise = some(o.node);
          }
        } else {
          // No `else` gives the input.
          reads = both(reads, out);
        }
        return { node: this.remade(node, path, { branches, otherwise }, changed), reads };
      }
      case "try": {
        // The handler's input is the error, not the filter's.
        const b = this.narrow(node.value.body, at("try.body"), out, { ...place, lenient: true });
        return { node: this.remade(node, path, { ...node.value, body: b.node }, b.node !== node.value.body), reads: b.reads };
      }
      case "label": {
        const b = this.narrow(node.value.body, at("label.body"), out, place);
        return { node: this.remade(node, path, { ...node.value, body: b.node }, b.node !== node.value.body), reads: b.reads };
      }
      case "bind": {
        // What the source gives is bound, and read as the body reads its variables: whole.
        const s = this.narrow(node.value.source, at("bind.source"), WHOLE, { ...place, rows: false });
        const b = this.narrow(node.value.body, at("bind.body"), out, place);
        const changed = s.node !== node.value.source || b.node !== node.value.body;
        return { node: this.remade(node, path, { ...node.value, body: b.node, source: s.node }, changed), reads: both(s.reads, b.reads) };
      }
      case "reduce": case "foreach": {
        // The update's input is the state; the source's outputs are bound, and read whole.
        const s = this.narrow(node.value.source, at(`${node.type}.source`), WHOLE, { ...place, rows: false });
        const i = this.narrow(node.value.init, at(`${node.type}.init`), WHOLE, { ...place, rows: false });
        const changed = s.node !== node.value.source || i.node !== node.value.init;
        return { node: this.remade(node, path, { ...node.value, init: i.node, source: s.node }, changed), reads: both(s.reads, i.reads) };
      }
      case "call": return this.call(node, path, out, place, inner);
      default:
        // `..`, an update, a `def`: the input whole, and nothing rewritten.
        return keep(WHOLE);
    }
  }

  /** A builtin's call: those that read their input's fields or elements apart, and any other, which reads it whole. */
  private call(node: Extract<JqNode, { type: "call" }>, path: string, out: Demand, place: Place, inner: Place): Narrowed {
    const { args, name } = node.value;
    const arg = (i: number, demand: Demand, where: Place): Narrowed => this.narrow(args[i]!, childPath(path, `call.args[${i}]`), demand, where);
    const call = (made: readonly Narrowed[], reads: Demand): Narrowed => {
      const changed = made.some((m, i) => m.node !== args[i]);
      return { node: this.remade(node, path, { args: made.map(m => m.node), name }, changed), reads };
    };
    // The same input as the call's, which is no dataset's rows.
    const same: Place = { ...place, rows: false };
    const key = `${name}/${args.length}`;
    if (args.length === 0 && PASS_THROUGH.has(name)) return { node, reads: out };
    switch (key) {
      case "empty/0": return { node, reads: NONE };
      case "select/1": {
        const p = arg(0, WHOLE, same);
        return call([p], both(out, p.reads));
      }
      case "first/1": case "last/1": {
        const f = arg(0, out, same);
        return call([f], f.reads);
      }
      case "limit/2": {
        const n = arg(0, WHOLE, same);
        const f = arg(1, out, same);
        return call([n, f], both(n.reads, f.reads));
      }
      case "any/2": case "all/2": {
        // The condition's input is each output of the generator.
        const c = arg(1, WHOLE, inner);
        const g = arg(0, c.reads, same);
        return call([g, c], g.reads);
      }
    }
    if (!this.arrayInput(path)) return { node, reads: WHOLE };
    switch (key) {
      case "length/0": return { node, reads: elementsOf(NONE) };
      case "first/0": case "last/0": return { node, reads: elementsOf(out) };
      case "reverse/0": return { node, reads: elementsOf(elementOf(out)) };
      case "map/1": {
        const element = elementOf(out);
        const f = arg(0, element, inner);
        const projected = place.rows ? this.project(f.node, childPath(path, "call.args[0]"), element, place) : undefined;
        return call([projected === undefined ? f : { node: projected, reads: f.reads }], elementsOf(f.reads));
      }
      case "any/1": case "all/1": {
        const f = arg(0, WHOLE, inner);
        return call([f], elementsOf(f.reads));
      }
      case "group_by/1": {
        const f = arg(0, WHOLE, inner);
        return call([f], elementsOf(both(elementOf(elementOf(out)), f.reads)));
      }
      case "sort_by/1": case "unique_by/1": {
        const f = arg(0, WHOLE, inner);
        return call([f], elementsOf(both(elementOf(out), f.reads)));
      }
      case "min_by/1": case "max_by/1": {
        const f = arg(0, WHOLE, inner);
        return call([f], elementsOf(both(out, f.reads)));
      }
      default: return { node, reads: WHOLE };
    }
  }

  /** An object's entry kept, its value narrowed to what is read of it. */
  private entry(entry: Entry, path: string, demand: Demand, place: Place): { entry: Entry; reads: Demand } {
    if (entry.value.type === "none") {
      // `{a}` reads `.a`; `{$x}` reads `$x`.
      return { entry, reads: entry.key.type === "name" ? fieldsOf(entry.key.value) : NONE };
    }
    const v = this.narrow(entry.value.value as JqNode, path, demand, place);
    return { entry: v.node === entry.value.value ? entry : { key: entry.key, value: some(v.node) } as Entry, reads: v.reads };
  }

  /** `{…}`: the fields the steps after it read, and those it cannot leave unmade. */
  private object(node: Extract<JqNode, { type: "object" }>, path: string, out: Demand, place: Place): Narrowed {
    // A computed key builds a dict, read by its keys.
    if (node.value.some(entry => entry.key.type === "computed")) return { node, reads: WHOLE };
    const wanted = out.kind === "fields" ? out.fields : out.kind === "none" ? new Set<string>() : undefined;
    let reads = NONE;
    let changed = false;
    const entries: Entry[] = [];
    node.value.forEach((entry, i) => {
      const name = entry.key.value as string;
      const valuePath = childPath(path, `object[${i}].value.some`);
      const value = entry.value.type === "some" ? entry.value.value as JqNode : undefined;
      if (wanted !== undefined && !wanted.has(name) && this.droppable(value, valuePath, place)) {
        changed = true;
        this.changed = true;
        return;
      }
      const kept = this.entry(entry, valuePath, wanted === undefined || wanted.has(name) ? WHOLE : NONE, place);
      if (kept.entry !== entry) changed = true;
      entries.push(kept.entry);
      reads = both(reads, kept.reads);
    });
    return { node: this.remade(node, path, entries, changed), reads };
  }

  /**
   * `. + {…}` on a struct, as the object of the fields read after it: the
   * input's that `{…}` does not set, then `{…}`'s, in its order.
   */
  private merged(right: Extract<JqNode, { type: "object" }>, path: string, out: Demand, place: Place): Narrowed | undefined {
    const type = this.typeOf(childPath(path, "binary.left"));
    const struct = type === undefined ? undefined : unwrap(type);
    if (struct?.type !== "Struct" || right.value.some(entry => entry.key.type === "computed")) return undefined;
    const wanted = out.kind === "fields" ? out.fields : new Set<string>();
    const set = new Set(right.value.map(entry => entry.key.value as string));
    const names = Object.keys(struct.fields as Record<string, EastType>);
    let dropped = names.some(name => !wanted.has(name) && !set.has(name));
    const entries: Entry[] = [];
    let reads = NONE;
    for (const name of names) {
      if (!wanted.has(name) || set.has(name)) continue;
      entries.push(shorthand(name));
      reads = both(reads, fieldsOf(name));
    }
    right.value.forEach((entry, i) => {
      const name = entry.key.value as string;
      const valuePath = childPath(path, `binary.right.object[${i}].value.some`);
      const value = entry.value.type === "some" ? entry.value.value as JqNode : undefined;
      if (!wanted.has(name) && this.droppable(value, valuePath, place)) {
        dropped = true;
        return;
      }
      const kept = this.entry(entry, valuePath, wanted.has(name) ? WHOLE : NONE, place);
      entries.push(kept.entry);
      reads = both(reads, kept.reads);
    });
    if (!dropped) return undefined;
    this.changed = true;
    return { node: this.made(variant("object", entries) as JqNode, path), reads };
  }

  /**
   * A stage's row work over a dataset's rows that passes them on, ending with
   * each row built of the fields the steps after it read; `undefined` when it
   * does not pass them on, or the steps after it read every field, or none
   * (`length`), and so keep no row.
   */
  private project(f: JqNode, path: string, element: Demand, place: Place): JqNode | undefined {
    if (place.lenient || element.kind !== "fields" || !passesThrough(f)) return undefined;
    const type = this.typeOf(path);
    const struct = type === undefined ? undefined : unwrap(type);
    if (struct?.type !== "Struct") return undefined;
    const names = Object.keys(struct.fields as Record<string, EastType>);
    const kept = names.filter(name => element.fields.has(name));
    if (kept.length === names.length) return undefined;
    this.changed = true;
    const object = this.made(variant("object", kept.map(shorthand)) as JqNode, path);
    return this.made(variant("pipe", { left: f, right: object }) as JqNode, path);
  }

  /**
   * The spans of a rewritten program: each node at the range of the node it
   * came from, or of the node a node the rewrite made stands for.
   *
   * @returns the spans, or `undefined` when a node has no range
   */
  spansOf(program: JqNode, original: JqNode): Map<string, JqRange> | undefined {
    const spans = this.checked.source.spans;
    const origin = new Map<object, string>();
    const indexPattern = (pattern: JqPattern, path: string): void => {
      origin.set(pattern, path);
      for (const child of jqPatternChildren(pattern)) indexPattern(child.pattern, childPath(path, child.step));
    };
    const index = (node: JqNode, path: string): void => {
      origin.set(node, path);
      for (const child of jqChildren(node)) {
        if (child.node !== undefined) index(child.node, childPath(path, child.step));
        else indexPattern(child.pattern, childPath(path, child.step));
      }
    };
    index(original, "");
    for (const [node, path] of this.from) origin.set(node, path);
    const out = new Map<string, JqRange>();
    let complete = true;
    const set = (node: object, path: string): void => {
      const from = origin.get(node);
      const range = path === "" ? { from: 0, to: this.checked.source.text.length } : from === undefined ? undefined : spans.get(from);
      if (range === undefined) complete = false;
      else out.set(path, range);
    };
    const visitPattern = (pattern: JqPattern, path: string): void => {
      set(pattern, path);
      for (const child of jqPatternChildren(pattern)) visitPattern(child.pattern, childPath(path, child.step));
    };
    const visit = (node: JqNode, path: string): void => {
      set(node, path);
      for (const child of jqChildren(node)) {
        if (child.node !== undefined) visit(child.node, childPath(path, child.step));
        else visitPattern(child.pattern, childPath(path, child.step));
      }
    };
    visit(program, "");
    return complete ? out : undefined;
  }
}

/** The programs {@link narrowRows} has narrowed, by the check it was given. */
const narrowedOf = new WeakMap<CheckJqResult, CheckJqResult>();

/**
 * Checks a program again: the same program, over the same text, against the
 * same input or another.
 *
 * @param checked - the program, checked
 * @param program - the program to check: `checked`'s, or one rewritten from it
 * @param spans - each node's range in `checked`'s text
 * @param input - the input's type
 * @returns the check, or `undefined` when it does not check to `checked`'s
 *   output type, multiplicity and reads
 *
 * @internal
 */
export function checkAgain(checked: CheckJqResult, program: JqNode, spans: ReadonlyMap<string, JqRange>, input: EastType): CheckJqResult | undefined {
  if (checked.elementType === null || checked.multiplicity === null) return undefined;
  const parsed: ParsedJq = { text: checked.source.text, program: some(program), spans, diagnostics: [] };
  const again = checkJq(parsed, input, { root: checked.source.root });
  if (again.program === null || again.elementType === null || again.diagnostics.some(d => d.severity.type === "error")) return undefined;
  if (!isTypeEqual(again.elementType, checked.elementType) || again.multiplicity !== checked.multiplicity) return undefined;
  if (again.reads.length !== checked.reads.length || again.reads.some((name, i) => name !== checked.reads[i])) return undefined;
  return again;
}

/**
 * The program a checked query runs: its rows narrowed to the fields its later
 * steps read (#1141), checked again.
 *
 * @param checked - the program as written, checked
 * @returns the narrowed program, checked; or `checked` itself, where nothing
 *   narrows or the narrowed program does not check to `checked`'s output
 *   type, multiplicity and reads
 *
 * @internal
 */
export function narrowRows(checked: CheckJqResult): CheckJqResult {
  const known = narrowedOf.get(checked);
  if (known !== undefined) return known;
  let narrowed = checked;
  const program = checked.program;
  if (program !== null && !definesAny(program)) {
    const n = new Narrower(checked);
    const { node } = n.narrow(program, "", WHOLE, { lenient: false, root: checked.source.root, rows: false });
    const spans = n.changed ? n.spansOf(node, program) : undefined;
    if (spans !== undefined) narrowed = checkAgain(checked, node, spans, checked.inputType) ?? checked;
  }
  narrowedOf.set(checked, narrowed);
  return narrowed;
}

/**
 * The fields of each row the program reads of the collection a node gives,
 * as {@link narrowRows} finds them: a re-keyed join's pieces send only those
 * (#1141).
 *
 * @param checked - the program, checked
 * @param path - the node's path: a dataset's read from the root
 * @returns the fields, or `undefined` when a row is read whole, or the
 *   program defines a function
 *
 * @internal
 */
export function rowsRead(checked: CheckJqResult, path: string): ReadonlySet<string> | undefined {
  const program = checked.program;
  if (program === null || definesAny(program)) return undefined;
  const n = new Narrower(checked);
  n.narrow(program, "", WHOLE, { lenient: false, root: checked.source.root, rows: false });
  const demand = n.demands.get(path);
  if (demand?.kind !== "elements") return undefined;
  const element = demand.element;
  return element.kind === "fields" ? element.fields : element.kind === "none" ? new Set() : undefined;
}
