/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

import { useMemo } from "react";
import { Box, Card, Heading, HStack, Tag } from "@chakra-ui/react";
import { EastFunction } from "@elaraai/east-ui-components";
import type { EastIR } from "@elaraai/east/internal";
import type { UIComponentType } from "@elaraai/east-ui";

interface Example {
    keywords: string[];
    description: string;
    fn: { toIR(): EastIR<[], typeof UIComponentType> };
    inputs: unknown[];
}

export function ExampleCard({ name, example }: { name: string; example: Example }) {
    const ir = useMemo(() => example.fn.toIR() as EastIR<[], typeof UIComponentType>, [example.fn]);

    return (
        <Card.Root size="sm" variant="outline">
            <Card.Header pb="2">
                <Heading size="xs">{example.description}</Heading>
                <HStack gap="1" flexWrap="wrap" mt="1">
                    {example.keywords.slice(0, 6).map(k => (
                        <Tag.Root key={k} size="sm" variant="subtle" colorPalette="blue">
                            <Tag.Label>{k}</Tag.Label>
                        </Tag.Root>
                    ))}
                </HStack>
            </Card.Header>
            <Card.Body pt="0">
                <Box
                    borderWidth="1px"
                    borderRadius="md"
                    p="3"
                    bg="white"
                    _dark={{ bg: "gray.800" }}
                    h="280px"
                    overflow="hidden"
                >
                    <EastFunction ir={ir} storageKey={`example-${name}`} />
                </Box>
            </Card.Body>
        </Card.Root>
    );
}
