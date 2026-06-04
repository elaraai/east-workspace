/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Layout `<Flex>` tag — flexbox container. Maps to `Flex.Root`. */

import { Flex as FlexFactory } from "../../layout/flex/index.js";
import { container, type ContainerProps, type JsxTag } from "../combinators.js";

/** `<Flex>` — flexbox container (set `direction`/`wrap`). Maps to `Flex.Root`. */
export const Flex: JsxTag<ContainerProps<typeof FlexFactory.Root>> = container(FlexFactory.Root);
