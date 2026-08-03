/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Configurator>` tag — see the export's JSDoc.
 */

import { Configurator as ConfiguratorFactory, type ConfiguratorOptions } from "../../layout/configurator/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** Row builders + types surfaced on the `<Configurator>` tag (mirrors the `Configurator` factory namespace). */
type ConfiguratorBuilders = {
    Control: typeof ConfiguratorFactory.Control;
    Slot: typeof ConfiguratorFactory.Slot;
    Spec: typeof ConfiguratorFactory.Spec;
    Types: typeof ConfiguratorFactory.Types;
};

/**
 * A labelled control table beside a live preview and a derived spec readout —
 * the canonical "change a prop, watch the component react" surface. Reach for
 * it for property inspectors, settings panels, and component demos; for a plain
 * label/value readout with no controls use {@link DataList}, and for a static
 * side-by-side enumeration use {@link Grid}.
 *
 * `controls` is the single source of truth: each row renders its control **and**
 * contributes its `value` to the spec column, so a control and its readout
 * cannot disagree. Rows built with `Configurator.Slot` render a control but
 * report nothing; `spec` appends extra rows for state derived from several
 * controls at once.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Badge, Configurator, SegmentGroup, UIComponentType } from "@elaraai/east-ui";
 *
 * const demo = East.function([], UIComponentType, _$ => (
 *     <Configurator
 *         controls={[
 *             Configurator.Control("Variant", "outline",
 *                 <SegmentGroup value="outline" items={[SegmentGroup.Item("outline", "Outline")]} />),
 *         ]}
 *         preview={<Badge variant="outline">Sample</Badge>}
 *         spec={[Configurator.Spec("Radius", "sm")]}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `Configurator.Control(label, value, control, hint?)`,
 * `Configurator.Slot(label, control, hint?)`, `Configurator.Spec(label, value)`
 * and `Configurator.Types`. The sidebar stacks beneath the control table on
 * narrow viewports. Desugars to `Configurator.Root(options)`.
 */
export const Configurator: JsxTag<ConfiguratorOptions> & ConfiguratorBuilders =
    Object.assign(optionsTag(ConfiguratorFactory.Root), {
        Control: ConfiguratorFactory.Control,
        Slot: ConfiguratorFactory.Slot,
        Spec: ConfiguratorFactory.Spec,
        Types: ConfiguratorFactory.Types,
    });
