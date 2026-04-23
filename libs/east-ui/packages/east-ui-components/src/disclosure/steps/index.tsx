/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Steps as ChakraSteps, type StepsRootProps, Box as ChakraBox } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-common-types";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Steps } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const stepsEqual = equalFor(Steps.Types.Steps);

export type StepsValue = ValueTypeOf<typeof Steps.Types.Steps>;
type StepItemValue = StepsValue["items"][number];

/**
 * Derive visual Chakra props from the `style` sub-struct + main state.
 */
export function toChakraSteps(value: StepsValue): StepsRootProps {
    const style = getSomeorUndefined(value.style);
    const activeIndex = getSomeorUndefined(value.activeIndex);
    return {
        count: value.items.length,
        step: activeIndex !== undefined ? Number(activeIndex) : 0,
        orientation: style ? getSomeorUndefined(style.orientation)?.type : undefined,
        size: style ? (getSomeorUndefined(style.size)?.type as StepsRootProps["size"]) : undefined,
    };
}

export interface EastChakraStepsProps {
    value: StepsValue;
    storageKey?: string;
}

function statusColour(status: StepItemValue["status"]["type"], style: ValueTypeOf<typeof Steps.Types.Style> | undefined): string | undefined {
    if (!style) return undefined;
    switch (status) {
        case "pending": return getSomeorUndefined(style.pendingColor);
        case "active": return getSomeorUndefined(style.activeColor);
        case "completed": return getSomeorUndefined(style.completedColor);
        case "error": return getSomeorUndefined(style.errorColor);
        case "skipped": return getSomeorUndefined(style.skippedColor);
        default: return undefined;
    }
}

/**
 * Renders an East UI Steps using Chakra v3's Steps compound.
 *
 * @remarks
 * `activeIndex` comes from main; per-status colour slots come from
 * `value.style`. Each item's `title` / `description` are UIComp dispatched
 * through `EastChakraComponent`.
 */
export const EastChakraSteps = memo(function EastChakraSteps({ value, storageKey }: EastChakraStepsProps) {
    const rootProps = useMemo(() => toChakraSteps(value), [value]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const connectorColor = style ? getSomeorUndefined(style.connectorColor) : undefined;

    return (
        <ChakraSteps.Root {...rootProps}>
            <ChakraSteps.List>
                {value.items.map((item, index) => {
                    const icon = getSomeorUndefined(item.icon);
                    const colour = statusColour(item.status.type, style);
                    return (
                        <ChakraSteps.Item key={index} index={index}>
                            <ChakraSteps.Trigger>
                                <ChakraSteps.Indicator
                                    {...(colour !== undefined ? { color: colour } : {})}
                                >
                                    {icon ? (
                                        <FontAwesomeIcon
                                            icon={[icon.prefix as IconPrefix, icon.name as IconName]}
                                        />
                                    ) : (
                                        <ChakraSteps.Number />
                                    )}
                                </ChakraSteps.Indicator>
                                <ChakraBox flex="1">
                                    <ChakraSteps.Title>
                                        <EastChakraComponent
                                            value={item.title}
                                            storageKey={`${storageKey ?? ""}.items.${index}.title`}
                                        />
                                    </ChakraSteps.Title>
                                    {(() => {
                                        const desc = getSomeorUndefined(item.description);
                                        return desc ? (
                                            <ChakraSteps.Description>
                                                <EastChakraComponent
                                                    value={desc}
                                                    storageKey={`${storageKey ?? ""}.items.${index}.description`}
                                                />
                                            </ChakraSteps.Description>
                                        ) : null;
                                    })()}
                                </ChakraBox>
                            </ChakraSteps.Trigger>
                            {index < value.items.length - 1 && (
                                <ChakraSteps.Separator
                                    {...(connectorColor !== undefined ? { bg: connectorColor } : {})}
                                />
                            )}
                        </ChakraSteps.Item>
                    );
                })}
            </ChakraSteps.List>
        </ChakraSteps.Root>
    );
}, (prev, next) => stepsEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
