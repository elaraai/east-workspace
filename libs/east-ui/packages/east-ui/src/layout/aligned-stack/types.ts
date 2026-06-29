/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { type SubtypeExprOrValue, OptionType, StringType, StructType } from "@elaraai/east";

/**
 * Style for {@link AlignedStack} — a vertical stack of axis/lane components that
 * share one plot gutter. Minimal box-model knobs (the gutter is the point).
 *
 * @property gap       - Vertical spacing between stacked children (CSS length / token)
 * @property width     - Stack width (default `100%`)
 * @property height    - Stack height
 * @property minHeight - Stack min-height
 */
export const AlignedStackStyleType = StructType({
    gap:       OptionType(StringType),
    width:     OptionType(StringType),
    height:    OptionType(StringType),
    minHeight: OptionType(StringType),
});
export type AlignedStackStyleType = typeof AlignedStackStyleType;

/**
 * TS input for {@link AlignedStackStyleType}.
 *
 * @property gap       - Vertical spacing between stacked children
 * @property width     - Stack width (default `100%`)
 * @property height    - Stack height
 * @property minHeight - Stack min-height
 */
export interface AlignedStackStyle {
    /** Vertical spacing between stacked children (CSS length / token). */
    gap?: SubtypeExprOrValue<StringType>;
    /** Stack width (default `100%`). */
    width?: SubtypeExprOrValue<StringType>;
    /** Stack height. */
    height?: SubtypeExprOrValue<StringType>;
    /** Stack min-height. */
    minHeight?: SubtypeExprOrValue<StringType>;
}
