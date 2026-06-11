/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { CloseButton as CloseButtonFactory, type CloseButtonOptions } from "../../buttons/close-button/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/**
 * Dismiss affordance — a self-labelled "X" button for closing a dialog,
 * banner, toast, or panel. It has no visible label (the glyph is fixed),
 * so it takes no children; the `label` prop sets the accessible name and
 * every other option is a flat prop ({@link CloseButtonOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, BooleanType, NullType } from "@elaraai/east";
 * import { CloseButton, Reactive, State, UIComponentType } from "@elaraai/east-ui";
 *
 * const dismiss = East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const visible = $.let(State.bind([BooleanType], "banner_visible", true));
 *         const onClick = $.const(East.function([], NullType, $ => {
 *             $(visible.write(false));
 *         }));
 *         return <CloseButton label="Dismiss banner" onClick={onClick} variant="subtle" />;
 *     }}</Reactive>
 * ));
 * ```
 *
 * @remarks
 * Carries `CloseButton.Types`. Desugars to `CloseButton.Root(options)`.
 */
export const CloseButton: JsxTag<CloseButtonOptions> & { Types: typeof CloseButtonFactory.Types } =
    Object.assign(optionsTag(CloseButtonFactory.Root), { Types: CloseButtonFactory.Types });
