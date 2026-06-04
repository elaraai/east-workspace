/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Layout JSX tags — `<Box>`, `<Stack>`, `<VStack>`, `<HStack>`. Each wraps the
 * matching layout factory; style props are flat and children are coalesced.
 */

import {
    Box as BoxFactory,
    Flex as FlexFactory,
    Stack as StackFactory,
} from "../layout/index.js";
import { container, type ContainerProps, type JsxTag } from "./combinators.js";

/** `<Box>` — flexible layout container. Maps to `Box.Root`. */
export const Box: JsxTag<ContainerProps<typeof BoxFactory.Root>> = container(BoxFactory.Root);

/** `<Flex>` — flexbox container (set `direction`/`wrap`). Maps to `Flex.Root`. */
export const Flex: JsxTag<ContainerProps<typeof FlexFactory.Root>> = container(FlexFactory.Root);

/** `<Stack>` — flex stack (set `direction`). Maps to `Stack.Root`. */
export const Stack: JsxTag<ContainerProps<typeof StackFactory.Root>> = container(StackFactory.Root);

/** `<VStack>` — vertical stack. Maps to `Stack.VStack`. */
export const VStack: JsxTag<ContainerProps<typeof StackFactory.VStack>> = container(StackFactory.VStack);

/** `<HStack>` — horizontal stack. Maps to `Stack.HStack`. */
export const HStack: JsxTag<ContainerProps<typeof StackFactory.HStack>> = container(StackFactory.HStack);
