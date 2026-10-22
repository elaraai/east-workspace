/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Schematic>` tag — see the export's JSDoc. */

import { type ExprType, type SubtypeExprOrValue, ArrayType, StructType } from "@elaraai/east";
import type { UIComponentType } from "@elaraai/east-ui";
import {
    createSchematicRoot,
    type SchematicConfig,
    type RowElement,
} from "./payload.js";

/**
 * `<Schematic>` — a 2D world-coordinate canvas for placing real-world
 * entities (racks, power and cooling units, switches) in space, plus
 * annotation zones (halls, cages, hatched aisles) and key-addressed links —
 * all from flat data tables, each row mapped to its fields (see the
 * namespace's docs on `Schematic`). Renders bare like Table; identity chrome
 * is host composition.
 *
 * @remarks
 * Interaction is opt-in per channel: selection (`selectionMode`, `onSelect`,
 * `onSelectionChange`), camera (`selectZoomFocus`, `onViewportChange`),
 * drill-in (`onItemOpen`), zones (`onSelectZone`, `onZoneSelectionChange`),
 * link / net editing (`linkMode`, `onCreateLink`, `onEditLink`,
 * `onDeleteLink`, gated by `readOnly` / `readOnlyLinks`), item repositioning
 * (`onMoveItem`, gated by `readOnlyItems`), and lazy hover cards
 * (`itemHover` / `zoneHover` / `linkHover`). With no callbacks bound it is a
 * read-only picture. Desugars to `Schematic.Root(items, config)`
 * (`@elaraai/e3-ui/internal`), which returns the schematic's root through the
 * `Schematic` carrier.
 *
 * @typeParam I - The items-table input
 * @typeParam Z - The zones-table input
 * @typeParam L - The links-table input
 * @typeParam N - The nets-table input
 * @param props - The `items` table (required), and the rest of the
 *   configuration ({@link SchematicConfig}) with its `zones`, `links` and
 *   `nets` tables
 * @returns The schematic — the `Schematic` carrier over its root
 */
export function SchematicTag<
    I extends SubtypeExprOrValue<ArrayType<StructType>>,
    Z extends SubtypeExprOrValue<ArrayType<StructType>> = [],
    L extends SubtypeExprOrValue<ArrayType<StructType>> = [],
    N extends SubtypeExprOrValue<ArrayType<StructType>> = [],
>(
    props: { items: I } & SchematicConfig<RowElement<I>, RowElement<Z>, RowElement<L>, RowElement<N>> & { zones?: Z; links?: L; nets?: N },
): ExprType<UIComponentType> {
    const { items, ...config } = props;
    return createSchematicRoot(items, config as never);
}

/** The type of `<Schematic>` as a tag. */
export type SchematicTagType = typeof SchematicTag;
