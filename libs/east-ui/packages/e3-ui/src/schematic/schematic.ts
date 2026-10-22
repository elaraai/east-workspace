/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Schematic>` (#1386) — the tag: the drawing's kinds over the app's records
 * (`Schematic.items`, `zones`, `links` and `nets`, each by slot), its layers,
 * its narrowing through one `Slice.bindRecords`, its library's tabs and its
 * inspector. Its payload and every refusal are `payload.ts`'s, its kinds'
 * `kinds.ts`'s, and its library's tabs and their refusals `library.ts`'s.
 *
 * @packageDocumentation
 */

import type { UIElement } from "@elaraai/east-ui";
import { SchematicComponent, createSchematicPayload, type SchematicProps } from "./payload.js";

/**
 * `<Schematic extent={{ width, height }} items={{ racks: Schematic.items(record, { … }) }} />`
 * — the drawing of the app's records: its items, zones, links and nets, each
 * kind's fields mapped to the Schematic's roles (§1).
 *
 * @param props - The Schematic's props ({@link SchematicProps})
 * @returns The Schematic: the `Schematic` carrier over its payload
 */
export function SchematicTag(props: SchematicProps): UIElement {
    return SchematicComponent.Root(createSchematicPayload(props));
}

/** The type of `<Schematic>` as a tag. */
export type SchematicTagType = typeof SchematicTag;
