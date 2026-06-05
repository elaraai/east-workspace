/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Disclosure `<Carousel>` tag — a sliding carousel of items. Maps to `Carousel.Root`. */

import { Carousel as CarouselFactory, type CarouselOptions } from "../../disclosure/carousel/index.js";
import { container, type JsxTag } from "../combinators.js";
import type { ContainerChildrenType } from "../children.js";

/** `<Carousel loop autoplay showControls>…items…</Carousel>` — sliding carousel. Maps to `Carousel.Root`. */
export const Carousel: JsxTag<CarouselOptions & { children?: ContainerChildrenType }> & { Types: typeof CarouselFactory.Types } =
    Object.assign(container(CarouselFactory.Root), { Types: CarouselFactory.Types });
