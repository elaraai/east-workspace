/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The layout document the printers write (#639): Wadler's algebra as
 * prettier and black realise it. Source is built as a tree — text, line
 * breaks, indentation, groups — and rendered once, top down: a group prints
 * on one line when its contents and what follows it on that line fit
 * {@link LINE_WIDTH}, and breaks every line of its own otherwise, its nested
 * groups then taking their own turn. So every break decision knows the
 * remaining width, the enclosing structure and what comes after — what a
 * per-bracket rule over already-printed strings cannot.
 *
 * - {@link line} is a space when its group is flat and a newline when it
 *   breaks; {@link softline} is nothing or a newline; {@link hardline} always
 *   breaks, and breaks every group around it (a block body is never flat).
 * - {@link group} is the unit of the fits-or-breaks decision; {@link indent}
 *   nests one level; {@link ifBreak} prints one of two documents by the
 *   enclosing group's state (a trailing comma).
 * - {@link choice} is prettier's conditional group: the first option that
 *   fits up to its first line break, else the last — how a call hugs a
 *   trailing callback (`xs.map(($, x) => {` stays on the line, the body
 *   breaks inside) and how a member chain decides between one line and one
 *   call per line. A choice is never itself broken by a hard line inside
 *   it, but the plain groups around it are: `$.const(xs.map(($, x) => {`
 *   breaks out to `$.const(` / the call / `)`, as prettier lays it out.
 * - {@link bracket} is a delimited, comma-separated list: one line when it
 *   fits, else one item per line with a trailing comma.
 *
 * Twin: `east/codegen/doc.py`.
 */

/** The width a line may fill before a group breaks — the repo's own linter width (ruff's `line-length`). */
export const LINE_WIDTH = 100;

/** A document: text, a concatenation (an array), or a layout node. */
export type Doc = string | Doc[] | DocNode;

export type DocNode = Line | Group | Indent | IfBreak | Choice;

interface Line { readonly kind: "line"; readonly soft: boolean; readonly hard: boolean }
interface Group { readonly kind: "group"; readonly contents: Doc; break: boolean }
interface Indent { readonly kind: "indent"; readonly contents: Doc }
interface IfBreak { readonly kind: "ifBreak"; readonly broken: Doc; readonly flat: Doc }
interface Choice { readonly kind: "choice"; readonly options: readonly Doc[] }

/** A space when the group is flat, a newline when it breaks. */
export const line: Doc = { kind: "line", soft: false, hard: false };
/** Nothing when the group is flat, a newline when it breaks. */
export const softline: Doc = { kind: "line", soft: true, hard: false };
/** Always a newline; every enclosing group breaks. */
export const hardline: Doc = { kind: "line", soft: false, hard: true };

/** The unit of layout: flat when it fits, else broken. `forceBreak` breaks it regardless. */
export function group(contents: Doc, forceBreak: boolean = false): Doc {
  return { kind: "group", contents, break: forceBreak };
}

/** One indentation level deeper for the lines inside. */
export function indent(contents: Doc): Doc {
  return { kind: "indent", contents };
}

/** `broken` when the enclosing group breaks, `flat` otherwise. */
export function ifBreak(broken: Doc, flat: Doc = ""): Doc {
  return { kind: "ifBreak", broken, flat };
}

/** The first option that fits up to its first line break; else the last. */
export function choice(...options: Doc[]): Doc {
  if (options.length === 0) throw new Error("choice needs at least one option");
  return { kind: "choice", options };
}

/** `docs` with `separator` between them. */
export function join(separator: Doc, docs: readonly Doc[]): Doc {
  const out: Doc[] = [];
  docs.forEach((d, i) => {
    if (i > 0) out.push(separator);
    out.push(d);
  });
  return out;
}

/**
 * `open` + `items` + `close`: on one line, comma-separated, when the group
 * fits; else one item per line, indented, with a trailing comma, the close
 * back at the enclosing indentation. `pad` is the space inside the flat
 * brackets (`{ a: 1 }`).
 */
export function bracket(open: string, items: readonly Doc[], close: string, pad: string = ""): Doc {
  if (items.length === 0) return open + close;
  const edge = pad === "" ? softline : line;
  return group([open, indent([edge, join([",", line], items)]), ifBreak(","), edge, close]);
}

/** Documents a call may hug: a function body, a literal (see {@link callArgs}). */
const huggable = new WeakSet<object>();

/** Marks `doc` as one a call hugs: a callback / function, or a literal. */
export function hug<T extends Doc>(doc: T): T {
  if (typeof doc !== "string") huggable.add(doc);
  return doc;
}

/** Marks `doc` as a callback / function body (huggable first as well as last). */
const functionLike = new WeakSet<object>();
/** A hugged function's form when the call expands it: a concise arrow broken after its `=>`, the close on its own line. */
const expandedForms = new WeakMap<object, Doc>();
export function fn<T extends Doc>(doc: T, expanded?: Doc): T {
  if (typeof doc !== "string") {
    huggable.add(doc);
    functionLike.add(doc);
    if (expanded !== undefined) expandedForms.set(doc, expanded);
  }
  return doc;
}

export function isHuggable(doc: Doc): boolean {
  return typeof doc !== "string" && huggable.has(doc);
}

export function isFunctionLike(doc: Doc): boolean {
  return typeof doc !== "string" && functionLike.has(doc);
}

/**
 * A call's argument list, as prettier lays one out: a trailing callback or
 * literal (or a leading function body before one short argument) is hugged
 * — `f(a, ($, x) => {` stays on the line and the body breaks inside — when
 * the head fits; otherwise one argument per line. Two trailing callbacks
 * (`ifElse(($) => a, ($) => b)`) hug neither: one per line.
 */
export function callArgs(items: readonly Doc[], hugging: boolean = true): Doc {
  if (items.length === 0) return "()";
  const broken = bracket("(", items, ")");
  if (!hugging) return broken;
  const last = items[items.length - 1]!;
  const first = items[0]!;
  const penultimate = items.length >= 2 ? items[items.length - 2]! : null;
  const flat = (parts: readonly Doc[]): Doc => ["(", join(", ", parts), ")"];
  if (isHuggable(last) && !(penultimate !== null && isHuggable(penultimate))) {
    const expanded = expandedForms.get(last as object) ?? last;
    const forced: Doc[] = [...items.slice(0, -1), group(expanded, true)];
    return choice(flat(items), flat(forced), broken);
  }
  if (items.length === 2 && isFunctionLike(first) && willBreak(first) && !isHuggable(last)) {
    return choice(flat(items), broken);
  }
  return broken;
}

/** Whether `doc` holds a hard line anywhere (a block body). */
export function willBreak(doc: Doc): boolean {
  if (typeof doc === "string") return false;
  const hit = breaks.get(doc);
  if (hit !== undefined) return hit;
  let result = false;
  if (Array.isArray(doc)) result = doc.some(willBreak);
  else if (doc.kind === "line") result = doc.hard;
  else if (doc.kind === "group" || doc.kind === "indent") result = willBreak(doc.contents);
  else if (doc.kind === "ifBreak") result = willBreak(doc.broken) || willBreak(doc.flat);
  else result = willBreak(doc.options[0]!);  // a choice's first option is what it holds; the rest are its fallbacks
  breaks.set(doc, result);
  return result;
}
const breaks = new WeakMap<object, boolean>();

/**
 * Marks every group holding a hard line as broken (a hard line never
 * prints flat). A choice is passed through, not marked: its options decide
 * for themselves, and only its first option counts for the groups around
 * it — a fallback option (a member chain expanded one call per line) holds
 * hard lines by construction and must not break the enclosing call.
 */
function propagate(doc: Doc): boolean {
  if (typeof doc === "string") return false;
  if (Array.isArray(doc)) {
    let hard = false;
    for (const d of doc) hard = propagate(d) || hard;
    return hard;
  }
  switch (doc.kind) {
    case "line": return doc.hard;
    case "indent": return propagate(doc.contents);
    case "ifBreak": {
      const a = propagate(doc.broken);
      const b = propagate(doc.flat);
      return a || b;
    }
    case "group": {
      // a hard line inside breaks the group and every group around it; a
      // group broken by construction (a hug state) breaks only itself
      const hard = propagate(doc.contents);
      if (hard) doc.break = true;
      return hard;
    }
    case "choice": {
      const first = propagate(doc.options[0]!);
      for (const o of doc.options.slice(1)) propagate(o);
      return first;
    }
  }
}

const enum Mode { Break, Flat }
type Cmd = [indent: number, mode: Mode, doc: Doc];

/**
 * Renders `doc` at `width`, `unit` being one indentation level.
 *
 * @param doc - The document
 * @param width - The line width (default {@link LINE_WIDTH}); `Infinity` prints every group flat
 * @param unit - One level of indentation (default two spaces)
 * @returns The source text
 */
export function render(doc: Doc, width: number = LINE_WIDTH, unit: string = "  "): string {
  propagate(doc);
  const out: string[] = [];
  let pos = 0;
  const cmds: Cmd[] = [[0, Mode.Break, doc]];
  while (cmds.length > 0) {
    const [ind, mode, d] = cmds.pop()!;
    if (typeof d === "string") {
      if (d.length > 0) {
        out.push(d);
        pos += d.length;
      }
      continue;
    }
    if (Array.isArray(d)) {
      for (let i = d.length - 1; i >= 0; i--) cmds.push([ind, mode, d[i]!]);
      continue;
    }
    switch (d.kind) {
      case "indent":
        cmds.push([ind + 1, mode, d.contents]);
        break;
      case "ifBreak":
        cmds.push([ind, mode, mode === Mode.Break ? d.broken : d.flat]);
        break;
      case "group": {
        if (mode === Mode.Flat && !d.break) {
          cmds.push([ind, Mode.Flat, d.contents]);
          break;
        }
        const flat: Cmd = [ind, Mode.Flat, d.contents];
        cmds.push(!d.break && fits(flat, cmds, width - pos) ? flat : [ind, Mode.Break, d.contents]);
        break;
      }
      case "choice": {
        const first = d.options[0]!;
        if (mode === Mode.Flat) {
          cmds.push([ind, Mode.Flat, first]);
          break;
        }
        const flat: Cmd = [ind, Mode.Flat, first];
        if (fits(flat, cmds, width - pos)) {
          cmds.push(flat);
          break;
        }
        let chosen = false;
        for (let i = 1; i < d.options.length - 1; i++) {
          const state: Cmd = [ind, Mode.Flat, d.options[i]!];
          if (fits(state, cmds, width - pos)) {
            cmds.push(state);
            chosen = true;
            break;
          }
        }
        if (!chosen) cmds.push([ind, Mode.Break, d.options[d.options.length - 1]!]);
        break;
      }
      case "line": {
        if (mode === Mode.Flat && !d.hard) {
          if (!d.soft) {
            out.push(" ");
            pos += 1;
          }
          break;
        }
        trimEnd(out);
        const pad = unit.repeat(ind);
        out.push("\n" + pad);
        pos = pad.length;
        break;
      }
    }
  }
  return out.join("");
}

/** Whether `next`, then what follows it up to the next line break, fits in `width` columns. */
function fits(next: Cmd, rest: Cmd[], width: number): boolean {
  let restIdx = rest.length;
  const cmds: [Mode, Doc][] = [[next[1], next[2]]];
  while (width >= 0) {
    if (cmds.length === 0) {
      if (restIdx === 0) return true;
      const r = rest[--restIdx]!;
      cmds.push([r[1], r[2]]);
      continue;
    }
    const [mode, d] = cmds.pop()!;
    if (typeof d === "string") {
      width -= d.length;
      continue;
    }
    if (Array.isArray(d)) {
      for (let i = d.length - 1; i >= 0; i--) cmds.push([mode, d[i]!]);
      continue;
    }
    switch (d.kind) {
      case "indent":
        cmds.push([mode, d.contents]);
        break;
      case "ifBreak":
        cmds.push([mode, mode === Mode.Break ? d.broken : d.flat]);
        break;
      case "group":
        cmds.push([d.break ? Mode.Break : mode, d.contents]);
        break;
      case "choice":
        cmds.push([mode, mode === Mode.Break ? d.options[d.options.length - 1]! : d.options[0]!]);
        break;
      case "line":
        if (mode === Mode.Break || d.hard) return true;
        if (!d.soft) width -= 1;
        break;
    }
  }
  return false;
}

/** Drops the spaces at the end of the line being written. */
function trimEnd(out: string[]): void {
  while (out.length > 0) {
    const last = out[out.length - 1]!;
    const trimmed = last.replace(/[ \t]+$/, "");
    if (trimmed.length === last.length) return;
    if (trimmed.length > 0) {
      out[out.length - 1] = trimmed;
      return;
    }
    out.pop();
  }
}

/** `doc` on one line: every group flat. */
export function flat(doc: Doc): string {
  return render(doc, Infinity);
}
