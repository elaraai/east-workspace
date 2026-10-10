/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { StringType, VariantType, parseFor, printFor, variant, type ValueTypeOf } from "@elaraai/east";
/** People and agencies may use the same string key without colliding in Library. */
const SourceType = VariantType({ person: StringType, agency: StringType });
const printSource = printFor(SourceType);
export const readRosterSource: (text: string) => { success: true; value: ValueTypeOf<typeof SourceType> } | { success: false } = parseFor(SourceType);
export const rosterSourceKey = (type: "person" | "agency", key: string) => printSource(variant(type, key));
