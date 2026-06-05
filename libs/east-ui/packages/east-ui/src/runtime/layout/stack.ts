/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Stack>` / `<VStack>` / `<HStack>` tags — see each export's JSDoc.
 */

import { Stack as StackFactory } from "../../layout/stack/index.js";
import { container, type ContainerProps, type JsxTag } from "../combinators.js";

/**
 * Stacks children along one axis with uniform spacing between them. The
 * direction is explicit — set `direction` to `row` or `column` — making this
 * the base for the axis-locked {@link VStack} / {@link HStack} shorthands. Use
 * it when you want even `gap` between items plus `align`/`justify` and the
 * box-model props ({@link StackStyle}); children are the JSX children.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Stack, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const list = East.function([], UIComponentType, _$ => (
 *     <Stack direction="column" gap="3">
 *         <Text>First item</Text>
 *         <Text>Second item</Text>
 *         <Text>Third item</Text>
 *     </Stack>
 * ));
 * ```
 *
 * @remarks
 * Carries `Stack.Types` — the East data type and the style struct. Desugars to
 * `Stack.Root(children, options)`.
 */
export const Stack: JsxTag<ContainerProps<typeof StackFactory.Root>> & { Types: typeof StackFactory.Types } =
    Object.assign(container(StackFactory.Root), { Types: StackFactory.Types });

/**
 * A vertical stack — children flow top-to-bottom with a uniform `gap`. The
 * direction-locked shorthand for `<Stack direction="column">`; reach for it
 * for forms, lists, and any column of stacked content. `align`/`justify`,
 * `wrap`, `gap` and the box-model props are flat ({@link StackStyle}); children
 * are the JSX children.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { VStack, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const stacked = East.function([], UIComponentType, _$ => (
 *     <VStack gap="3" align="stretch" padding="4" background="green.50">
 *         <Text>Full width item 1</Text>
 *         <Text>Full width item 2</Text>
 *     </VStack>
 * ));
 * ```
 *
 * @remarks
 * Carries `Stack.Types` — the shared Stack data type and style struct. Desugars
 * to `Stack.VStack(children, options)`.
 */
export const VStack: JsxTag<ContainerProps<typeof StackFactory.VStack>> & { Types: typeof StackFactory.Types } =
    Object.assign(container(StackFactory.VStack), { Types: StackFactory.Types });

/**
 * A horizontal stack — children flow left-to-right with a uniform `gap`. The
 * direction-locked shorthand for `<Stack direction="row">`; reach for it for
 * toolbars, nav rows, chip clusters, and inline label/value pairs. `justify`
 * (e.g. `space-between`), `align`, `wrap`, `gap` and the box-model props are
 * flat ({@link StackStyle}); children are the JSX children.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { HStack, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const navbar = East.function([], UIComponentType, _$ => (
 *     <HStack gap="4" justify="space-between" align="center" padding="4" width="100%">
 *         <Text>Logo</Text>
 *         <HStack gap="4">
 *             <Text>Home</Text>
 *             <Text>About</Text>
 *             <Text>Contact</Text>
 *         </HStack>
 *     </HStack>
 * ));
 * ```
 *
 * @remarks
 * Carries `Stack.Types` — the shared Stack data type and style struct. Desugars
 * to `Stack.HStack(children, options)`.
 */
export const HStack: JsxTag<ContainerProps<typeof StackFactory.HStack>> & { Types: typeof StackFactory.Types } =
    Object.assign(container(StackFactory.HStack), { Types: StackFactory.Types });
