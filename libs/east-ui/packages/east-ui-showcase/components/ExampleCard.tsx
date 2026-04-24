/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

import { useMemo, useState, useCallback } from "react";
import { Box, Card, Heading, HStack, IconButton, Tag } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCode, faCopy, faCheck } from "@fortawesome/free-solid-svg-icons";
import { EastFunction } from "@elaraai/east-ui-components";
import type { EastIR } from "@elaraai/east/internal";
import type { UIComponentType } from "@elaraai/east-ui";

import "highlight.js/styles/atom-one-dark.css";

interface Example {
    keywords: string[];
    description: string;
    fn: { toIR(): EastIR<[], typeof UIComponentType> };
    inputs: unknown[];
    source?: { raw: string; html: string };
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
    const [copied, setCopied] = useState(false);

    const hasSource = !!example.source;
    const pressed = view === "source";

    const handleCopy = useCallback(() => {
        if (!example.source) return;
        navigator.clipboard.writeText(example.source.raw).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        }).catch(() => {
            // Clipboard API denied / unavailable — no-op.
        });
    }, [example.source]);

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
                        aria-label={pressed ? "Show rendered output" : "Show source"}
                        size="xs"
                        variant={pressed ? "solid" : "ghost"}
                        colorPalette={pressed ? "blue" : "gray"}
                        disabled={!hasSource}
                        onClick={() => setView(v => (v === "output" ? "source" : "output"))}
                    >
                        <FontAwesomeIcon icon={faCode} />
                    </IconButton>
                </HStack>
            </Card.Header>
            <Card.Body pt="0">
                <Box
                    borderWidth="1px"
                    borderRadius="md"
                    p={view === "output" ? "3" : "0"}
                    bg={view === "output" ? "white" : "#282c34"}
                    _dark={{ bg: view === "output" ? "gray.800" : "#282c34" }}
                    h={bodyHeight}
                    overflow="hidden"
                    position="relative"
                >
                    {view === "output" ? (
                        <EastFunction ir={ir} storageKey={`example-${name}`} />
                    ) : (
                        <>
                            <IconButton
                                aria-label={copied ? "Copied" : "Copy source"}
                                size="xs"
                                variant="subtle"
                                colorPalette={copied ? "green" : "gray"}
                                onClick={handleCopy}
                                position="absolute"
                                top="2"
                                right="2"
                                zIndex="1"
                                opacity="0.85"
                                _hover={{ opacity: 1 }}
                            >
                                <FontAwesomeIcon icon={copied ? faCheck : faCopy} />
                            </IconButton>
                            <Box
                                as="pre"
                                fontSize="xs"
                                fontFamily="mono"
                                margin="0"
                                padding="3"
                                h="full"
                                overflow="auto"
                                whiteSpace="pre"
                                lineHeight="1.5"
                                css={{
                                    "& .hljs": { background: "transparent", padding: 0 },
                                    "&::-webkit-scrollbar": { width: "8px", height: "8px" },
                                    "&::-webkit-scrollbar-thumb": {
                                        background: "rgba(255,255,255,0.2)",
                                        borderRadius: "4px",
                                    },
                                }}
                            >
                                <code
                                    className="hljs language-typescript"
                                    dangerouslySetInnerHTML={{ __html: example.source!.html }}
                                />
                            </Box>
                        </>
                    )}
                </Box>
            </Card.Body>
        </Card.Root>
    );
}
