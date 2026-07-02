/** @jsxImportSource @elaraai/east-ui */
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// Test fixture: an e3 ui() task with no compute-time inputs — the shape a
// create-e3 --ui scaffold exports from src/ui/index.tsx. Consumed by the
// load-source spec to prove the TaskDef unwrap renders the stored fn IR.
import { East } from "@elaraai/east";
import { ui } from "@elaraai/e3-ui";
import { UIComponentType, VStack, Text } from "@elaraai/east-ui";

export const surface = ui(
    "surface",
    [],
    East.function([], UIComponentType, (_$) => (
        <VStack gap="3" align="stretch">
            <Text fontWeight="bold">Fixture ui() task</Text>
        </VStack>
    )),
);
