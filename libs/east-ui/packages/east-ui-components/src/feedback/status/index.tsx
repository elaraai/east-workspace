/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useEffect, useState } from "react";
import {
    Status as ChakraStatus,
    Box as ChakraBox,
    HStack as ChakraHStack,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-common-types";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Status } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const statusEqual = equalFor(Status.Types.Status);

export type StatusValue = ValueTypeOf<typeof Status.Types.Status>;

export interface EastChakraStatusProps {
    value: StatusValue;
    storageKey?: string;
}

const PALETTE: Record<StatusValue["value"]["type"], string> = {
    success: "green",
    warning: "yellow",
    danger: "red",
    info: "blue",
    neutral: "gray",
};

/**
 * Renders an East UI Status chip. The paired icon has already been injected
 * in the IR factory (§0.3); we just render it here. `pulsing` enables a CSS
 * keyframe on the indicator dot unless `prefers-reduced-motion: reduce`.
 */
export const EastChakraStatus = memo(function EastChakraStatus({ value, storageKey }: EastChakraStatusProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const icon = useMemo(() => getSomeorUndefined(value.icon), [value.icon]);
    const pulsing = getSomeorUndefined(value.pulsing) ?? false;

    const [reducedMotion, setReducedMotion] = useState<boolean>(false);
    useEffect(() => {
        if (typeof window === "undefined") return;
        const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        setReducedMotion(mq.matches);
        const listener = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
        mq.addEventListener("change", listener);
        return () => mq.removeEventListener("change", listener);
    }, []);

    const statusTag = value.value.type;
    const colorPalette = PALETTE[statusTag] as "green" | "yellow" | "red" | "blue" | "gray";

    const size = style ? (getSomeorUndefined(style.size)?.type as "sm" | "md" | "lg" | undefined) : undefined;
    const color = style ? getSomeorUndefined(style.color) : undefined;
    const background = style ? getSomeorUndefined(style.background) : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
    const dotColor = style ? getSomeorUndefined(style.dotColor) : undefined;

    const shouldPulse = pulsing && !reducedMotion;

    return (
        <ChakraHStack
            gap="2"
            align="center"
            display="inline-flex"
            px="2"
            py="1"
            borderRadius="md"
            whiteSpace="nowrap"
            flexShrink="0"
            {...(color !== undefined ? { color } : {})}
            {...(background !== undefined ? { bg: background } : {})}
            {...(borderColor !== undefined ? { borderColor, borderWidth: "1px" } : {})}
        >
            <ChakraStatus.Root
                colorPalette={colorPalette}
                {...(size !== undefined ? { size } : {})}
            >
                <ChakraStatus.Indicator
                    {...(dotColor !== undefined ? { bg: dotColor } : {})}
                    css={shouldPulse ? {
                        animation: "pulse 1.4s ease-in-out infinite",
                        "@keyframes pulse": {
                            "0%, 100%": { opacity: 1 },
                            "50%": { opacity: 0.4 },
                        },
                    } : undefined}
                />
            </ChakraStatus.Root>
            {icon ? (
                <ChakraBox as="span" display="inline-flex" alignItems="center">
                    <FontAwesomeIcon
                        icon={[icon.prefix as IconPrefix, icon.name as IconName]}
                    />
                </ChakraBox>
            ) : null}
            <ChakraBox>
                <EastChakraComponent
                    value={value.label}
                    storageKey={`${storageKey ?? ""}.label`}
                />
            </ChakraBox>
        </ChakraHStack>
    );
}, (prev, next) => statusEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
