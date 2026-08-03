/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    ArrayType,
    BooleanType,
    East,
    OptionType,
    StringType,
    StructType,
    none,
    some,
    variant,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import {
    ConfiguratorSpecType,
    ConfiguratorStyleType,
    type ConfiguratorStyle,
} from "./types.js";

export {
    ConfiguratorSpecType,
    ConfiguratorStyleType,
    type ConfiguratorStyle,
} from "./types.js";

/**
 * One row of the control table.
 *
 * @remarks
 * Build these with {@link Configurator.Control} rather than by hand — the
 * `value` field is what the spec column reads, so constructing the struct
 * directly is the easiest way to let the two drift apart.
 *
 * @property label - Row label, rendered in the left gutter
 * @property value - Current value for the spec column (`none` omits the row)
 * @property control - The control itself (a SegmentGroup, Switch row, Slider, …)
 * @property hint - Secondary annotation rendered beside the control
 */
export const ConfiguratorControlType = StructType({
    label: StringType,
    value: OptionType(StringType),
    control: UIComponentType,
    hint: OptionType(StringType),
});

/**
 * Type representing {@link ConfiguratorControlType} values.
 */
export type ConfiguratorControlType = typeof ConfiguratorControlType;

/**
 * Standalone East type for `Configurator` data — mirrors the inline arm in
 * `component.ts` (which spells the child slots with the recursion `node`).
 * Used by the renderer for `ValueTypeOf` and equality.
 *
 * @property controls - The control rows, in display order
 * @property preview - The component being configured
 * @property live - Whether the preview updates live (renders the LIVE pip)
 * @property aside - Optional secondary panel beneath the preview
 * @property spec - Extra spec rows, appended after those derived from `controls`
 * @property style - Optional sizing overrides
 */
export const ConfiguratorType: StructType<{
    controls: ArrayType<ConfiguratorControlType>,
    preview: UIComponentType,
    live: BooleanType,
    aside: OptionType<StructType<{ label: StringType, body: UIComponentType }>>,
    spec: ArrayType<ConfiguratorSpecType>,
    style: OptionType<ConfiguratorStyleType>,
}> = StructType({
    controls: ArrayType(ConfiguratorControlType),
    preview: UIComponentType,
    live: BooleanType,
    aside: OptionType(StructType({ label: StringType, body: UIComponentType })),
    spec: ArrayType(ConfiguratorSpecType),
    style: OptionType(ConfiguratorStyleType),
});

/**
 * Type representing the Configurator component structure.
 */
export type ConfiguratorType = typeof ConfiguratorType;

/**
 * Options for {@link Configurator.Root}.
 */
export interface ConfiguratorOptions extends ConfiguratorStyle {
    /**
     * The control rows, in display order. The single source of truth: each row
     * renders its control AND contributes its `value` to the spec column.
     */
    controls: SubtypeExprOrValue<ArrayType<ConfiguratorControlType>>;
    /** The component being configured. */
    preview: SubtypeExprOrValue<UIComponentType>;
    /**
     * Whether the preview updates live. Renders the `LIVE` pip in the preview
     * header. Defaults to `true` — a Configurator whose preview does not react
     * is almost always a mistake.
     */
    live?: SubtypeExprOrValue<BooleanType>;
    /** Optional secondary panel beneath the preview. */
    aside?: {
        /** Section label, e.g. `"Count · Reactive"`. */
        label: SubtypeExprOrValue<StringType>;
        /** Section body. */
        body: SubtypeExprOrValue<UIComponentType>;
    };
    /**
     * Extra spec rows, appended after the ones derived from `controls`. Use for
     * state with no control row of its own — a value computed from two
     * switches, say.
     */
    spec?: SubtypeExprOrValue<ArrayType<ConfiguratorSpecType>>;
}

function buildStyle(style: ConfiguratorStyle) {
    return East.value({
        labelWidth: style.labelWidth !== undefined ? some(style.labelWidth) : none,
        sidebarWidth: style.sidebarWidth !== undefined ? some(style.sidebarWidth) : none,
        previewMinHeight: style.previewMinHeight !== undefined ? some(style.previewMinHeight) : none,
    } as any, ConfiguratorStyleType);
}

/**
 * Builds a control row for {@link Configurator.Root}.
 *
 * @param label - Row label, rendered in the left gutter
 * @param value - Current value, echoed in the spec column
 * @param control - The control component for this row
 * @param hint - Optional secondary annotation beside the control
 * @returns A control row value
 *
 * @example
 * ```ts
 * import { Configurator, SegmentGroup } from "@elaraai/east-ui";
 *
 * Configurator.Control("Density", "compact", SegmentGroup.Root(...));
 * ```
 */
