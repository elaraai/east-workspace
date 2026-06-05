/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { Toggle as ToggleFactory, type ToggleOptions } from "../../buttons/toggle/index.js";
import { content, type JsxTag } from "../combinators.js";

/**
 * Two-state button that stays pressed — for binary toolbar controls like
 * bold, gridlines, or auto-refresh, where the on/off state is part of the
 * button itself. The label is the child; `pressed` drives the current
 * state and `onChange` reports the new one. Supports a leading `icon` and
 * a `pressedBackground` tint. Every option is a flat prop
 * ({@link ToggleOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, BooleanType, NullType } from "@elaraai/east";
 * import { Toggle, Reactive, State, UIComponentType } from "@elaraai/east-ui";
 *
 * const autoRefresh = East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const bind = $.let(State.bind([BooleanType], "auto_refresh", false));
 *         const pressed = $.let(bind.read());
 *         const onChange = $.const(East.function([BooleanType], NullType, ($, next) => {
 *             $(bind.write(next));
 *         }));
 *         return (
 *             <Toggle pressed={pressed} icon={{ prefix: "fas", name: "rotate" }} onChange={onChange} variant="subtle">
 *                 Auto-refresh
 *             </Toggle>
 *         );
 *     }}</Reactive>
 * ));
 * ```
 *
 * @remarks
 * Carries `Toggle.Types`. Desugars to `Toggle.Root(label, options)`.
 */
export const Toggle: JsxTag<ToggleOptions & { children: Parameters<typeof ToggleFactory.Root>[0] }> & { Types: typeof ToggleFactory.Types } =
    Object.assign(content(ToggleFactory.Root), { Types: ToggleFactory.Types });
