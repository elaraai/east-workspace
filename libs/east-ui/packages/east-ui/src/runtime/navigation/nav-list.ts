/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Navigation `<NavList>` tag — a sectioned list of navigation links. */

import { NavList as NavListFactory } from "../../navigation/nav-list/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/**
 * Sectioned navigation list — a vertical menu grouped into labelled sections,
 * the kind that sits in a side rail. Each item carries a stable `key`, a
 * `label`, an optional leading `icon`, an optional `badge`, and an optional
 * `active` flag for the current selection. The groups are the `sections` prop;
 * the `onSelect` callback fires with the clicked item's key. Options are flat
 * props ({@link NavListStyle}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, NullType, StringType } from "@elaraai/east";
 * import { NavList, State, Reactive, UIComponentType } from "@elaraai/east-ui";
 *
 * const rail = East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const activeBind = $.let(State.bind([StringType], "nav.active", "profile"));
 *         const active = $.let(activeBind.read(), StringType);
 *         const onSelect = $.const(East.function([StringType], NullType, ($, key) => {
 *             $(activeBind.write(key));
 *         }));
 *         return (
 *             <NavList
 *                 sections={[
 *                     {
 *                         label: "Settings",
 *                         items: [
 *                             { key: "profile", label: "Profile", active: active.equals("profile") },
 *                             { key: "security", label: "Security", active: active.equals("security") },
 *                         ],
 *                     },
 *                 ]}
 *                 onSelect={onSelect}
 *             />
 *         );
 *     }}</Reactive>
 * ));
 * ```
 *
 * @remarks
 * Carries `NavList.Types` — the East data type, the section struct, and the
 * item struct. Desugars to `NavList.Root(sections, options)`.
 */
export const NavList: JsxTag<ValueProps<typeof NavListFactory.Root, "sections">> & { Types: typeof NavListFactory.Types } =
    Object.assign(leaf(NavListFactory.Root, "sections"), { Types: NavListFactory.Types });
