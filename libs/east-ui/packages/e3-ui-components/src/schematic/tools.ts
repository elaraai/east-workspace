/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The tool the viewer holds, and the link kind Connect draws (#1387, §6.1):
 * the viewer's, held in the UI store under the Schematic's `id`
 * (`schematicKeys(id).tools`) as an East value, so a remount keeps them and two
 * Schematics of one `id` hold one tool, as the Flowchart keeps its orientation.
 * Until the viewer picks, Select; Connect draws the first link kind its
 * Schematic edits.
 *
 * - **Select** — a tap selects; a drag on empty canvas pans.
 * - **Zoom box** — a drag boxes the view the camera flies into.
 * - **Marquee** — a drag boxes the items it selects.
 * - **Connect** — shown while a link kind is editable: a drag from an item to
 *   another records a link of the kind its menu chose.
 * - **Move** — shown while an item kind is editable: a drag moves an item, or
 *   the selection.
 *
 * A tool the Schematic does not offer — Connect over no editable link kind,
 * Move over no editable item kind — is held as Select; a link kind no longer
 * editable, as the first that is.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { NullType, OptionType, StringType, StructType, VariantType, decodeBeast2For, encodeBeast2For, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { StateRuntime } from "@elaraai/east-ui-components";

/** A tool, as the UI store holds it. */
export const SchematicToolType = VariantType({ select: NullType, zoom: NullType, marquee: NullType, connect: NullType, move: NullType });

/** The tools' state, as the UI store holds it: the tool, and the link kind Connect draws, by its slot. */
export const SchematicToolsType = StructType({ tool: SchematicToolType, link: OptionType(StringType) });

/** A tool, by its name. */
export type SchematicTool = ValueTypeOf<typeof SchematicToolType>["type"];

/** Every tool, in the toolbar's order. */
export const SCHEMATIC_TOOLS: readonly SchematicTool[] = ["select", "zoom", "marquee", "connect", "move"];

const encodeTools = encodeBeast2For(SchematicToolsType);
const decodeTools = decodeBeast2For(SchematicToolsType);

/** What the viewer holds: the tool, and the link kind Connect draws. */
export interface SchematicToolsState {
    /** The tool held. */
    readonly tool: SchematicTool;
    /** The link kind Connect draws, by its slot. */
    readonly link: string | undefined;
}

/** What the Schematic offers: the link kinds Connect may draw, and whether Move moves anything. */
export interface SchematicToolsOffered {
    /** The editable link kinds, by their slots, in the order the Schematic lists them. */
    readonly links: readonly string[];
    /** Whether an item kind is editable: Move is offered. */
    readonly movable: boolean;
}

/**
 * The tools the Schematic offers, in order: Select, Zoom box and Marquee
 * always; Connect over an editable link kind; Move over an editable item kind.
 *
 * @param offered - What the Schematic edits
 * @returns The tools
 */
export function offeredTools(offered: SchematicToolsOffered): SchematicTool[] {
    return SCHEMATIC_TOOLS.filter((tool) => (tool === "connect" ? offered.links.length > 0 : tool === "move" ? offered.movable : true));
}

/**
 * What the viewer holds, as the Schematic offers it: a tool it does not offer
 * is Select, and a link kind it does not edit is the first it does.
 *
 * @param held - What the store holds
 * @param offered - What the Schematic edits
 * @returns The tool and the link kind in force
 */
export function toolsInForce(held: SchematicToolsState, offered: SchematicToolsOffered): SchematicToolsState {
    const tool = offeredTools(offered).includes(held.tool) ? held.tool : "select";
    const link = held.link !== undefined && offered.links.includes(held.link) ? held.link : offered.links[0];
    return { tool, link };
}

/**
 * The tools the viewer holds under a key, and how to pick another tool or link
 * kind: a write every Schematic under that key follows (see the module docs).
 *
 * @param key - The Schematic's tools key (`schematicKeys(id).tools`)
 * @returns What the store holds — Select and no link kind until the viewer picks — and the write that picks
 */
export function useSchematicTools(key: string): [SchematicToolsState, (next: SchematicToolsState) => void] {
    const store = StateRuntime.getStore();
    const subscribe = useCallback((notify: () => void) => store.subscribe(key, notify), [store, key]);
    const snapshot = useCallback(() => store.read(key), [store, key]);
    const bytes = useSyncExternalStore(subscribe, snapshot);
    const held = useMemo((): SchematicToolsState => {
        if (bytes === undefined) return { tool: "select", link: undefined };
        const decoded = decodeTools(bytes);
        return { tool: decoded.tool.type, link: decoded.link.type === "some" ? decoded.link.value : undefined };
    }, [bytes]);
    const pick = useCallback((next: SchematicToolsState) => {
        store.write(key, encodeTools({ tool: variant(next.tool, null), link: next.link === undefined ? none : some(next.link) }));
    }, [store, key]);
    return [held, pick];
}
