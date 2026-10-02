/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback, type ReactNode } from "react";
import {
    Box as ChakraBox,
    HStack as ChakraHStack,
    CloseButton as ChakraCloseButton,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-common-types";
import { equivalentFor, type ValueTypeOf } from "@elaraai/east";
import { Banner } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const bannerEqual = equivalentFor(Banner.Types.Banner);

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

/* Banner status ↦ its mark: the icon's colour, and the solid banner's fill. A
 * mark takes the valence base, never its text step (component-rules §1). */
const STATUS_TO_MARK: Record<BannerValue["status"]["type"], string> = {
    info:     "status.info",
    success:  "status.pos",
    warning:  "status.warn",
    error:    "status.neg",
    neutral:  "fg.muted",
    change:   "border.brand",
    guard:    "status.warn",
    stale:    "fg.muted",
};

/**
 * Renders an East UI Banner — {@link BannerView}, its `title`, `description`
 * and `actions` UIComponent slots dispatched through `EastChakraComponent`.
 */
export const EastChakraBanner = memo(function EastChakraBanner({ value, storageKey }: EastChakraBannerProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const icon = useMemo(() => getSomeorUndefined(value.icon), [value.icon]);
    const description = useMemo(() => getSomeorUndefined(value.description), [value.description]);
    const actions = useMemo(() => getSomeorUndefined(value.actions), [value.actions]);
    const onDismissFn = useMemo(() => getSomeorUndefined(value.onDismiss), [value.onDismiss]);
    const handleDismiss = useCallback(() => {
        if (onDismissFn) queueMicrotask(() => onDismissFn());
    }, [onDismissFn]);
    return (
        <BannerView
            status={value.status.type}
            icon={icon}
            dismissible={getSomeorUndefined(value.dismissible) ?? false}
            onDismiss={handleDismiss}
            solid={(style ? getSomeorUndefined(style.variant)?.type : undefined) === "solid"}
            background={style ? getSomeorUndefined(style.background) : undefined}
            color={style ? getSomeorUndefined(style.color) : undefined}
            borderColor={style ? getSomeorUndefined(style.borderColor) : undefined}
            iconColor={style ? getSomeorUndefined(style.iconColor) : undefined}
            title={<EastChakraComponent value={value.title} storageKey={`${storageKey ?? ""}.title`} />}
            description={description ? <EastChakraComponent value={description} storageKey={`${storageKey ?? ""}.description`} /> : undefined}
            actions={actions ? <EastChakraComponent value={actions} storageKey={`${storageKey ?? ""}.actions`} /> : undefined}
        />
    );
}, (prev, next) => bannerEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

/** Props of {@link BannerView}. */
export interface BannerViewProps {
    /** Its status — what its layer style and icon colour say. */
    status: BannerValue["status"]["type"];
    /** Its title. */
    title: ReactNode;
    /** Its body, under the title. */
    description?: ReactNode;
    /** Its actions, at its end. */
    actions?: ReactNode;
    /** A Font Awesome icon, before the title. */
    icon?: { prefix: string; name: string } | undefined;
    /** Whether it offers a close button. */
    dismissible?: boolean | undefined;
    /** Its close button's click. */
    onDismiss?: (() => void) | undefined;
    /** The full-tint banner, in place of the layer style. */
    solid?: boolean | undefined;
    /** Its background. */
    background?: string | undefined;
    /** Its text colour. */
    color?: string | undefined;
    /** Its border colour. */
    borderColor?: string | undefined;
    /** The icon's colour. */
    iconColor?: string | undefined;
}

/**
 * The banner as React — the Banner's renderer, and the banner a host renderer
 * draws with words of its own. Surrounded by a 1 px coloured border at very
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
 *
 * @param props - What it says, and how ({@link BannerViewProps})
 * @returns The banner
 */
export function BannerView({
    status, title, description, actions, icon, dismissible = false, onDismiss, solid = false,
    background, color, borderColor, iconColor: iconColorProp,
}: BannerViewProps) {
    const layer = STATUS_TO_LAYER[status];
    const mark = STATUS_TO_MARK[status];
    const iconColor = iconColorProp ?? mark;
    const role = status === "warning" || status === "error" ? "alert" : "status";

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
            {...(solid
                ? { bg: background ?? mark, color: color ?? "white", paddingX: "4", paddingY: "3", borderRadius: "2px" }
                : { layerStyle: layer, ...(background !== undefined ? { bg: background } : {}), ...(color !== undefined ? { color } : {}) }
            )}
            {...(borderColor !== undefined ? { borderColor } : {})}
        >
            {icon ? (
                <ChakraBox
                    as="span"
                    display="inline-flex"
                    alignItems="center"
                    color={solid ? "currentcolor" : iconColor}
                    fontSize="16px"
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
                <ChakraBox fontWeight="semibold" fontSize="body.lg" lineHeight="1.4">
                    {title}
                </ChakraBox>
                {description !== undefined ? (
                    <ChakraBox fontSize="13px" color="fg.muted" lineHeight="1.5" mt="1">
                        {description}
                    </ChakraBox>
                ) : null}
            </ChakraBox>
            <ChakraHStack gap="2" flexShrink={0}>
                {actions !== undefined ? (
                    <ChakraBox colorPalette="brand">{actions}</ChakraBox>
                ) : null}
                {dismissible ? (
                    <ChakraCloseButton size="sm" onClick={onDismiss} />
                ) : null}
            </ChakraHStack>
        </ChakraBox>
    );
}
