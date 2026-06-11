/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Renderer-side aliases derived from the East `DecisionType` so the renderer
 * tracks any structural change to the source-of-truth type as a compile error
 * — adding a field to `DecisionType` / `DecisionOptionType` or a tag to
 * `UrgencyType` surfaces here, not as silent runtime drift.
 *
 * @packageDocumentation
 */

import type { ValueTypeOf } from '@elaraai/east';
import { DecisionType as EastDecisionType, UrgencyType as EastUrgencyType } from '@elaraai/e3-ui/internal';

/** JS-side shape of a `DecisionType` value. */
export type Decision = ValueTypeOf<typeof EastDecisionType>;

/** JS-side shape of one `DecisionOptionType` (a decision's alternative). */
export type DecisionOption = Decision['alternatives'][number];

/** JS string-union of every `UrgencyType` variant tag. */
export type UrgencyKind = ValueTypeOf<typeof EastUrgencyType>['type'];

/** Queue sort weight — overdue first, routine last. */
export const URGENCY_RANK: Record<UrgencyKind, number> = {
    overdue: 0,
    due: 1,
    routine: 2,
};
