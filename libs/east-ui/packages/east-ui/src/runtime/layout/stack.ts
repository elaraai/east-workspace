/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Layout `<Stack>`/`<VStack>`/`<HStack>` tags. Map to `Stack.Root`/`.VStack`/`.HStack`. */

import { Stack as StackFactory } from "../../layout/stack/index.js";
import { container, type ContainerProps, type JsxTag } from "../combinators.js";

/** `<Stack>` — flex stack (set `direction`). Maps to `Stack.Root`. */
export const Stack: JsxTag<ContainerProps<typeof StackFactory.Root>> & { Types: typeof StackFactory.Types } =
    Object.assign(container(StackFactory.Root), { Types: StackFactory.Types });

/** `<VStack>` — vertical stack. Maps to `Stack.VStack`. */
export const VStack: JsxTag<ContainerProps<typeof StackFactory.VStack>> & { Types: typeof StackFactory.Types } =
    Object.assign(container(StackFactory.VStack), { Types: StackFactory.Types });

/** `<HStack>` — horizontal stack. Maps to `Stack.HStack`. */
export const HStack: JsxTag<ContainerProps<typeof StackFactory.HStack>> & { Types: typeof StackFactory.Types } =
    Object.assign(container(StackFactory.HStack), { Types: StackFactory.Types });
