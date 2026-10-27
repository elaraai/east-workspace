/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { AnalyzedIR } from "../analyze.js";
import type { IR } from "../ir.js";
import type { RuntimeContext } from "./runtime.js";

/* Control flow as values: the compiled `return`, `continue` and `break`.
 *
 * Each gives a signal, a ControlSignal, where a value would be. A node that
 * runs statements — a block, an if/else, a match, a try/catch, a loop — or
 * gives no value of its own — a `let`, an assignment, a `return`, an error —
 * gives back a signal one of its children gives, so the signal goes up until
 * the loop or the function it is for acts on it, and nothing is thrown for
 * it. Which signals can leave a node is known before it runs (`escapesOf`),
 * so a node looks only at what a child can give, and a node no signal can
 * leave runs as it would with no control flow at all.
 *
 * A node that computes a value from its children's — a call of a function, a
 * builtin or a platform function, a constructor, a field read — has no way to
 * give a signal back, and the IR can put one under it: a `continue` in a match
 * whose value is a builtin's argument, say, as the builders can write. There
 * alone the signal is thrown (`asValue`), and the nearest node that gives
 * signals back catches it and gives it back (`asStatement`). */

/** @internal Which control statement a {@link ControlSignal} is of. */
export type ControlKind = "return" | "continue" | "break";

/**
 * @internal What a compiled closure gives in place of a value when a
 * `return`, a `continue` or a `break` leaves it.
 *
 * @remarks
 * A `continue` or a `break` gives the signal its node made as it compiled,
 * the same each time; a `return` gives a new one, holding its value. No East
 * value is a ControlSignal, so a node tells one from a value by `instanceof`.
 */
export class ControlSignal {
  /**
   * @param kind - Which control statement gave it
   * @param label - The label of the loop a `continue` or `break` names; empty for a `return`
   * @param value - The value a `return` gives; `null` for a `continue` or `break`
   */
  constructor(readonly kind: ControlKind, readonly label: string, readonly value: unknown) {}
}

/**
 * @internal The signals evaluating a node can let out of it.
 *
 * @remarks
 * A loop keeps the `continue`s and `break`s that name it, and a function every
 * `return`; a `continue` or `break` names a loop of the function it is in.
 */
export interface Escapes {
  /** Whether a `return` can leave the node. */
  readonly returns: boolean;
  /** The labels of the loops a `continue` leaving the node can name. */
  readonly continues: readonly string[];
  /** The labels of the loops a `break` leaving the node can name. */
  readonly breaks: readonly string[];
}

/** @internal What a node no signal can leave lets out: one object, so such a node is told by `===`. */
export const NO_ESCAPES: Escapes = Object.freeze({ returns: false, continues: Object.freeze([]), breaks: Object.freeze([]) });

/**
 * What can leave each node something can leave, of the IR being compiled —
 * every node not in it, nothing — from one walk of the IR
 * ({@link withControlFlow}); undefined while nothing compiles.
 */
let leaving: Map<IR, Escapes> | undefined;

/**
 * @internal Runs `compile`, the compile of `root`, knowing what can leave each
 * of its nodes.
 *
 * @remarks
 * One walk of the IR, the bodies of the functions in it included, keeps what
 * can leave each node something can leave; the compile reads it
 * ({@link escapesOf}), so the walk is all control flow costs a compile where
 * the IR has none. An IR may share a node: what can leave one is its own,
 * wherever it is. A compile may run inside another's — a platform function's
 * factory may compile a function it decodes — so the one around it is put
 * back after it.
 *
 * @typeParam T - What `compile` gives
 * @param root - The IR compiled
 * @param compile - Its compile
 * @returns What `compile` gives
 */
export function withControlFlow<T>(root: IR, compile: () => T): T {
  const around = leaving;
  const known = new Map<IR, Escapes>();
  walk(root, known);
  leaving = known;
  try {
    return compile();
  } finally {
    leaving = around;
  }
}

/**
 * @internal The signals evaluating `ir`, a node of the IR being compiled, can
 * let out of it.
 *
 * @param ir - The node
 * @returns What can leave it: {@link NO_ESCAPES} when nothing can
 * @throws {Error} When no compile is running ({@link withControlFlow})
 */
export function escapesOf(ir: IR): Escapes {
  if (leaving === undefined) throw new Error(`What can leave an IR node is known only while its compile runs, at loc_id ${ir.value.loc_id}`);
  return leaving.size === 0 ? NO_ESCAPES : leaving.get(ir) ?? NO_ESCAPES;
}

/** What can leave `ir`, from what can leave its children: each node something can leave is kept in `into`. */
function walk(ir: IR, into: Map<IR, Escapes>): Escapes {
  const escapes = walkNode(ir, into);
  if (escapes !== NO_ESCAPES) into.set(ir, escapes);
  return escapes;
}

