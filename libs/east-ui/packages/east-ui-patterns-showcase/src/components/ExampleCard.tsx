/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * ExampleCard — header (description + keyword tags + source toggle) over a
 * body that flips between the rendered East example and its prettier-formatted
 * source.
 *
 * Source comes from the `virtual:example-sources` module produced by
 * `scripts/vite-plugin-example-sources.ts`. All visual chrome consumes the
 * canonical Elara Chakra v3 system from `@elaraai/east-ui-components`
 * (textStyle / layerStyle).
 */

import { useMemo, useState } from "react";
import {
    Box,
    CodeBlock,
    HStack,
    IconButton,
    Stack,
    Text,
    createHighlightJsAdapter,
} from "@chakra-ui/react";
import { EastFunction } from "@elaraai/east-ui-components";
import type { EastIR } from "@elaraai/east/internal";
import type { ExampleDef } from "@elaraai/east";
import type { UIComponentType } from "@elaraai/east-ui";

import hljs from "highlight.js/lib/core";
import typescriptLang from "highlight.js/lib/languages/typescript";
import "highlight.js/styles/atom-one-dark.css";

function ensureHljs(): typeof hljs {
    if (!hljs.listLanguages().includes("typescript")) {
        hljs.registerLanguage("typescript", typescriptLang);
    }
    return hljs;
}

export const codeBlockAdapter = createHighlightJsAdapter({
    load: async () => ensureHljs(),
    loadSync: () => ensureHljs(),
    highlightOptions: { language: "typescript", ignoreIllegals: true },
});

export interface ExampleSource {
    raw: string;
    html: string;
}

interface ExampleCardProps {
    name: string;
    /**
     * Any zero-arg East example whose function eventually yields a
     * `UIComponentType`. The IR is recompiled per-card; UI examples are
     * always outer-sync (Reactive.Root absorbs the inner async).
     */
    example: ExampleDef<[]>;
    source?: ExampleSource;
    storageKey: string;
    /** Body height — defaults to a comfortable mock height. */
    bodyHeight?: string;
}

type View = "output" | "source";

export function ExampleCard({
    name,
    example,
    source,
    storageKey,
    bodyHeight = "auto",
}: ExampleCardProps) {
    const ir = useMemo(
        () => example.fn.toIR() as EastIR<[], typeof UIComponentType>,
        [example.fn],
    );
    const [view, setView] = useState<View>("output");
    const showingSource = view === "source";

    return (
        <Box layerStyle="card" w="full">
            <Stack gap="3">
                <HStack justify="space-between" align="center" gap="3">
                    <Text textStyle="title.row" flex="1" minW="0">
                        {example.description}
                    </Text>
                    <IconButton
                        aria-label={showingSource ? "Show rendered output" : "Show source"}
                        size="xs"
                        variant={showingSource ? "outline" : "ghost"}
                        disabled={!source}
                        onClick={() => setView(v => (v === "output" ? "source" : "output"))}
                    >
                        <Text fontFamily="mono" fontSize="xs" lineHeight="1">{"</>"}</Text>
                    </IconButton>
                </HStack>
                {/* Keywords power the example-search index for AI agents.
                    Showing six in a tight cluster reads as metadata noise
                    (UX/UI Guide §13 anti-pattern: "tag soup"). Render none
                    by default; expose via the source-toggle alongside the
                    authored fn body if needed. */}

                <Box
                    borderWidth="1px"
                    borderColor="border.subtle"
                    borderRadius="md"
                    p={view === "output" ? "4" : "0"}
                    bg={view === "output" ? "bg.canvas" : undefined}
                    minH={bodyHeight}
                    overflow="hidden"
                >
                    {view === "output" ? (
                        <EastFunction ir={ir} storageKey={storageKey} />
                    ) : source ? (
                        <CodeBlock.Root
                            code={source.raw}
                            language="typescript"
                            meta={{ colorScheme: "dark", showLineNumbers: true }}
                            size="sm"
                            position="relative"
                        >
                            <CodeBlock.Content>
                                <CodeBlock.Code overflow="auto">
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
                    ) : (
                        <Text textStyle="caption" color="fg.subtle" p="4">
                            (source unavailable for {name})
                        </Text>
                    )}
                </Box>
            </Stack>
        </Box>
    );
}
