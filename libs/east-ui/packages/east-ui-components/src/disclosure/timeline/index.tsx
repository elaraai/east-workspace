/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import {
    Timeline as ChakraTimeline,
    type TimelineRootProps,
    Box as ChakraBox,
    Badge as ChakraBadge,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-common-types";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Timeline } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const timelineEqual = equalFor(Timeline.Types.Timeline);

export type TimelineValue = ValueTypeOf<typeof Timeline.Types.Timeline>;
type TimelineItemValue = TimelineValue["items"][number];

export function toChakraTimeline(value: TimelineValue): TimelineRootProps {
    const style = getSomeorUndefined(value.style);
    return {
        size: style ? (getSomeorUndefined(style.size)?.type as TimelineRootProps["size"]) : undefined,
    };
}

export interface EastChakraTimelineProps {
    value: TimelineValue;
    storageKey?: string;
}

function statusColour(
    status: TimelineItemValue["status"]["type"],
    style: ValueTypeOf<typeof Timeline.Types.Style> | undefined,
): string | undefined {
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

function formatTimestamp(ts: Date | undefined): string | undefined {
    if (!ts) return undefined;
    return ts.toLocaleString();
}

/**
 * Renders an East UI Timeline using Chakra v3's Timeline compound.
 *
 * @remarks
 * Shares the `StepStatusType` variant with Steps. Rich `title` / `description`
 * slots dispatched through `EastChakraComponent`. `indicator` renders a
 * FontAwesome icon in the connector marker; `badgeLabel` renders a leading
 * badge next to the title.
 */
export const EastChakraTimeline = memo(function EastChakraTimeline({ value, storageKey }: EastChakraTimelineProps) {
    const rootProps = useMemo(() => toChakraTimeline(value), [value]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const connectorColor = style ? getSomeorUndefined(style.connectorColor) : undefined;

    return (
        <ChakraTimeline.Root {...rootProps}>
            {value.items.map((item, index) => {
                const icon = getSomeorUndefined(item.indicator);
                const timestamp = formatTimestamp(getSomeorUndefined(item.timestamp));
                const desc = getSomeorUndefined(item.description);
                const badgeLabel = getSomeorUndefined(item.badgeLabel);
                const colour = statusColour(item.status.type, style);
                return (
                    <ChakraTimeline.Item key={index}>
                        <ChakraTimeline.Connector
                            {...(connectorColor !== undefined ? { bg: connectorColor } : {})}
                        >
                            <ChakraTimeline.Separator />
                            <ChakraTimeline.Indicator
                                {...(colour !== undefined ? { color: colour } : {})}
                            >
                                {icon ? (
                                    <FontAwesomeIcon
                                        icon={[icon.prefix as IconPrefix, icon.name as IconName]}
                                    />
                                ) : null}
                            </ChakraTimeline.Indicator>
                        </ChakraTimeline.Connector>
                        <ChakraTimeline.Content>
                            <ChakraTimeline.Title>
                                {badgeLabel ? (
                                    <ChakraBadge size="sm" mr="2">{badgeLabel}</ChakraBadge>
                                ) : null}
                                <EastChakraComponent
                                    value={item.title}
                                    storageKey={`${storageKey ?? ""}.items.${index}.title`}
                                />
                            </ChakraTimeline.Title>
                            {timestamp ? (
                                <ChakraBox fontSize="xs" color="fg.muted">
                                    {timestamp}
                                </ChakraBox>
                            ) : null}
                            {desc ? (
                                <ChakraTimeline.Description>
                                    <EastChakraComponent
                                        value={desc}
                                        storageKey={`${storageKey ?? ""}.items.${index}.description`}
                                    />
                                </ChakraTimeline.Description>
                            ) : null}
                        </ChakraTimeline.Content>
                    </ChakraTimeline.Item>
                );
            })}
        </ChakraTimeline.Root>
    );
}, (prev, next) => timelineEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
