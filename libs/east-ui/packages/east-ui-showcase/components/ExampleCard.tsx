/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { Box, Card, Heading, HStack, IconButton, Tag } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCode, faEye } from "@fortawesome/free-solid-svg-icons";
import { EastFunction } from "@elaraai/east-ui-components";
import type { EastIR } from "@elaraai/east/internal";
import type { UIComponentType } from "@elaraai/east-ui";

interface Example {
    keywords: string[];
    description: string;
    fn: { toIR(): EastIR<[], typeof UIComponentType> };
    inputs: unknown[];
    source?: string;
}

type View = "output" | "source";

export function ExampleCard({
    name,
    example,
    bodyHeight = "280px",
}: {
    name: string;
    example: Example;
    bodyHeight?: string;
}) {
    const ir = useMemo(() => example.fn.toIR() as EastIR<[], typeof UIComponentType>, [example.fn]);
    const [view, setView] = useState<View>("output");
    const hasSource = typeof example.source === "string" && example.source.length > 0;

    return (
        <Card.Root size="sm" variant="outline">
            <Card.Header pb="2">
                <HStack justify="space-between" align="start" gap="2">
                    <Box flex="1" minW="0">
                        <Heading size="xs">{example.description}</Heading>
                        <HStack gap="1" flexWrap="wrap" mt="1">
                            {example.keywords.slice(0, 6).map(k => (
                                <Tag.Root key={k} size="sm" variant="subtle" colorPalette="blue">
                                    <Tag.Label>{k}</Tag.Label>
                                </Tag.Root>
                            ))}
                        </HStack>
                    </Box>
                    <IconButton
                        aria-label={view === "output" ? "View source" : "View rendered output"}
                        size="xs"
                        variant="ghost"
                        disabled={!hasSource}
                        onClick={() => setView(v => (v === "output" ? "source" : "output"))}
                    >
                        <FontAwesomeIcon icon={view === "output" ? faCode : faEye} />
                    </IconButton>
                </HStack>
            </Card.Header>
            <Card.Body pt="0">
                <Box
                    borderWidth="1px"
                    borderRadius="md"
                    p="3"
                    bg="white"
                    _dark={{ bg: "gray.800" }}
                    h={bodyHeight}
                    overflow={view === "output" ? "hidden" : "auto"}
                >
                    {view === "output" ? (
                        <EastFunction ir={ir} storageKey={`example-${name}`} />
                    ) : (
                        <Box
                            as="pre"
                            fontSize="xs"
                            fontFamily="mono"
                            margin="0"
                            whiteSpace="pre"
                            color="fg"
                            _dark={{ color: "fg" }}
                        >
                            <code>{example.source}</code>
                        </Box>
                    )}
                </Box>
            </Card.Body>
        </Card.Root>
    );
}
