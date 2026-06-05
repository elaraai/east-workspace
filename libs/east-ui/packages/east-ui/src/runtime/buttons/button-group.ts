/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { ButtonGroup as ButtonGroupFactory, type ButtonGroupOptions } from "../../buttons/button-group/index.js";
import { container, type JsxTag } from "../combinators.js";
import type { ContainerChildrenType } from "../children.js";

/**
 * Clusters related buttons into one visual unit — a segmented control, a
 * split button, or an attached toolbar. Set `attached` to merge children
 * into a single bordered control, or `gap` to space them apart. The
 * buttons are the children; every group-level option is a flat prop
 * ({@link ButtonGroupOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Button, ButtonGroup, UIComponentType } from "@elaraai/east-ui";
 *
 * const timescale = East.function([], UIComponentType, _$ => (
 *     <ButtonGroup attached>
 *         <Button variant="outline" size="sm">1d</Button>
 *         <Button variant="outline" size="sm">1w</Button>
 *         <Button variant="outline" size="sm">1m</Button>
 *     </ButtonGroup>
 * ));
 * ```
 *
 * @remarks
 * The group only carries group-level visuals (`attached`, `gap`,
 * `borderColor`); `variant` / `size` / `colorPalette` do not cascade —
 * set those on each child `<Button>` or `<IconButton>`. Carries
 * `ButtonGroup.Types`. Desugars to `ButtonGroup.Root(children, options)`.
 */
export const ButtonGroup: JsxTag<ButtonGroupOptions & { children?: ContainerChildrenType }> & { Types: typeof ButtonGroupFactory.Types } =
    Object.assign(container(ButtonGroupFactory.Root), { Types: ButtonGroupFactory.Types });
