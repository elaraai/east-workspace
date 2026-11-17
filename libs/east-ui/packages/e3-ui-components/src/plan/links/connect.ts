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

import { NullType, OptionType, StringType, StructType, VariantType, equalFor, type ValueTypeOf } from "@elaraai/east";
import { useHeldTools, type HeldTools, type LinkChoice } from "../../shared/held-tools.js";
import { storedCodec } from "../../shared/stored-value.js";
import type { PlanLinkSource } from "../edit/event-drag.js";
import type { PlanLinkKindValue } from "./kinds.js";

/** A tool, as the UI store holds it. */
export const PlanToolType = VariantType({ select: NullType, connect: NullType });

/** The tools' state, as the UI store holds it: the tool, and the link kind Connect draws, by its slot. */
export const PlanToolsType = StructType({ tool: PlanToolType, link: OptionType(StringType) });

/** A tool, by its name. */
export type PlanTool = ValueTypeOf<typeof PlanToolType>["type"];

/** Every tool, in the toolbar's order. */
export const PLAN_TOOLS: readonly PlanTool[] = ["select", "connect"];

const toolsCodec = storedCodec(PlanToolsType);
const stringEqual = equalFor(StringType);

/** What the viewer holds: the tool, and the link kind Connect draws. */
export type PlanToolsState = HeldTools<PlanTool>;

/** No link kind Connect may draw. */
export const NO_LINK_CHOICES: readonly LinkChoice[] = [];

/** What the toolbar's tools and the inspector's Connect to… show and drive (#1541, U10): there while a link kind is editable. */
export interface PlanToolsChrome {
    /** The tools in force: the tool held, and the link kind Connect draws. */
    readonly held: PlanToolsState;
    /** The link kinds Connect may draw: the editable ones, in the order the Plan lists them. */
    readonly links: readonly LinkChoice[];
    /** Those link kinds themselves: what Connect to… reads each one's ends from. */
    readonly kinds: readonly PlanLinkKindValue[];
    /** Picks a tool, or the link kind Connect draws. */
    readonly pick: (next: PlanToolsState) => void;
    /**
     * Why a link of a kind from one event to another isn't drawn, by the rules Connect's drag is held to: its kind's
     * end, or the Plan's `canConnect`. `undefined` where it may be.
     */
    readonly refusal: (kind: PlanLinkKindValue, from: PlanLinkSource, to: string) => string | undefined;
    /** Draws it: a draft of its kind's session, one step of the history, selected. Whether it was recorded. */
    readonly draw: (kind: PlanLinkKindValue, from: PlanLinkSource, to: string) => boolean;
    /** The template the library holds for each link kind, by the kind's slot: its key. A link drawn takes its values. */
    readonly templates: ReadonlyMap<string, string>;
    /** Holds a link kind's template — or, held already, lets it go. */
    readonly holdTemplate: (slot: string, key: string) => void;
}

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
    const kept = held.link;
    const link = kept !== undefined && links.some((one) => stringEqual(one, kept)) ? kept : links[0];
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