function createConfiguratorControl(
    label: SubtypeExprOrValue<StringType>,
    value: SubtypeExprOrValue<StringType>,
    control: SubtypeExprOrValue<UIComponentType>,
    hint?: SubtypeExprOrValue<StringType>,
): ExprType<ConfiguratorControlType> {
    return East.value({
        label,
        value: some(value),
        control,
        hint: hint !== undefined ? some(hint) : none,
    } as any, ConfiguratorControlType);
}

/**
 * Builds a control row that contributes no spec entry.
 *
 * @param label - Row label, rendered in the left gutter
 * @param control - The control component for this row
 * @param hint - Optional secondary annotation beside the control
 * @returns A control row value with no spec contribution
 *
 * @remarks
 * For rows whose state is better described by explicit `spec` entries — a
 * `Shape` row of two switches that reports `Radius` and `Width` separately, for
 * instance.
 */
function createConfiguratorSlot(
    label: SubtypeExprOrValue<StringType>,
    control: SubtypeExprOrValue<UIComponentType>,
    hint?: SubtypeExprOrValue<StringType>,
): ExprType<ConfiguratorControlType> {
    return East.value({
        label,
        value: none,
        control,
        hint: hint !== undefined ? some(hint) : none,
    } as any, ConfiguratorControlType);
}

/**
 * Builds a spec row for the `spec` option.
 *
 * @param label - The row label
 * @param value - The current value
 * @returns A spec row value
 */
function createConfiguratorSpec(
    label: SubtypeExprOrValue<StringType>,
    value: SubtypeExprOrValue<StringType>,
): ExprType<ConfiguratorSpecType> {
    return East.value({ label, value } as any, ConfiguratorSpecType);
}

/**
 * Creates a Configurator — a labelled control table beside a live preview and a
 * derived spec readout.
 *
 * @param options - Controls, preview, live pip, optional aside, extra spec rows, and sizing
 * @returns An East expression representing the Configurator
 *
 * @remarks
 * `controls` is the single source of truth: each row renders its control and
 * contributes its `value` to the spec column, so a control and its readout
 * cannot disagree. The sidebar stacks beneath the control table on narrow
 * viewports. The rendered control column carries a collapse toggle (the Dock
 * rail chrome) so a viewer can hand its width to the preview; collapsed state
 * is a viewer preference persisted per instance by the renderer, never part of
 * this value.
 *
 * @example
 * ```ts
 * import { Configurator, SegmentGroup, Badge } from "@elaraai/east-ui";
 *
 * Configurator.Root({
 *     controls: [Configurator.Control("Variant", "outline", SegmentGroup.Root(...))],
 *     preview: Badge.Root("Sample"),
 * });
 * ```
 */
function createConfigurator(
    options: ConfiguratorOptions,
): ExprType<UIComponentType> {
    const { controls, preview, live, aside, spec, ...visual } = options;

    const hasVisual = Object.values(visual).some(field => field !== undefined);

    return East.value(variant("Configurator", {
        controls,
        preview,
        live: live !== undefined ? live : true,
        aside: aside !== undefined ? some({ label: aside.label, body: aside.body }) : none,
        spec: spec !== undefined ? spec : [],
        style: hasVisual ? some(buildStyle(visual)) : none,
    } as any), UIComponentType);
}

/**
 * Configurator — a labelled control table beside a live preview and a derived
 * spec readout.
 *
 * @remarks
 * Use `Configurator.Root({ controls, preview, ... })`; build rows with
 * `Configurator.Control` (contributes a spec entry) or `Configurator.Slot` (does
 * not). Types via `.Types`.
 */
export const Configurator = {
    /** Build a Configurator (see {@link createConfigurator}). */
    Root: createConfigurator,
    /** Build a control row that also reports its value in the spec column. */
    Control: createConfiguratorControl,
    /** Build a control row that contributes no spec entry. */
    Slot: createConfiguratorSlot,
    /** Build an extra spec row for the `spec` option. */
    Spec: createConfiguratorSpec,
    Types: {
        /** The Configurator data struct. */
        Configurator: ConfiguratorType,
        /** The control-row struct. */
        Control: ConfiguratorControlType,
        /** The spec-row struct. */
        Spec: ConfiguratorSpecType,
        /** The style sub-struct. */
        Style: ConfiguratorStyleType,
    },
} as const;
