/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The tool the viewer holds on a Plan, and the link kind Connect draws (#1541,
 * U10): the viewer's, held in the UI store under the Plan's `id`
 * (`planKeys(id).tools`) as an East value, as the Schematic keeps its tools
 * (`schematic/tools.ts`) — so a remount keeps them, and two Plans of one `id`
 * hold one tool. Until the viewer picks, Select; Connect draws the first link
 * kind its Plan edits.
 *
 * - **Select** — the canvas's gestures as they are: an event is selected,
 *   moved and resized.
 * - **Connect** — shown while a link kind is editable: a drag from an event to
 *   another draws a link of the kind its menu chose, in place of moving it.
 *
 * Connect over no editable link kind is held as Select; a link kind no longer
 * editable, as the first that is.
 *
 * @packageDocumentation
 */

import { NullType, OptionType, StringType, StructType, VariantType, type ValueTypeOf } from "@elaraai/east";
import { useHeldTools, type HeldTools } from "../../shared/held-tools.js";
import { storedCodec } from "../../shared/stored-value.js";

/** A tool, as the UI store holds it. */
export const PlanToolType = VariantType({ select: NullType, connect: NullType });

/** The tools' state, as the UI store holds it: the tool, and the link kind Connect draws, by its slot. */
export const PlanToolsType = StructType({ tool: PlanToolType, link: OptionType(StringType) });

/** A tool, by its name. */
export type PlanTool = ValueTypeOf<typeof PlanToolType>["type"];

/** Every tool, in the toolbar's order. */
export const PLAN_TOOLS: readonly PlanTool[] = ["select", "connect"];

const toolsCodec = storedCodec(PlanToolsType);

/** What the viewer holds: the tool, and the link kind Connect draws. */
export type PlanToolsState = HeldTools<PlanTool>;

/**
 * What the viewer holds, as the Plan offers it: Connect over no editable link
 * kind is Select, and a link kind it does not edit is the first it does.
 *
 * @param held - What the store holds
 * @param links - The editable link kinds, by their slots, in the order the Plan lists them
 * @returns The tool and the link kind in force
 */
export function planToolsInForce(held: PlanToolsState, links: readonly string[]): PlanToolsState {
    const tool = held.tool === "connect" && links.length === 0 ? "select" : held.tool;
    const link = held.link !== undefined && links.includes(held.link) ? held.link : links[0];
    return { tool, link };
}

/**
 * The tools the viewer holds under a key, and how to pick another tool or link
 * kind: a write every Plan under that key follows (see the module docs).
 *
 * @param key - The Plan's tools key (`planKeys(id).tools`)
 * @returns What the store holds — Select and no link kind until the viewer picks — and the write that picks
 */
export function usePlanTools(key: string): [PlanToolsState, (next: PlanToolsState) => void] {
    return useHeldTools<PlanTool>(toolsCodec, key, "select");
}
