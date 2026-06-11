/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { IconButton as IconButtonFactory, type IconButtonOptions } from "../../buttons/icon-button/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/**
 * Compact action button showing only an icon — for toolbars, table-row
 * actions, and tight controls where a text label would crowd the layout.
 * The icon comes from the `prefix` / `name` props; there is no visible
 * label, so a `label` (accessible name) is required. Supports a loading
 * state with an optional swapped spinner icon. Every option is a flat
 * prop ({@link IconButtonOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, IntegerType, NullType } from "@elaraai/east";
 * import { IconButton, Reactive, State, UIComponentType } from "@elaraai/east-ui";
 *
 * const increment = East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const counter = $.let(State.bind([IntegerType], "icon_button_counter", 0n));
 *         const onClick = $.const(East.function([], NullType, $ => {
 *             const current = $.let(counter.read());
 *             $(counter.write(current.add(1n)));
 *         }));
 *         return <IconButton prefix="fas" name="plus" label="Increment" onClick={onClick} variant="solid" colorPalette="blue" />;
 *     }}</Reactive>
 * ));
 * ```
 *
 * @remarks
 * `loading` shows a spinner, optionally swapped via `loadingIcon`. Carries
 * `IconButton.Types`. Desugars to `IconButton.Root(options)`.
 */
export const IconButton: JsxTag<IconButtonOptions> & { Types: typeof IconButtonFactory.Types } =
    Object.assign(optionsTag(IconButtonFactory.Root), { Types: IconButtonFactory.Types });
