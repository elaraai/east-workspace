/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Enforcement:
 *   - Paired icon (§0.3): this renderer via `resolvePairedIcon`
 *   - Focus ring:         Chakra default
 */

import { memo, useMemo } from "react";
import { Alert as ChakraAlert, type AlertRootProps } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Alert } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { resolvePairedIcon, type StatusToken } from "../../contracts/paired-icon.js";

// Pre-define equality function at module level
const alertEqual = equalFor(Alert.Types.Alert);

/** East Alert value type */
export type AlertValue = ValueTypeOf<typeof Alert.Types.Alert>;

/**
 * Converts an East UI Alert value to Chakra UI Alert props.
 * Pure function - easy to test independently.
 */
export function toChakraAlert(value: AlertValue): AlertRootProps {
    return {
        status: value.status.type,
        variant: getSomeorUndefined(value.variant)?.type,
    };
}

/**
 * Maps Chakra's Alert status vocabulary (`info|warning|success|error`) to the
 * east-ui `StatusToken` vocabulary (`info|warning|success|danger|neutral`).
 * Chakra's `error` corresponds to east-ui's `danger`.
 */
function toStatusToken(chakraStatus: AlertRootProps["status"]): StatusToken {
    if (chakraStatus === "error") return "danger";
    if (chakraStatus === "info" || chakraStatus === "warning" || chakraStatus === "success") {
        return chakraStatus;
    }
    return "neutral";
}

export interface EastChakraAlertProps {
    value: AlertValue;
}

/**
 * Renders an East UI Alert value using Chakra UI Alert component.
 */
export const EastChakraAlert = memo(function EastChakraAlert({ value }: EastChakraAlertProps) {
    const props = useMemo(() => toChakraAlert(value), [value]);
    const title = useMemo(() => getSomeorUndefined(value.title), [value.title]);
    const description = useMemo(() => getSomeorUndefined(value.description), [value.description]);
    // §0.3 paired-icon — pair every status tint with an icon. `showIcon` is
    // not on AlertType yet (lands in §1.6); until then always render the icon.
    const icon = useMemo(() => resolvePairedIcon(toStatusToken(props.status)), [props.status]);

    return (
        <ChakraAlert.Root {...props}>
            {icon && (
                <ChakraAlert.Indicator>
                    <FontAwesomeIcon icon={icon} />
                </ChakraAlert.Indicator>
            )}
            <ChakraAlert.Content>
                {title && <ChakraAlert.Title>{title}</ChakraAlert.Title>}
                {description && <ChakraAlert.Description>{description}</ChakraAlert.Description>}
            </ChakraAlert.Content>
        </ChakraAlert.Root>
    );
}, (prev, next) => alertEqual(prev.value, next.value));
