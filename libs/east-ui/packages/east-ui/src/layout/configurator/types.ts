/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StringType,
    StructType,
} from "@elaraai/east";

/**
 * Visual overrides for {@link Configurator}.
 *
 * @remarks
 * The layout itself (two columns, the label gutter, the row rules, the sidebar
 * sections) lives in the renderer's slot recipe — these fields only widen or
 * narrow it. Everything is optional; the recipe supplies the defaults.
 *
 * @property labelWidth - Width of the control-row label gutter (e.g. `"140px"`)
 * @property controlsWidth - Cap on the control column's width (e.g. `"340px"`); the preview column always takes the remaining width
 * @property previewMinHeight - Minimum height of the preview stage
 */
export const ConfiguratorStyleType = StructType({
    labelWidth: OptionType(StringType),
    controlsWidth: OptionType(StringType),
    previewMinHeight: OptionType(StringType),
});

/**
 * Type representing {@link ConfiguratorStyleType} values.
 */
export type ConfiguratorStyleType = typeof ConfiguratorStyleType;

/**
 * A single row of the spec readout — one label / value pair.
 *
 * @remarks
 * Most rows are derived automatically from the controls (see
 * {@link ConfiguratorControlType}); this type is what an *extra* derived row
 * looks like, for state that has no control row of its own.
 *
 * @property label - The row label, rendered muted in the spec column
 * @property value - The current value, rendered as mono emphasis
 */
export const ConfiguratorSpecType = StructType({
    label: StringType,
    value: StringType,
});

/**
 * Type representing {@link ConfiguratorSpecType} values.
 */
export type ConfiguratorSpecType = typeof ConfiguratorSpecType;

/**
 * Style options accepted by `Configurator.Root`.
 */
export interface ConfiguratorStyle {
    /** Width of the control-row label gutter (e.g. `"140px"`). */
    labelWidth?: SubtypeExprOrValue<StringType>;
    /** Cap on the control column's width (e.g. `"340px"`); the preview column always takes the remaining width. */
    controlsWidth?: SubtypeExprOrValue<StringType>;
    /** Minimum height of the preview stage. */
    previewMinHeight?: SubtypeExprOrValue<StringType>;
}
