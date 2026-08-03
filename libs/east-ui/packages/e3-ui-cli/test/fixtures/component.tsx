/** @jsxImportSource @elaraai/east-ui */
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// Test fixture: a minimal standalone east-ui component. Consumed by
// load-source/payload specs via esbuild (NOT compiled by the package tsc).
import { East } from "@elaraai/east";
import { UIComponentType, VStack, Text, Badge } from "@elaraai/east-ui";

export default East.function([], UIComponentType, (_$) => (
    <VStack gap="3" align="stretch">
        <Text fontWeight="bold">Fixture component</Text>
        <Badge colorPalette="success">ok</Badge>
    </VStack>
));
