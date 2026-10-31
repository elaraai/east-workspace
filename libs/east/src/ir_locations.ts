/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { isVariant, variant } from "./containers/variant.js";
import type { IR } from "./ir.js";

/**
 * The IR with every `loc_id` — each node's, each loop label's, each variable's —
 * replaced by what `f` gives for it, in one walk of the IR.
 *
 * @remarks
 * A loc_id names a stack in a source map, so an IR moved to another map has
 * each one replaced by where its stack stands there: as a link embeds an
 * imported function in its importer's map, and as an encode writes a closure
 * of another program into a blob's. Each node is rebuilt once, so a node the IR
 * shares — a parameter its body reads — stays shared. Types hold no locations,
 * and a Value node's value is data: both are kept as they stand.
 *
 * @param ir - The IR
 * @param f - The loc_id an id becomes; asked in the walk's order, which is the
 *   order the IR's nodes and their fields stand in
 * @returns The IR with its loc_ids replaced
 */
export function mapLocIds(ir: IR, f: (id: bigint) => bigint): IR {
  const done = new Map<object, unknown>();
  // A struct inside a node — a label, a case, a field, an entry — holds
  // child nodes and, for a label, a loc_id of its own.
  const child = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(child);
    if (isVariant(item)) return node(item as IR);
    if (item === null || typeof item !== "object") return item;
    const out: Record<string, unknown> = {};
    for (const [key, sub] of Object.entries(item)) out[key] = key === "loc_id" ? f(sub as bigint) : child(sub);
    return out;
  };
  const node = (n: IR): IR => {
    const hit = done.get(n);
    if (hit !== undefined) return hit as IR;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(n.value as Record<string, unknown>)) {
      if (key === "loc_id") out[key] = f(item as bigint);
      else if (key === "type" || key === "type_parameters" || (n.type === "Value" && key === "value")) out[key] = item;
      else out[key] = child(item);
    }
    const result = variant(n.type, out) as IR;
    done.set(n, result);
    return result;
  };
  return node(ir);
}
