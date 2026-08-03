/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { AvatarGroup, Stack } from "@elaraai/east-ui";

export const avatarGroupBasic = example({
    keywords: ["AvatarGroup", "Root", "avatars"],
    description: "Basic avatar group with three avatars",
    fn: East.function([], UIComponentType, ($) => {
        return <AvatarGroup avatars={[{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }]} />;
    }),
    inputs: [],
});

export const avatarGroupOverflow = example({
    keywords: ["AvatarGroup", "Root", "max", "overflow"],
    description: "Avatar group with max overflow showing +N",
    fn: East.function([], UIComponentType, ($) => {
        return (
            <AvatarGroup
                avatars={[{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }, { name: "Dan" }, { name: "Eve" }]}
                max={3n}
                size="sm"
            />
        );
    }),
    inputs: [],
});

export const avatarGroupDensities = example({
    keywords: ["AvatarGroup", "density", "condensed", "compact", "comfortable", "sizes"],
    description: "The three densities stacked — every member avatar sized to the group density (matching ChipRail / Trace)",
    fn: East.function([], UIComponentType, ($) => {
        const condensed = $.const(<AvatarGroup avatars={[{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }]} density="condensed" />);
        const compact = $.const(<AvatarGroup avatars={[{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }]} density="compact" />);
        const comfortable = $.const(<AvatarGroup avatars={[{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }]} density="comfortable" />);
        return (
            <Stack direction="column" gap="6">
                {condensed}
                {compact}
                {comfortable}
            </Stack>
        );
    }),
    inputs: [],
});

export const avatarGroupLarge = example({
    keywords: ["AvatarGroup", "Root", "size", "lg"],
    description: "Large avatar group with custom border",
    fn: East.function([], UIComponentType, ($) => {
        return <AvatarGroup avatars={[{ name: "Mira" }, { name: "Noah" }]} size="lg" borderColor="border.brand" />;
    }),
    inputs: [],
});