/** What can leave a node, from what can leave its children, each walked. The commonest nodes come first. */
function walkNode(ir: IR, into: Map<IR, Escapes>): Escapes {
  switch (ir.type) {
    case "Variable":
    case "Value":
      return NO_ESCAPES;
    case "Builtin":
    case "Platform":
      return walkAll(ir.value.arguments, into);
    case "Let":
    case "Assign":
    case "As":
    case "Variant":
    case "NewRef":
    case "UnwrapRecursive":
    case "WrapRecursive":
      return walk(ir.value.value, into);
    case "Block":
      return walkAll(ir.value.statements, into);
    case "GetField":
      return walk(ir.value.struct, into);
    case "Call":
    case "CallAsync":
      return union(walk(ir.value.function, into), walkAll(ir.value.arguments, into));
    case "Struct": {
      let escapes = NO_ESCAPES;
      for (const field of ir.value.fields) escapes = union(escapes, walk(field.value, into));
      return escapes;
    }
    case "IfElse": {
      let escapes = NO_ESCAPES;
      for (const { predicate, body } of ir.value.ifs) escapes = union(union(escapes, walk(predicate, into)), walk(body, into));
      return union(escapes, walk(ir.value.else_body, into));
    }
    case "Match": {
      let escapes = walk(ir.value.variant, into);
      for (const c of ir.value.cases) escapes = union(escapes, walk(c.body, into));
      return escapes;
    }
    // A function keeps every signal its body gives: its value, or (for a
    // `continue` or `break`, which names a loop of the function it is in) its
    // error.
    case "Function":
    case "AsyncFunction":
      walk(ir.value.body, into);
      return NO_ESCAPES;
    case "NewArray":
    case "NewSet":
    case "NewVector":
    case "NewMatrix":
      return walkAll(ir.value.values, into);
    case "NewDict": {
      let escapes = NO_ESCAPES;
      for (const { key, value } of ir.value.values) escapes = union(union(escapes, walk(key, into)), walk(value, into));
      return escapes;
    }
    // A loop's predicate or collection is evaluated outside its body: what leaves one leaves the loop.
    case "ForArray":
      return union(walk(ir.value.array, into), leavingLoop(walk(ir.value.body, into), ir.value.label.name));
    case "ForDict":
      return union(walk(ir.value.dict, into), leavingLoop(walk(ir.value.body, into), ir.value.label.name));
    case "ForSet":
      return union(walk(ir.value.set, into), leavingLoop(walk(ir.value.body, into), ir.value.label.name));
    case "While":
      return union(walk(ir.value.predicate, into), leavingLoop(walk(ir.value.body, into), ir.value.label.name));
    case "TryCatch":
      return union(union(walk(ir.value.try_body, into), walk(ir.value.catch_body, into)), walk(ir.value.finally_body, into));
    case "Return":
      return withReturn(walk(ir.value.value, into));
    case "Continue":
      return { returns: false, continues: [ir.value.label.name], breaks: [] };
    case "Break":
      return { returns: false, continues: [], breaks: [ir.value.label.name] };
    case "Error":
      return walk(ir.value.message, into);
    default:
      throw new Error(`Unhandled IR type ${(ir satisfies never as IR).type}`);
  }
}

/** What can leave any of some nodes, each walked. */
function walkAll(nodes: readonly IR[], into: Map<IR, Escapes>): Escapes {
  let escapes = NO_ESCAPES;
  for (const node of nodes) escapes = union(escapes, walk(node, into));
  return escapes;
}

/** What can leave either of two nodes: one of them itself, when it holds all the other does. */
function union(a: Escapes, b: Escapes): Escapes {
  if (a === NO_ESCAPES || a === b) return b;
  if (b === NO_ESCAPES) return a;
  const returns = a.returns || b.returns;
  const continues = labels(a.continues, b.continues);
  const breaks = labels(a.breaks, b.breaks);
  if (returns === a.returns && continues === a.continues && breaks === a.breaks) return a;
  if (returns === b.returns && continues === b.continues && breaks === b.breaks) return b;
  return { returns, continues, breaks };
}

/** The labels in either list, each once: `a` itself when it holds all `b`'s. */
function labels(a: readonly string[], b: readonly string[]): readonly string[] {
  if (a.length === 0) return b;
  let both: string[] | undefined;
  for (const label of b) {
    if (!a.includes(label)) (both ??= [...a]).push(label);
  }
  return both ?? a;
}

/** What can leave a `return`: itself, and what can leave its value. */
function withReturn(escapes: Escapes): Escapes {
  return escapes.returns ? escapes : { returns: true, continues: escapes.continues, breaks: escapes.breaks };
}

/** What can leave a loop of `label` from what can leave its body: all but the `continue`s and `break`s that name the loop. */
function leavingLoop(escapes: Escapes, label: string): Escapes {
  if (escapes === NO_ESCAPES) return escapes;
  const continues = escapes.continues.filter(l => l !== label);
  const breaks = escapes.breaks.filter(l => l !== label);
  if (!escapes.returns && continues.length === 0 && breaks.length === 0) return NO_ESCAPES;
  if (continues.length === escapes.continues.length && breaks.length === escapes.breaks.length) return escapes;
  return { returns: escapes.returns, continues, breaks };
}

