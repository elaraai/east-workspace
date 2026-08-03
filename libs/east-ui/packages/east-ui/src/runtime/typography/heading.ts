/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Typography tag for headings — page titles, section headers, and any
 * larger display type that should sit above body text in the visual and
 * semantic hierarchy.
 */

import { Heading as HeadingFactory } from "../../typography/heading/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/**
 * Heading — a titled run of display type. Use it for page and section
 * titles; pick the level with `as` (`h1`…`h6`) for document semantics and
 * the size with `textStyle` (`display-*` for hero titles, `heading-*` for
 * section heads). The heading text is the child; every option is a flat
 * prop ({@link HeadingStyle}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Heading, UIComponentType } from "@elaraai/east-ui";
 *
 * const title = East.function([], UIComponentType, _$ => (
 *     <Heading as="h1" textStyle="display-md" color="fg.default" textAlign="center">
 *         Welcome to East UI
 *     </Heading>
 * ));
 * ```
 *
 * @remarks
 * Carries `Heading.Types` — the East data type and style struct. Desugars
 * to `Heading.Root(text, options)`.
 */
export const Heading: JsxTag<ContentProps<typeof HeadingFactory.Root>> & { Types: typeof HeadingFactory.Types } =
    Object.assign(content(HeadingFactory.Root), { Types: HeadingFactory.Types });
