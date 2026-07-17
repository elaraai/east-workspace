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
import { Banner } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const bannerEqual = equalFor(Banner.Types.Banner);

export type BannerValue = ValueTypeOf<typeof Banner.Types.Banner>;

export interface EastChakraBannerProps {
    value: BannerValue;
    storageKey?: string;
}

/* Banner status ↦ layerStyle (pattern_spec/spec.css `.bn.*` / `.banner.*`).
 *
 * Spec convention: 1 px coloured border surround + low-tint background,
 * **NO 4 px left-accent stripe**, mono icon glyph colour-matched to border.
 * All layer styles are declared in `theme/layer-styles.ts`. */
const STATUS_TO_LAYER: Record<BannerValue["status"]["type"], string> = {
    info:     "banner.partial",
    success:  "banner.ok",
    warning:  "banner.guard",
    error:    "banner.error",
    neutral:  "banner.partial",
    change:   "banner.change",
    guard:    "banner.guard",
    stale:    "banner.dashed.stale",
};

const STATUS_TO_FG: Record<BannerValue["status"]["type"], string> = {
    info:     "fg.info",
    success:  "fg.success",
    warning:  "fg.warning",
    error:    "fg.danger",
    neutral:  "fg.muted",
    change:   "border.brand",
    guard:    "fg.warning",
    stale:    "fg.muted",
};

/**
 * Renders an East UI Banner. Surrounded by a 1 px coloured border at very
 * low tint per pattern_spec; the title is rendered semibold inline with the
 * leading icon and the description sits below in muted body. Actions and
 * dismiss button align right. `role` is `alert` for warning / error and
 * `status` otherwise.
 *
 * @remarks
 * The left-accent-stripe layout (4 px brand-colored stripe + bright Chakra
 * `*.subtle` background) used by the previous renderer is explicitly NOT
 * spec-conformant — it has been removed. All status palettes route through
 * `banner.{stale,partial,change,error,ok}` layer styles.
 */
export const EastChakraBanner = memo(function EastChakraBanner({ value, storageKey }: EastChakraBannerProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const icon = useMemo(() => getSomeorUndefined(value.icon), [value.icon]);
    const description = useMemo(() => getSomeorUndefined(value.description), [value.description]);
    const actions = useMemo(() => getSomeorUndefined(value.actions), [value.actions]);
    const dismissible = getSomeorUndefined(value.dismissible) ?? false;
    const onDismissFn = useMemo(() => getSomeorUndefined(value.onDismiss), [value.onDismiss]);

    const statusTag = value.status.type;
    const layer = STATUS_TO_LAYER[statusTag];
    const fg = STATUS_TO_FG[statusTag];

    /* Inline overrides — every visual slot is theme-driven by default, but
     * authors can override the underlying `bg` / `borderColor` / `iconColor`
     * per banner. `variantPreset === "solid"` keeps the previous high-tint
     * affordance for callers that explicitly opt in. */
    const variantPreset = style ? getSomeorUndefined(style.variant)?.type : undefined;
    const background  = style ? getSomeorUndefined(style.background)  : undefined;
    const color       = style ? getSomeorUndefined(style.color)       : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
    const iconColor   = (style ? getSomeorUndefined(style.iconColor) : undefined) ?? fg;

    const handleDismiss = useCallback(() => {
        if (onDismissFn) queueMicrotask(() => onDismissFn());
    }, [onDismissFn]);

    const role = statusTag === "warning" || statusTag === "error" ? "alert" : "status";

    /* Solid escape hatch — full-tint banner where the brand wants visual
     * weight (e.g. promotional callouts). Skips the layerStyle. */
    const useSolid = variantPreset === "solid";

    return (
        <ChakraBox
            role={role}
            width="100%"
            display="flex"
            alignItems="flex-start"
            gap="3"
            // wrap (#349): action cluster drops below the message when the
            // banner is hosted in a compact container.
            flexWrap="wrap"
            {...(useSolid
                ? { bg: background ?? fg, color: color ?? "white", paddingX: "4", paddingY: "3", borderRadius: "2px" }
                : { layerStyle: layer, ...(background !== undefined ? { bg: background } : {}), ...(color !== undefined ? { color } : {}) }
            )}
            {...(borderColor !== undefined ? { borderColor } : {})}
        >
            {icon ? (
                <ChakraBox
                    as="span"
                    display="inline-flex"
                    alignItems="center"
                    color={useSolid ? "currentcolor" : iconColor}
                    fontSize="md"
                    flexShrink={0}
                    pt="0.5"
                >
                    <FontAwesomeIcon
                        icon={[icon.prefix as IconPrefix, icon.name as IconName]}
                        size="lg"
                    />
                </ChakraBox>
            ) : null}
            <ChakraBox flex="1" minWidth={0}>
                <ChakraBox fontWeight="semibold" fontSize="sm" lineHeight="1.4">
                    <EastChakraComponent
                        value={value.title}
                        storageKey={`${storageKey ?? ""}.title`}
                    />
                </ChakraBox>
                {description ? (
                    <ChakraBox fontSize="13px" color="fg.muted" lineHeight="1.5" mt="1">
                        <EastChakraComponent
                            value={description}
                            storageKey={`${storageKey ?? ""}.description`}
                        />
                    </ChakraBox>
                ) : null}
            </ChakraBox>
            <ChakraHStack gap="2" flexShrink={0}>
                {actions ? (
                    <ChakraBox colorPalette="brand">
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