/**
 * @internal Whether a loop of `label` must read what its body gives: whether
 * a signal other than its own `continue` can leave the body — its own `break`,
 * a `return`, or a `continue` or `break` of a loop outside it.
 *
 * @remarks
 * A body its own `continue` leaves needs nothing done: the loop goes on to its
 * next iteration, as it would have.
 *
 * @param body - The loop's body
 * @param label - The loop's label
 * @returns Whether the loop must look at what each run of its body gives
 */
export function loopReads(body: IR, label: string): boolean {
  const escapes = escapesOf(body);
  return escapes.returns || escapes.breaks.length > 0 || escapes.continues.some(l => l !== label);
}

/**
 * @internal Whether a node gives back a signal that leaves it, rather than
 * throwing it: whether it runs statements, or gives no value of its own.
 *
 * @remarks
 * A cast, an unwrap and a wrap compile to their value's closure, so each is as
 * its value is.
 *
 * @param ir - The node
 * @returns Whether its closure gives a signal back
 */
export function givesSignals(ir: IR): boolean {
  let node = ir;
  while (node.type === "As" || node.type === "UnwrapRecursive" || node.type === "WrapRecursive") node = node.value.value;
  switch (node.type) {
    case "Block":
    case "IfElse":
    case "Match":
    case "TryCatch":
    case "While":
    case "ForArray":
    case "ForSet":
    case "ForDict":
    case "Let":
    case "Assign":
    case "Return":
    case "Continue":
    case "Break":
    case "Error":
      return true;
    default:
      return false;
  }
}

/** A compiled closure: the code a node runs, given its variables. */
type Compiled = (ctx: RuntimeContext) => any;

/**
 * @internal A child, compiled where its parent uses its value: a signal it
 * gives back is thrown, as a parent that computes a value from the child's
 * has no way to give one back.
 *
 * @param ir - The child
 * @param compiled - Its closure
 * @returns The closure, throwing a signal it gives; `compiled` itself when it can give none
 */
export function asValue(ir: AnalyzedIR, compiled: Compiled): Compiled {
  if (escapesOf(ir) === NO_ESCAPES || !givesSignals(ir)) return compiled;
  return ir.value.isAsync
    ? async (ctx: RuntimeContext) => thrownIfSignal(await compiled(ctx))
    : (ctx: RuntimeContext) => thrownIfSignal(compiled(ctx));
}

/**
 * @internal A child, compiled where its parent gives signals back: a signal
 * it throws — one a node under it that computes a value threw — is given
 * back.
 *
 * @param ir - The child
 * @param compiled - Its closure
 * @returns The closure, giving back a signal it throws; `compiled` itself when it can throw none
 */
export function asStatement(ir: AnalyzedIR, compiled: Compiled): Compiled {
  if (escapesOf(ir) === NO_ESCAPES || givesSignals(ir)) return compiled;
  return ir.value.isAsync
    ? async (ctx: RuntimeContext) => {
        try {
          return await compiled(ctx);
        } catch (e: unknown) {
          return signalOf(e);
        }
      }
    : (ctx: RuntimeContext) => {
        try {
          return compiled(ctx);
        } catch (e: unknown) {
          return signalOf(e);
        }
      };
}

/** A value, or its signal thrown. */
function thrownIfSignal(value: unknown): unknown {
  if (value instanceof ControlSignal) throw value;
  return value;
}

/** A thrown signal, given back; anything else, thrown on. */
function signalOf(e: unknown): ControlSignal {
  if (e instanceof ControlSignal) return e;
  throw e;
}

/**
 * @internal What a function gives for what its body gave: a `return`'s value
 * for its signal.
 *
 * @remarks
 * A `continue` or a `break` names a loop of the function it is in, so one that
 * leaves the body names none — IR the builders never write. It is raised at
 * the function, as it was raised at the call when control flow was thrown.
 *
 * @param body - The function's body
 * @param loc_id - The function's location, which a raised `continue` or `break` names
 * @returns The exit; undefined when no signal can leave the body, whose value is then the function's
 */
export function functionExit(body: IR, loc_id: bigint): ((given: unknown) => unknown) | undefined {
  const escapes = escapesOf(body);
  if (escapes === NO_ESCAPES) return undefined;
  if (escapes.continues.length === 0 && escapes.breaks.length === 0) {
    return (given: unknown) => given instanceof ControlSignal ? given.value : given;
  }
  return (given: unknown) => {
    if (!(given instanceof ControlSignal)) return given;
    if (given.kind === "return") return given.value;
    throw new Error(`${given.kind} failed to find label ${given.label} at loc_id ${loc_id}`);
  };
}
