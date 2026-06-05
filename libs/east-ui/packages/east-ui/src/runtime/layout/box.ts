/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Layout `<Box>` tag — flexible container. Maps to `Box.Root`. */

import { Box as BoxFactory } from "../../layout/box/index.js";
import { container, type ContainerProps, type JsxTag } from "../combinators.js";

/** `<Box>` — flexible layout container. Maps to `Box.Root`. */
export const Box: JsxTag<ContainerProps<typeof BoxFactory.Root>> & { Types: typeof BoxFactory.Types } =
    Object.assign(container(BoxFactory.Root), { Types: BoxFactory.Types });
