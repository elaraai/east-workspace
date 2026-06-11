/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Hotkey>` tag — see the export's JSDoc. */

import { type ExprType, type SubtypeExprOrValue, type FunctionType, type NullType, StringType } from "@elaraai/east";
import { Hotkey as HotkeyFactory } from "../platform/hotkey/index.js";
import { UIComponentType } from "../component.js";

/**
 * `<Hotkey>` — a renderless keyboard-chord listener. Mounts a global
 * handler for `chord` (e.g. `"mod+k"`) and fires `onTrigger` when pressed;
 * renders nothing.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, NullType } from "@elaraai/east";
 * import { Hotkey, UIComponentType } from "@elaraai/east-ui";
 *
 * const palette = East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const trigger = $.const(East.function([], NullType, ($) => {
 *             // open the palette
 *         }));
 *         return <Hotkey chord="mod+k" onTrigger={trigger} />;
 *     }}</Reactive>
 * ));
 * ```
 *
 * @remarks
 * Desugars to `Hotkey.Root(chord, onTrigger)`.
 */
function HotkeyTag(props: {
    chord: SubtypeExprOrValue<StringType>;
    onTrigger: SubtypeExprOrValue<FunctionType<[], NullType>>;
}): ExprType<UIComponentType> {
    return HotkeyFactory.Root(props.chord, props.onTrigger);
}

export const Hotkey: typeof HotkeyTag & {
    Types: typeof HotkeyFactory.Types;
} = Object.assign(HotkeyTag, {
    Types: HotkeyFactory.Types,
});
