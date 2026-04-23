/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useState } from "react";
import { Box as ChakraBox, Button as ChakraButton } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Disclosure } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const disclosureEqual = equalFor(Disclosure.Types.Disclosure);

export type DisclosureValue = ValueTypeOf<typeof Disclosure.Types.Disclosure>;

export interface EastChakraDisclosureProps {
    value: DisclosureValue;
    storageKey?: string;
}

/**
 * Renders an East UI Disclosure (show-more) — CSS line-clamp + toggle button.
 *
 * @remarks
 * Unlike Collapsible (which hides content entirely), Disclosure clamps
 * long text to `lines` rows by default (3) and shows a "show more" link
 * that toggles to "show less" when expanded.
 */
export const EastChakraDisclosure = memo(function EastChakraDisclosure({ value, storageKey }: EastChakraDisclosureProps) {
    const [open, setOpen] = useState(false);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);

    const linesOption = getSomeorUndefined(value.lines);
    const lines = linesOption !== undefined ? Number(linesOption) : 3;
    const moreLabel = getSomeorUndefined(value.moreLabel) ?? "show more";
    const lessLabel = getSomeorUndefined(value.lessLabel) ?? "show less";

    const color = style ? getSomeorUndefined(style.color) : undefined;
    const triggerColor = style ? getSomeorUndefined(style.triggerColor) : undefined;

    return (
        <ChakraBox>
            <ChakraBox
                {...(color !== undefined ? { color } : {})}
                style={open ? undefined : {
                    display: "-webkit-box",
                    WebkitLineClamp: lines,
                    WebkitBoxOrient: "vertical" as const,
                    overflow: "hidden",
                }}
            >
                <EastChakraComponent value={value.text} storageKey={`${storageKey ?? ""}.text`} />
            </ChakraBox>
            <ChakraButton
                variant="plain"
                size="sm"
                onClick={() => setOpen(v => !v)}
                {...(triggerColor !== undefined ? { color: triggerColor } : {})}
                mt="1"
                p="0"
                fontWeight="medium"
            >
                {open ? lessLabel : moreLabel}
            </ChakraButton>
        </ChakraBox>
    );
}, (prev, next) => disclosureEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
