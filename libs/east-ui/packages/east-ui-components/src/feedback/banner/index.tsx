/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback } from "react";
import {
    Box as ChakraBox,
    HStack as ChakraHStack,
    CloseButton as ChakraCloseButton,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-common-types";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Banner } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const bannerEqual = equalFor(Banner.Types.Banner);

export type BannerValue = ValueTypeOf<typeof Banner.Types.Banner>;

export interface EastChakraBannerProps {
    value: BannerValue;
    storageKey?: string;
}

const STATUS_TO_PALETTE: Record<BannerValue["status"]["type"], { bg: string; fg: string; accent: string }> = {
    info: { bg: "blue.subtle", fg: "blue.fg", accent: "blue.solid" },
    warning: { bg: "yellow.subtle", fg: "yellow.fg", accent: "yellow.solid" },
    success: { bg: "green.subtle", fg: "green.fg", accent: "green.solid" },
    error: { bg: "red.subtle", fg: "red.fg", accent: "red.solid" },
    neutral: { bg: "gray.subtle", fg: "gray.fg", accent: "gray.solid" },
};

/**
 * Renders an East UI Banner. Composed from Box with a left accent stripe and
 * paired icon (injected in the IR factory per §0.3). `role` is `alert` for
 * warning / error and `status` otherwise.
 */
export const EastChakraBanner = memo(function EastChakraBanner({ value, storageKey }: EastChakraBannerProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const icon = useMemo(() => getSomeorUndefined(value.icon), [value.icon]);
    const description = useMemo(() => getSomeorUndefined(value.description), [value.description]);
    const actions = useMemo(() => getSomeorUndefined(value.actions), [value.actions]);
    const dismissible = getSomeorUndefined(value.dismissible) ?? false;
    const onDismissFn = useMemo(() => getSomeorUndefined(value.onDismiss), [value.onDismiss]);

    const statusTag = value.status.type;
    const palette = STATUS_TO_PALETTE[statusTag];

    const variantPreset = style ? getSomeorUndefined(style.variant)?.type : undefined;
    const color = style ? getSomeorUndefined(style.color) ?? palette.fg : palette.fg;
    const background = style ? getSomeorUndefined(style.background) ?? palette.bg : palette.bg;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
    const iconColor = style ? getSomeorUndefined(style.iconColor) ?? palette.accent : palette.accent;
    const accentColor = style ? getSomeorUndefined(style.accentColor) ?? palette.accent : palette.accent;

    const handleDismiss = useCallback(() => {
        if (onDismissFn) queueMicrotask(() => onDismissFn());
    }, [onDismissFn]);

    const role = statusTag === "warning" || statusTag === "error" ? "alert" : "status";

    const bgOverride = variantPreset === "solid" ? palette.accent : background;
    const colorOverride = variantPreset === "solid" ? "white" : color;

    return (
        <ChakraBox
            role={role}
            width="100%"
            display="flex"
            alignItems="center"
            gap="3"
            px="4"
            py="3"
            borderLeftWidth="4px"
            borderLeftColor={accentColor}
            {...(borderColor !== undefined ? { borderColor, borderWidth: "1px" } : {})}
            bg={bgOverride}
            color={colorOverride}
        >
            {icon ? (
                <ChakraBox as="span" display="inline-flex" alignItems="center" color={iconColor}>
                    <FontAwesomeIcon
                        icon={[icon.prefix as IconPrefix, icon.name as IconName]}
                        size="lg"
                    />
                </ChakraBox>
            ) : null}
            <ChakraBox flex="1">
                <ChakraBox fontWeight="semibold">
                    <EastChakraComponent
                        value={value.title}
                        storageKey={`${storageKey ?? ""}.title`}
                    />
                </ChakraBox>
                {description ? (
                    <ChakraBox fontSize="sm" opacity={0.85}>
                        <EastChakraComponent
                            value={description}
                            storageKey={`${storageKey ?? ""}.description`}
                        />
                    </ChakraBox>
                ) : null}
            </ChakraBox>
            <ChakraHStack gap="2">
                {actions ? (
                    <ChakraBox>
                        <EastChakraComponent
                            value={actions}
                            storageKey={`${storageKey ?? ""}.actions`}
                        />
                    </ChakraBox>
                ) : null}
                {dismissible ? (
                    <ChakraCloseButton size="sm" onClick={handleDismiss} />
                ) : null}
            </ChakraHStack>
        </ChakraBox>
    );
}, (prev, next) => bannerEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
