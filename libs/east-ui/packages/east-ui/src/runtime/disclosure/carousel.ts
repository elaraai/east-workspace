/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Disclosure JSX tag for {@link CarouselFactory | Carousel} — a horizontal
 * slideshow of panels with optional navigation controls, indicator dots, and
 * drag-to-scroll. Use it to page through images, onboarding steps, or any set
 * of equivalent slides one (or a few) at a time.
 */

import { Carousel as CarouselFactory, type CarouselOptions } from "../../disclosure/carousel/index.js";
import { container, type JsxTag } from "../combinators.js";
import type { ContainerChildrenType } from "../children.js";

/**
 * Horizontal slideshow — each child is a slide, paged through with arrow
 * controls (`showControls`), indicator dots (`showIndicators`), or mouse drag
 * (`allowMouseDrag`). Show several slides per page with `slidesPerView`, wrap
 * around with `loop`, and listen for the active slide with `onIndexChange`.
 * Slides are the children; every other option is a flat prop
 * ({@link CarouselOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Box, Carousel, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const slideshow = East.function([], UIComponentType, _$ => (
 *     <Carousel loop={true} showControls={true} showIndicators={true}>
 *         <Box padding="8" background="bg.success.subtle"><Text>First</Text></Box>
 *         <Box padding="8" background="bg.warning.subtle"><Text>Second</Text></Box>
 *         <Box padding="8" background="bg.subtle"><Text>Third</Text></Box>
 *     </Carousel>
 * ));
 * ```
 *
 * @remarks
 * Carries `Carousel.Types` — the East data type and style struct. Desugars to
 * `Carousel.Root(slides, options)`.
 */
export const Carousel: JsxTag<CarouselOptions & { children?: ContainerChildrenType }> & { Types: typeof CarouselFactory.Types } =
    Object.assign(container(CarouselFactory.Root), { Types: CarouselFactory.Types });
