/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Enforcement:
 *   - `position: sticky` behaviour: native CSS + this renderer
 *   - Boundary (`parent | viewport`): this renderer
 */

import { memo, useMemo } from "react";
import { Box as ChakraBox } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Sticky } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const stickyEqual = equalFor(Sticky.Types.Sticky);

/** East Sticky value type. */
export type StickyValue = ValueTypeOf<typeof Sticky.Types.Sticky>;

export interface EastChakraStickyProps {
    value: StickyValue;
    storageKey: string;
}

export const EastChakraSticky = memo(function EastChakraSticky({ value, storageKey }: EastChakraStickyProps) {
    const offset = useMemo(() => getSomeorUndefined(value.offset), [value.offset]);
    const boundaryTag = useMemo(() => getSomeorUndefined(value.boundary)?.type, [value.boundary]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const background = style ? getSomeorUndefined(style.background) : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
    const shadowColor = style ? getSomeorUndefined(style.shadowColor) : undefined;

    // `boundary: viewport` uses `position: fixed` (sticky relative to the
    // viewport rather than the nearest scroll ancestor). Most surfaces want
    // `parent` — the host app owns the viewport; east-ui lives inside the
    // content area (§0.4).
    const positionProp = boundaryTag === "viewport" ? "fixed" : "sticky";

    return (
        <ChakraBox
            position={positionProp}
            top={offset ?? "0"}
            zIndex="sticky"
            background={background}
            borderColor={borderColor}
            boxShadow={shadowColor}
        >
            <EastChakraComponent value={value.content} storageKey={`${storageKey}.content`} />
        </ChakraBox>
    );
}, (prev, next) => stickyEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
