/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Switch>` tag — see the export's JSDoc.
 */

import { Switch as SwitchFactory } from "../../forms/switch/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/**
 * On/off switch — a sliding toggle for an immediate setting (notifications, dark
 * mode, a feature flag). Reach for it over a checkbox when the choice takes
 * effect at once rather than on form submit. Supports a disabled state and three
 * sizes. The boolean is the `checked` prop; the visible text is `label`.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Switch, UIComponentType } from "@elaraai/east-ui";
 *
 * const darkMode = East.function([], UIComponentType, _$ => (
 *     <Switch checked={true} label="Dark mode" />
 * ));
 * ```
 *
 * @remarks
 * Carries `Switch.Types`. Bind `checked` to state and wire `onChange` inside a
 * `<Reactive>` block for a live toggle. Desugars to `Switch.Root(checked, style)`.
 */
export const Switch: JsxTag<ValueProps<typeof SwitchFactory.Root, "checked">> & { Types: typeof SwitchFactory.Types } =
    Object.assign(leaf(SwitchFactory.Root, "checked"), { Types: SwitchFactory.Types });
