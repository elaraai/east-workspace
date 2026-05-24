/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

import { useMemo, useState } from "react";
import {
    Box,
    CodeBlock,
    Flex,
    HStack,
    IconButton,
    Tag,
    Text,
    createHighlightJsAdapter,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCode } from "@fortawesome/free-solid-svg-icons";
import { EastFunction, type EastFunctionProps } from "@elaraai/east-ui-components";
import type { CatalogEntry } from "../catalog";

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

type View = "output" | "source";

/**
 * Renders one example following the bsys `.frame` recipe — eyebrow-row +
 * 1 px bottom rule + body, all *inside* the frame:
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ name.of.component        [chip] [chip] [chip]      [code]   │  <- eyebrow-row (mono label
 *   │ One-line description.                                       │   + dashed chips + action)
 *   ├─────────────────────────────────────────────────────────────┤  <- 1 px bottom rule
 *   │                                                             │
 *   │   [rendered widget or source code]                          │  <- body, fixed height
 *   │                                                             │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Body height is fixed via the `bodyHeight` prop (driven by the entry's
 * `ShowcaseLayout`). Fixed body sizes keep TanStack Virtual's row
 * measurement deterministic and keep the source-code toggle from
 * jumping around between rendered-view and source-view.
 */
export function ExampleCard({
    name,
    example,
    bodyHeight = "280px",
}: {
    name: string;
    example: CatalogEntry;
    bodyHeight?: string;
}) {
    /* `ExampleDef.fn`'s return type is erased to `EastType` at the package
     * boundary (to keep downstream `.d.ts` small); `<EastFunction>` needs
     * the precise `EastIR<[], UIComponentType>`. The cast narrows it back —
     * every example in the showcase is a UI component by construction. */
    const ir = useMemo(() => example.fn.toIR() as EastFunctionProps["ir"], [example.fn]);
    const [view, setView] = useState<View>("output");

    const hasSource = !!example.source;
    const pressed = view === "source";

    return (
        <Box layerStyle="frame" display="flex" flexDirection="column">
            {/* Eyebrow-row — bsys `.frame .eyebrow-row`. Mono label + dashed
             *  taxonomy chips + action toggle, with a 1 px bottom rule
             *  dividing chrome from body. Padding follows the spec's
             *  12 / 20 px frame-head rhythm. */}
            <Box
                px="20px"
                py="12px"
                borderBottomWidth="1px"
                borderBottomColor="border.subtle"
                bg="bg.canvas"
            >
                <Flex align="center" justify="space-between" gap="3" minW="0">
                    <Text
                        textStyle="mono.label"
                        flexShrink={0}
                        overflow="hidden"
                        textOverflow="ellipsis"
                        whiteSpace="nowrap"
                    >
                        {name}
                    </Text>
                    <HStack gap="1" flex="1" minW="0" justify="flex-end" overflow="hidden">
                        {example.keywords.slice(0, 3).map(k => (
                            <Tag.Root key={k} size="sm" variant="dashed" flexShrink={0}>
                                <Tag.Label>{k}</Tag.Label>
                            </Tag.Root>
                        ))}
                        {hasSource && (
                            <IconButton
                                aria-label={pressed ? "Show rendered output" : "Show source"}
                                size="xs"
                                variant={pressed ? "ink" : "ghost"}
                                onClick={() => setView(v => (v === "output" ? "source" : "output"))}
                                flexShrink={0}
                            >
                                <FontAwesomeIcon icon={faCode} />
                            </IconButton>
                        )}
                    </HStack>
                </Flex>
                <Text
                    fontSize="13px"
                    color="fg.muted"
                    lineHeight="1.4"
                    mt="1"
                    overflow="hidden"
                    textOverflow="ellipsis"
                    whiteSpace="nowrap"
                    title={example.description}
                >
                    {example.description}
                </Text>
            </Box>

            {/* Body — fixed `bodyHeight` keeps row heights deterministic
             *  for the virtualizer and keeps the rendered-view ↔ source-
             *  view toggle from jumping between heights. */}
            {view === "output" ? (
                <Box
                    bg="bg.surface"
                    p="5"
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
                    borderRadius="0"
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
                        rounded="sm"
                        p="1"
                        backdropFilter="blur(4px)"
                    >
                        <CodeBlock.CopyIndicator />
                    </CodeBlock.CopyTrigger>
                </CodeBlock.Root>
            )}
        </Box>
    );
}
