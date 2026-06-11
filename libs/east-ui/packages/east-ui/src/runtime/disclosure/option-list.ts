/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Disclosure JSX tag for {@link OptionListFactory | OptionList} — a vertical
 * list of selectable options, each with a label, optional description, and an
 * optional trailing slot. Use it for "choose one alternative" surfaces:
 * what-if scenarios, suggested actions, or a single-select picker richer than
 * a radio group.
 */

import { OptionList as OptionListFactory } from "../../disclosure/option-list/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** Option builder surfaced on the `<OptionList>` tag (mirrors the `OptionList` factory namespace). */
type OptionListBuilders = {
    Option: typeof OptionListFactory.Option;
    Types: typeof OptionListFactory.Types;
};

/**
 * Vertical list of selectable options — one is highlighted via `selectedId`,
 * and selection changes are reported through `onSelect`. Options are the
 * `options` prop, built with
 * {@link OptionListFactory.Option | OptionList.Option}, which carries each
 * label plus an optional description, trailing node, and disabled flag.
 * Remaining options follow `OptionListOptions`.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Badge, OptionList, UIComponentType } from "@elaraai/east-ui";
 *
 * const alternatives = East.function([], UIComponentType, _$ => (
 *     <OptionList
 *         selectedId="alt-1"
 *         options={[
 *             OptionList.Option("alt-1", "Keep current plan", {
 *                 description: "+£0 overtime, 2 unmet shifts",
 *                 trailing: <Badge colorPalette="gray">baseline</Badge>,
 *             }),
 *             OptionList.Option("alt-2", "Shift batch to 06:00", {
 *                 description: "−£312 overtime",
 *                 trailing: <Badge colorPalette="green">−£312</Badge>,
 *             }),
 *         ]}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `OptionList.Types` (the East data type and style struct) and the
 * {@link OptionListFactory.Option | OptionList.Option} builder — one import
 * gives both the tag and the option constructor. Desugars to
 * `OptionList.Root(options, rest)`.
 */
export const OptionList: JsxTag<ValueProps<typeof OptionListFactory.Root, "options">> & OptionListBuilders =
    Object.assign(leaf(OptionListFactory.Root, "options"), {
        Option: OptionListFactory.Option,
        Types: OptionListFactory.Types,
    });
