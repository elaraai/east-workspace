/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

import { useMemo, useState } from "react";
import {
    Box,
    Card,
    CodeBlock,
    Heading,
    HStack,
    IconButton,
    Tag,
    createHighlightJsAdapter,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCode } from "@fortawesome/free-solid-svg-icons";
import { EastFunction } from "@elaraai/east-ui-components";
import type { EastIR } from "@elaraai/east/internal";
import type { UIComponentType } from "@elaraai/east-ui";

import hljs from "highlight.js/lib/core";
import typescriptLang from "highlight.js/lib/languages/typescript";
import "highlight.js/styles/atom-one-dark.css";

/**
 * Ensure the `typescript` language is registered on the shared hljs instance.
 * Chakra's adapter `unloadContext` unregisters all languages on teardown, so
 * we must re-register every time `load` / `loadSync` is invoked.
 */
function ensureHljs(): typeof hljs {
    if (!hljs.listLanguages().includes("typescript")) {
        hljs.registerLanguage("typescript", typescriptLang);
    }
    return hljs;
}

/**
 * Chakra v3 CodeBlock adapter backed by highlight.js — synchronous, no WASM,
 * no async load.
 */
export const codeBlockAdapter = createHighlightJsAdapter({
    load: async () => ensureHljs(),
    loadSync: () => ensureHljs(),
    highlightOptions: { language: "typescript", ignoreIllegals: true },
});

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

    const hasSource = !!example.source;
    const pressed = view === "source";

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
                {view === "output" ? (
                    <Box
                        borderWidth="1px"
                        borderRadius="md"
                        p="3"
                        bg="white"
                        _dark={{ bg: "gray.800" }}
                        h={bodyHeight}
                        overflowX="hidden"
                        overflowY="auto"
                    >
                        <EastFunction ir={ir} storageKey={`example-${name}`} />
                    </Box>
                ) : (
                    <CodeBlock.Root
                        code={example.source!.raw}
                        language="typescript"
                        meta={{ colorScheme: "dark", showLineNumbers: true }}
                        size="sm"
                        h={bodyHeight}
                        borderWidth="1px"
                        borderRadius="md"
                        overflow="hidden"
                        position="relative"
                        style={{ "--code-block-max-height": bodyHeight } as React.CSSProperties}
                    >
                        <CodeBlock.Content h="full" maxH="full">
                            <CodeBlock.Code h="full" overflow="auto">
                                <CodeBlock.CodeText />
                            </CodeBlock.Code>
                        </CodeBlock.Content>
                        <CodeBlock.CopyTrigger
                            position="absolute"
                            top="2"
                            right="3"
                            zIndex="1"
                            bg="whiteAlpha.100"
                            _hover={{ bg: "whiteAlpha.200" }}
                            rounded="md"
                            p="1"
                            backdropFilter="blur(4px)"
                        >
                            <CodeBlock.CopyIndicator />
                        </CodeBlock.CopyTrigger>
                    </CodeBlock.Root>
                )}
            </Card.Body>
        </Card.Root>
    );
}
