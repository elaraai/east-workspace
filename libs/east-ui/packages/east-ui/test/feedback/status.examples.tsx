/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Status, HStack, Text } from "@elaraai/east-ui/jsx";

export const statusBasic = example({
    keywords: ["Status", "Root", "value", "paired icon"],
    description: "Each StatusValue side-by-side with default paired icon",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="3">
                <Status label="Up to date" value="success" />
                <Status label="Stale" value="warning" />
                <Status label="Failed" value="danger" />
                <Status label="Info" value="info" />
                <Status label="Idle" value="neutral" />
            </HStack>
        );
    }),
    inputs: [],
});

export const statusPulsing = example({
    keywords: ["Status", "pulsing", "danger", "recompute"],
    description: "Pulsing danger status for in-flight recompute",
    fn: East.function([], UIComponentType, (_$) => {
        return <Status label="Recomputing" value="danger" pulsing />;
    }),
    inputs: [],
});

export const statusRichLabel = example({
    keywords: ["Status", "rich label", "HStack", "secondary"],
    description: "Status with a rich label showing a timestamp alongside the primary label",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Status
                value="success"
                label={
                    <HStack gap="1">
                        <Text>Up to date</Text>
                        <Text color="fg.muted">· 14:32</Text>
                    </HStack>
                }
            />
        );
    }),
    inputs: [],
});

export const statusCustomIcon = example({
    keywords: ["Status", "icon", "override"],
    description: "Status with an explicit icon override that skips the paired default",
    fn: East.function([], UIComponentType, (_$) => {
        return <Status label="Shipping" value="info" icon={{ prefix: "fas", name: "truck" }} />;
    }),
    inputs: [],
});
