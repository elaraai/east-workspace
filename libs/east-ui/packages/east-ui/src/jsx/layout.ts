/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Layout JSX tags — `<Box>`, `<Stack>`, `<VStack>`, `<HStack>`. Each wraps the
 * matching layout factory; style props are flat and children are coalesced.
 */

import { Box as BoxFactory, Stack as StackFactory } from "../layout/index.js";
import { container, type ContainerProps, type Tag } from "./combinators.js";

/** `<Box>` — flexible layout container. Maps to `Box.Root`. */
export const Box: Tag<ContainerProps<typeof BoxFactory.Root>> = container(BoxFactory.Root);

/** `<Stack>` — flex stack (set `direction`). Maps to `Stack.Root`. */
export const Stack: Tag<ContainerProps<typeof StackFactory.Root>> = container(StackFactory.Root);

/** `<VStack>` — vertical stack. Maps to `Stack.VStack`. */
export const VStack: Tag<ContainerProps<typeof StackFactory.VStack>> = container(StackFactory.VStack);

/** `<HStack>` — horizontal stack. Maps to `Stack.HStack`. */
export const HStack: Tag<ContainerProps<typeof StackFactory.HStack>> = container(StackFactory.HStack);
