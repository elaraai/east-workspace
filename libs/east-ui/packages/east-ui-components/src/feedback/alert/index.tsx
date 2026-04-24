/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Enforcement:
 *   - Paired icon (§0.3): injected in the Alert IR factory, rendered here via FontAwesome.
 *   - Focus ring: Chakra default on the close button.
 */

import { memo, useMemo, useCallback } from "react";
import {
    Alert as ChakraAlert,
    type AlertRootProps,
    Box as ChakraBox,
    CloseButton as ChakraCloseButton,
    HStack as ChakraHStack,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-common-types";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Alert } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const alertEqual = equalFor(Alert.Types.Alert);

/** East Alert value type */
export type AlertValue = ValueTypeOf<typeof Alert.Types.Alert>;

/**
 * Map Alert status + style.variant onto Chakra Alert root props. Chakra's
 * `neutral` maps to `info` for the palette with a `data-tone="neutral"` hint.
 */
export function toChakraAlert(value: AlertValue): AlertRootProps {
    const style = getSomeorUndefined(value.style);
    const statusTag = value.status.type;
    const chakraStatus = statusTag === "neutral" ? "info" : statusTag as "info" | "warning" | "success" | "error";
    const variantPreset = style ? getSomeorUndefined(style.variant)?.type : undefined;
    return {
        status: chakraStatus,
        ...(variantPreset !== undefined ? { variant: variantPreset } : {}),
    };
}

export interface EastChakraAlertProps {
    value: AlertValue;
    storageKey?: string;
}

/**
 * Renders an East UI Alert using Chakra v3's Alert compound. Rich `title` /
 * `description` / `body` / `actions` are dispatched through `EastChakraComponent`.
 * Paired icons are injected in the IR factory (§0.3), so we just read `icon`
 * from the value and render via FontAwesome.
 */
export const EastChakraAlert = memo(function EastChakraAlert({ value, storageKey }: EastChakraAlertProps) {
    const props = useMemo(() => toChakraAlert(value), [value]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const title = useMemo(() => getSomeorUndefined(value.title), [value.title]);
    const description = useMemo(() => getSomeorUndefined(value.description), [value.description]);
    const body = useMemo(() => getSomeorUndefined(value.body), [value.body]);
    const actions = useMemo(() => getSomeorUndefined(value.actions), [value.actions]);
    const icon = useMemo(() => getSomeorUndefined(value.icon), [value.icon]);
    const closable = getSomeorUndefined(value.closable) ?? false;
    const onCloseFn = useMemo(() => getSomeorUndefined(value.onClose), [value.onClose]);

    const color = style ? getSomeorUndefined(style.color) : undefined;
    const background = style ? getSomeorUndefined(style.background) : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
    const iconColor = style ? getSomeorUndefined(style.iconColor) : undefined;

    const handleClose = useCallback(() => {
        if (onCloseFn) queueMicrotask(() => onCloseFn());
    }, [onCloseFn]);

    const isNeutral = value.status.type === "neutral";

    return (
        <ChakraAlert.Root
            {...props}
            {...(isNeutral ? { "data-tone": "neutral" } : {})}
            {...(color !== undefined ? { color } : {})}
            {...(background !== undefined ? { bg: background } : {})}
            {...(borderColor !== undefined ? { borderColor, borderWidth: "1px" } : {})}
        >
            {icon ? (
                <ChakraAlert.Indicator
                    {...(iconColor !== undefined ? { color: iconColor } : {})}
                >
                    <FontAwesomeIcon
                        icon={[icon.prefix as IconPrefix, icon.name as IconName]}
                    />
                </ChakraAlert.Indicator>
            ) : null}
            <ChakraAlert.Content flex="1">
                {title ? (
                    <ChakraAlert.Title>
                        <EastChakraComponent
                            value={title}
                            storageKey={`${storageKey ?? ""}.title`}
                        />
                    </ChakraAlert.Title>
                ) : null}
                {description ? (
                    <ChakraAlert.Description>
                        <EastChakraComponent
                            value={description}
                            storageKey={`${storageKey ?? ""}.description`}
                        />
                    </ChakraAlert.Description>
                ) : null}
                {body && body.length > 0 ? (
                    <ChakraBox mt="2">
                        {body.map((child, i) => (
                            <EastChakraComponent
                                key={i}
                                value={child}
                                storageKey={`${storageKey ?? ""}.body.${i}`}
                            />
                        ))}
                    </ChakraBox>
                ) : null}
            </ChakraAlert.Content>
            <ChakraHStack gap="2" ml="auto">
                {actions ? (
                    <ChakraBox>
                        <EastChakraComponent
                            value={actions}
                            storageKey={`${storageKey ?? ""}.actions`}
                        />
                    </ChakraBox>
                ) : null}
                {closable ? (
                    <ChakraCloseButton size="sm" onClick={handleClose} />
                ) : null}
            </ChakraHStack>
        </ChakraAlert.Root>
    );
}, (prev, next) => alertEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
