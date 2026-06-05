/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Separator>` tag — see the export's JSDoc.
 */

import { Separator as SeparatorFactory, type SeparatorStyle } from "../../layout/separator/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/**
 * A divider line that visually separates sections. Set `orientation` to
 * `horizontal` (a rule between stacked blocks) or `vertical` (a rule between
 * inline items), pick a `variant` (subtle / strong / dashed / brand), and
 * optionally bias an embedded `label` to one edge with `align`. Self-closing
 * when bare; every option is a flat prop ({@link SeparatorStyle}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Separator, Text, VStack, UIComponentType } from "@elaraai/east-ui";
 *
 * const section = East.function([], UIComponentType, _$ => (
 *     <VStack gap="3" width="100%">
 *         <Text>Sign in with email</Text>
 *         <Separator label="OR" orientation="horizontal" variant="subtle" />
 *         <Text>Continue with social</Text>
 *     </VStack>
 * ));
 * ```
 *
 * @remarks
 * Carries `Separator.Types` — the East data type, the style struct, and the
 * variant/align enums. Desugars to `Separator.Root(options)`.
 */
export const Separator: JsxTag<SeparatorStyle> & { Types: typeof SeparatorFactory.Types } =
    Object.assign(optionsTag(SeparatorFactory.Root), { Types: SeparatorFactory.Types });
