/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Enforcement:
 *   - Rich label + align (§1.2): this renderer
 */

import { memo, useMemo } from "react";
import { Separator as ChakraSeparator, type SeparatorProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Separator } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

// Pre-define the equality function at module level
const separatorEqual = equalFor(Separator.Types.Separator);

/** East Separator value type */
export type SeparatorValue = ValueTypeOf<typeof Separator.Types.Separator>;

/**
 * Converts the non-child portion of a Separator value to Chakra Separator
 * props. `label` (rich UIComp) and `align` are handled in the component
 * body — the label is rendered via `EastChakraComponent` dispatch so any
 * UIComponent shape works.
 */
export function toChakraSeparator(value: SeparatorValue): SeparatorProps {
    const style = getSomeorUndefined(value.style);
    return {
        orientation: style ? getSomeorUndefined(style.orientation)?.type : undefined,
        variant: style ? getSomeorUndefined(style.variant)?.type : undefined,
        size: style ? getSomeorUndefined(style.size)?.type : undefined,
        borderColor: style ? getSomeorUndefined(style.color) : undefined,
    };
}

export interface EastChakraSeparatorProps {
    value: SeparatorValue;
    storageKey: string;
}

/**
 * Renders an East UI Separator value using Chakra UI Separator component.
 *
 * `label` is a `UIComponentType` expression rendered inline via
 * `EastChakraComponent` dispatch. `align` biases the label position when set.
 */
export const EastChakraSeparator = memo(function EastChakraSeparator({ value, storageKey }: EastChakraSeparatorProps) {
    const props = useMemo(() => toChakraSeparator(value), [value]);
    const label = getSomeorUndefined(value.label);
    const style = getSomeorUndefined(value.style);
    const alignTag = style ? getSomeorUndefined(style.align)?.type : undefined;

    // `align` maps to flex-alignment on the separator label slot.
    // `start` biases leading-edge, `end` trailing, `center` centres.
    const justifyContent = alignTag === "start"
        ? "flex-start"
        : alignTag === "end"
            ? "flex-end"
            : alignTag === "center"
                ? "center"
                : undefined;

    return (
        <ChakraSeparator {...props} css={justifyContent ? { justifyContent } : undefined}>
            {label ? <EastChakraComponent value={label} storageKey={`${storageKey}.label`} /> : null}
        </ChakraSeparator>
    );
}, (prev, next) => separatorEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
