/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback, type ReactNode } from "react";
import {
    Box as ChakraBox,
    CloseButton as ChakraCloseButton,
    useRecipe,
    useSlotRecipe,
    type SystemStyleObject,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition, IconName, IconPrefix } from "@fortawesome/fontawesome-common-types";
import { faCircleExclamation, faTriangleExclamation, faXmark } from "@fortawesome/free-solid-svg-icons";
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

/**
 * A banner's tone: the Banner's statuses, and the Elara tone (#1409) a host
 * renderer's own banner takes — what a run of the app's optimiser says when
 * it lands, a 1 px `elara.ink` edge over a 6% `elara` wash.
 */
export type BannerTone = BannerValue["status"]["type"] | "elara";

/** A tone of the banner recipe: the design system's Banner card's tones, and the Elara one. */
type Tone = "guard" | "error" | "info" | "success" | "change" | "elara" | "partial" | "stale";

/* Banner status ↦ its tone in the banner recipe (the design system's Banner
 * card): a solid edge over the valence's wash for guard, error and info; a
 * dashed edge on the second paper for stale and partial data. */
const STATUS_TO_TONE: Record<BannerTone, Tone> = {
    info:     "info",
    success:  "success",
    warning:  "guard",
    error:    "error",
    neutral:  "partial",
    change:   "change",
    guard:    "guard",
    stale:    "stale",
    elara:    "elara",
};

/* A tone's own icon in the mark column; every other tone marks with its Status dot. */
const TONE_ICON: Partial<Record<Tone, IconDefinition>> = {
    guard: faTriangleExclamation,
    error: faCircleExclamation,
};

/* Banner status ↦ its mark: the icon's colour, and the solid banner's fill. A
 * mark takes the valence base, never its text step (component-rules §1). */
const STATUS_TO_MARK: Record<BannerTone, string> = {
    info:     "status.info",
    success:  "status.pos",
    warning:  "status.warn",
    error:    "status.neg",
    neutral:  "fg.muted",
    change:   "border.brand",
    guard:    "status.warn",
    stale:    "fg.muted",
    elara:    "elara.ink",
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
    /** Its status — what its layer style and icon colour say — or the Elara tone (#1409). */
    status: BannerTone;
    /** Its title. */
    title: ReactNode;
    /** Its body, under the title. */
    description?: ReactNode;
    /** Its actions, at its end. */
    actions?: ReactNode;
    /** A Font Awesome icon, before the title. */
    icon?: { prefix: string; name: string } | undefined;
    /** A mark of the host's own before the title, in the icon's place and colour — the Elara eye (#1409). */
    mark?: ReactNode;
    /** Its word, before the message: what it is, in mono capitals in the tone's text step — `Conflict`, `Stale`. */
    word?: string | undefined;
    /** A card (the default), or a band edge to edge under a frame's toolbar, qualifying the whole frame. */
    form?: "card" | "band" | undefined;
    /** Whether it speaks as it arrives — `alert` for a warning, a guard or an error, else `status`; `false` where the host's own live region says it. */
    live?: boolean | undefined;
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
 * draws with words of its own: the design system's Banner card (the `banner`
 * slot recipe), one row centred on itself. Its mark column — the host's mark,
 * the author's icon, else the tone's own icon (`triangle-exclamation` for a
 * guard, `circle-exclamation` for an error) or its 8px Status dot; its word,
 * where it has one; its title as the message, its description under it; its
 * actions and close button at its end, the close's mark Font Awesome's xmark
 * (#1263). A card by default, or a band under a frame's toolbar. Its `role` is
 * `alert` for a warning, a guard or an error and `status` otherwise, unless the host's
 * own live region says it (`live: false`).
 *
 * @param props - What it says, and how ({@link BannerViewProps})
 * @returns The banner
 */
export function BannerView({
    status, title, description, actions, icon, mark: markProp, word, form = "card", live = true, dismissible = false, onDismiss, solid = false,
    background, color, borderColor, iconColor,
}: BannerViewProps) {
    const tone = STATUS_TO_TONE[status];
    const recipe = useSlotRecipe({ key: "banner" });
    const styles = useMemo(() => recipe({ tone, form }) as Record<string, SystemStyleObject>, [recipe, tone, form]);
    const role = !live ? undefined : status === "warning" || status === "guard" || status === "error" ? "alert" : "status";
    // The close's xmark at the size Chakra's icon took in a small button.
    const closeMark = useRecipe({ key: "iconButtonMark" })({ size: "sm" });
    const own = TONE_ICON[tone];
    // The author's colours over the tone's — the full-tint banner, or any one of them.
    const root: SystemStyleObject = solid
        ? { background: background ?? STATUS_TO_MARK[status], color: color ?? "white", borderColor: borderColor ?? "transparent", "& [data-banner-title], & [data-banner-body], & [data-banner-word], & [data-banner-mark]": { color: "inherit" } }
        : { ...(background !== undefined ? { background } : {}), ...(color !== undefined ? { color, "& [data-banner-title], & [data-banner-body]": { color: "inherit" } } : {}), ...(borderColor !== undefined ? { borderColor } : {}) };

    return (
        <ChakraBox role={role} css={[styles.root, root]} data-banner-tone={tone} data-banner-form={form}>
            <ChakraBox as="span" css={[styles.mark, iconColor !== undefined && !solid ? { color: iconColor } : undefined]} data-banner-mark="" aria-hidden>
                {markProp !== undefined ? markProp
                    : icon ? <FontAwesomeIcon icon={[icon.prefix as IconPrefix, icon.name as IconName]} />
                    : own !== undefined ? <FontAwesomeIcon icon={own} />
                    : <ChakraBox as="span" css={styles.dot} />}
            </ChakraBox>
            {word !== undefined && <ChakraBox as="span" css={styles.word} data-banner-word="">{word}</ChakraBox>}
            <ChakraBox css={styles.body}>
                <ChakraBox css={styles.title} data-banner-title="">{title}</ChakraBox>
                {description !== undefined ? <ChakraBox css={styles.description} data-banner-body="">{description}</ChakraBox> : null}
            </ChakraBox>
            {(actions !== undefined || dismissible) && (
                <ChakraBox css={styles.actions}>
                    {actions}
                    {dismissible ? (
                        <ChakraCloseButton size="sm" css={closeMark} onClick={onDismiss}><FontAwesomeIcon icon={faXmark} /></ChakraCloseButton>
                    ) : null}
                </ChakraBox>
            )}
        </ChakraBox>
    );
}
