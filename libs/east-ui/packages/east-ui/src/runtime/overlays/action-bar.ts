/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<ActionBar>` tag — see the export's JSDoc. */

import { ActionBar as ActionBarFactory } from "../../overlays/action-bar/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/**
 * ActionBar — a floating bar of batch actions that appears when rows are
 * selected. Use it above a multi-select table or list to offer "delete N",
 * "archive N", "export N" without taking the user out of context. The `items`
 * array is the value prop; a selection count and label, plus `onSelect` /
 * `onOpenChange` callbacks, are flat props ({@link ActionBarStyle}). Build the
 * items with the `ActionBar.Action` / `ActionBar.Separator` factories from
 * `@elaraai/east-ui/internal`.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { ActionBar, UIComponentType } from "@elaraai/east-ui";
 * import { ActionBar as ActionBarItems } from "@elaraai/east-ui/internal";
 *
 * const bar = East.function([], UIComponentType, _$ => (
 *     <ActionBar
 *         selectionCount={5n}
 *         selectionLabel="items selected"
 *         items={[
 *             ActionBarItems.Action("delete", "Delete"),
 *             ActionBarItems.Separator(),
 *             ActionBarItems.Action("archive", "Archive"),
 *         ]}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `ActionBar.Types` — the East data type, the style struct, and
 * `ActionBar.Types.Item` (the action/separator variant). The `items` array is
 * the value prop. Desugars to `ActionBar.Root(items, options)`.
 */
export const ActionBar: JsxTag<ValueProps<typeof ActionBarFactory.Root, "items">> & { Types: typeof ActionBarFactory.Types } =
    Object.assign(leaf(ActionBarFactory.Root, "items"), { Types: ActionBarFactory.Types });
