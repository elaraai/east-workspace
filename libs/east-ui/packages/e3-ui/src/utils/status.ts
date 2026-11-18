/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How a status shows, for every builder: its words, its tone, and whether it
 * draws as an open ring. One type, which each builder gives under its own
 * name: an event kind's status case (`Schedule.Types.Status`), an item kind's
 * (`Schematic.Types.Status`) and a Plan item's (`Plan.Types.Status`, built by
 * `Plan.status`).
 *
 * @packageDocumentation
 */

import { BooleanType, StringType, StructType } from "@elaraai/east";
import { StatusTokenType } from "@elaraai/east-ui";

/**
 * How a status shows.
 *
 * @property label - Its words
 * @property tone - Its tone: success, warning, danger, info or neutral
 * @property ring - Whether it draws as an open ring, as a tentative status does
 */
export const StatusLookType = StructType({ label: StringType, tone: StatusTokenType, ring: BooleanType });

/** Type representing {@link StatusLookType}. */
export type StatusLookType = typeof StatusLookType;
