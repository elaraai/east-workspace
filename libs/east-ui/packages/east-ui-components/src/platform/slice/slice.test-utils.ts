/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Slice configs for the tests — values of the config's own type: every field of
 * the config present, and each field's spec built with `variant()` the way
 * `Slice.config` builds it, never a hand-rolled `{ type, value }` shape.
 */

import { none, variant } from "@elaraai/east";
import type { SliceConfig } from "./index.js";

/** One field's spec in a config — a variant per kind, carrying its label, accessor and format. */
export type SliceFieldSpec = SliceConfig["fields"] extends Map<string, infer F> ? F : never;

/**
 * A String field read off the row by `get`, unlabelled and with no format.
 *
 * @param get - The accessor
 * @returns The field's spec
 */
export const stringField = (get: (r: any) => string): SliceFieldSpec => variant("string", { label: "", accessor: get, format: none });

/**
 * An Integer field read off the row by `get`, unlabelled and with no format.
 *
 * @param get - The accessor
 * @returns The field's spec
 */
export const integerField = (get: (r: any) => bigint): SliceFieldSpec => variant("integer", { label: "", accessor: get, format: none });

/**
 * A config over `fields`: no range field, nothing searched or broken down and
 * no hints, unless `rest` says otherwise.
 *
 * @param fields - The field specs, by field id
 * @param rest - The config's other fields
 * @returns The config
 */
export function sliceConfig(fields: Record<string, SliceFieldSpec>, rest: Partial<Omit<SliceConfig, "fields">> = {}): SliceConfig {
    return { fields: new Map(Object.entries(fields)), rangeFieldId: none, searchFieldIds: [], breakdownFieldIds: [], fieldHints: new Map(), ...rest };
}
