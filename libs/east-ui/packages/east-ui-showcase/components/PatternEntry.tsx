/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

import { useMemo, useState } from "react";
import {
    Box,
    Button,
    chakra,
    CodeBlock,
    Flex,
    HStack,
    SegmentGroup,
    Tag,
    Text,
    type CodeBlockAdapter,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { EastFunction, type EastFunctionProps } from "@elaraai/east-ui-components";
import type { CatalogEntry, CodeEntry, LiveEntry } from "../catalog";
import { useCodeLanguage, type CodeLanguage } from "../code-language";

import hljs from "highlight.js/lib/core";
import typescriptLang from "highlight.js/lib/languages/typescript";
import pythonLang from "highlight.js/lib/languages/python";
import "highlight.js/styles/atom-one-dark.css";

/**
 * Ensure the `typescript` and `python` languages are registered on the shared
 * hljs instance. Chakra's adapter `unloadContext` unregisters all languages
 * on teardown, so we must re-register every time `load` / `loadSync` is
 * invoked.
 */
function ensureHljs(): typeof hljs {
    if (!hljs.listLanguages().includes("typescript")) {
        hljs.registerLanguage("typescript", typescriptLang);
    }
    if (!hljs.listLanguages().includes("python")) {
        hljs.registerLanguage("python", pythonLang);
    }
    return hljs;
}

/**
 * Chakra v3 CodeBlock adapter backed by highlight.js — synchronous, no WASM,
 * no async load. Hand-written rather than `createHighlightJsAdapter`: that
 * helper spreads a required `highlightOptions.language` OVER each block's own
 * `language` prop, so every block would highlight as one language; here the
 * block's `language` (typescript or python, #655) is what hljs gets. The line
 * markup mirrors Chakra's (one `<span data-line>` per line).
 */
export const codeBlockAdapter: CodeBlockAdapter = {
    loadContext: async () => ensureHljs(),
    loadContextSync: () => ensureHljs(),
    unloadContext: (ctx: typeof hljs | null) => {
        for (const lang of ctx?.listLanguages() ?? []) ctx?.unregisterLanguage(lang);
    },
    getHighlighter: (ctx: typeof hljs | null) => ({ code, language = "plaintext", meta }) => {
        if (!ctx) return { code, highlighted: false };
        const { value } = ctx.highlight(code.trim(), { language, ignoreIllegals: true });
        return {
            highlighted: true,
            code: value.split("\n").map((line, i) => {
                const n = i + 1;
                const attrs = [
                    `data-line="${n}"`,
                    meta?.highlightLines?.includes(n) ? "data-highlight" : "",
                    meta?.wordWrap ? "data-word-wrap" : "",
                ].filter((a) => a !== "");
                return `<span ${attrs.join(" ")}>${line || " "}</span>`;
            }).join("\n"),
        };
    },
};

/** The selector's options — the two printings a program example has. */
const LANGUAGE_ITEMS: Array<{ value: CodeLanguage; label: string }> = [
    { value: "typescript", label: "TypeScript" },
    { value: "python", label: "Python" },
];

/** Code-reference sources longer than this collapse behind a
 *  "show all" expander so the page stays scannable. */
const COLLAPSE_LINES = 44;
const COLLAPSE_HEIGHT = "440px";

/**
 * Renders one example as a documentation entry following the spec's
 * `.pattern` recipe — a full-width, rule-separated section. The prose
 * (name, taxonomy chips, blurb) lives in the document flow; only the
 * rendered artifact sits inside a `.frame`:
 *
 *   ──────────────────────────────────────────────  <- 1 px top rule
 *   name.of.example       [chip] [chip]             <- pattern-name + chips
 *   Blurb wraps freely at a 70ch measure.           <- pattern-blurb
 *   ┌────────────────────────────────────────────┐
 *   │  rendered widget (live) / code block (ref) │  <- frame around artifact only
 *   └────────────────────────────────────────────┘
 *   ▸ source                                        <- collapsible, below
 *
 * Heights are dynamic — `DocList` measures each entry with the
 * virtualizer's ResizeObserver, so source disclosure / code expansion
 * just reflow the document.
 */
export function PatternEntry({ entry }: { entry: CatalogEntry }) {
    return (
        <Box borderTopWidth="1px" borderTopColor="border.subtle" pt="20px" pb="36px">
            <Flex align="baseline" gap="3" wrap="wrap" minW={0}>
                {/* Deep link: #<pathKey>/<name> — shareable URL that selects
                  * the category and scrolls this example into view. */}
                <chakra.a
                    href={`#${entry.pathKey}/${entry.name}`}
                    textStyle="mono.label"
                    textDecoration="none"
                    color="inherit"
                    css={{ "&:hover .anchor": { opacity: 1 } }}
                >
                    {entry.name}
                    <chakra.span className="anchor" opacity={0} transition="opacity 120ms" color="brand.600" ml="6px">#</chakra.span>
                </chakra.a>
                <HStack gap="1" wrap="wrap">
                    {entry.keywords.slice(0, 4).map(k => (
                        <Tag.Root key={k} size="sm" variant="dashed">
                            <Tag.Label>{k}</Tag.Label>
                        </Tag.Root>
                    ))}
                </HStack>
            </Flex>
            <Text textStyle="body.sm" color="fg.muted" maxW="70ch" mt="6px">
                {entry.description}
            </Text>
            {entry.tier === "live" ? <LiveBody entry={entry} /> : <CodeBody entry={entry} />}
        </Box>
    );
}

/** Live example: rendered frame hugging its content, with the captured
 *  dependencies and source in disclosures beneath it. The doc virtualizer
 *  measures rows dynamically, so the frame needs no fixed height — `minH`
 *  just keeps tiny artifacts (a lone badge) from collapsing it to a sliver. */
function LiveBody({ entry }: { entry: LiveEntry }) {
    /* `ExampleDef.fn`'s return type is erased to `EastType` at the package
     * boundary (to keep downstream `.d.ts` small); `<EastFunction>` needs
     * the precise `EastIR<[], UIComponentType>`. The cast narrows it back —
     * every live example in the showcase is a UI component by construction. */
    const ir = useMemo(() => entry.fn.toIR() as EastFunctionProps["ir"], [entry]);
    return (
        <>
            <Box
                layerStyle="frame"
                bg="bg.surface"
                p="5"
                mt="16px"
                minH="96px"
                // #356: wide examples (Table/Gantt/Planner) pan inside their
                // frame on phones instead of being clipped or overflowing the
                // page (the page-level no-horizontal-overflow invariant the
                // responsive Playwright sweep asserts).
                overflowX="auto"
            >
                <EastFunction ir={ir} storageKey={`example-${entry.pathKey}-${entry.name}`} />
            </Box>
            {/* The un-inlined defs the body references (e3.input / record /
              * mutation) get their own disclosure, above source — present only
              * for example files that declare module scope. */}
            {entry.dependencies && <Disclosure label="dependencies" raw={entry.dependencies.raw} />}
            {entry.source && <Disclosure label="source" raw={entry.source.raw} />}
        </>
    );
}

/** A chevron-toggled disclosure wrapping a dark source block — the shared
 *  affordance for the `dependencies` and `source` sections, each independent.
 *  The block caps at a viewport-friendly height and scrolls within, so a
 *  long example source never swallows the page. */
function Disclosure({ label, raw }: { label: string; raw: string }) {
    const [open, setOpen] = useState(false);
    return (
        <Box mt="10px">
            <chakra.button
                type="button"
                onClick={() => setOpen(o => !o)}
                display="inline-flex"
                alignItems="center"
                gap="6px"
                border="0"
                background="transparent"
                cursor="pointer"
                px="0"
                color={open ? "fg" : "fg.muted"}
                _hover={{ color: "brand.700" }}
            >
                <FontAwesomeIcon
                    icon={open ? faChevronDown : faChevronRight}
                    style={{ fontSize: "8px" }}
                />
                <Text as="span" textStyle="tag.kv.k" color="inherit">
                    {label}
                </Text>
            </chakra.button>
            {open && (
                <Box mt="8px">
                    <SourceBlock raw={raw} language="typescript" maxH="480px" scroll />
                </Box>
            )}
        </Box>
    );
}

/** Code-reference example: natural-height code block (collapsed behind an
 *  expander when long) with the declared `returns` value as a dashed-rule
 *  footer row, per the spec's `.pattern-slots`. An example the index also
 *  prints as python gets the TypeScript / Python selector (#655): the
 *  TypeScript view is the authored source, the python view the printing of
 *  the same IR, and the choice is the tier's (`code-language.ts`). */
function CodeBody({ entry }: { entry: CodeEntry }) {
    const [language, setLanguage] = useCodeLanguage();
    const selectable = entry.python !== null && entry.languages.includes("python");
    const shownLanguage: CodeLanguage = selectable && language === "python" ? "python" : "typescript";
    const shown = shownLanguage === "python" ? entry.python! : entry.source.raw;
    const lines = useMemo(() => shown.split("\n").length, [shown]);
    const collapsible = lines > COLLAPSE_LINES;
    const [expanded, setExpanded] = useState(false);
    const collapsed = collapsible && !expanded;
    return (
        <>
            {selectable && (
                <Flex justify="flex-end" mt="14px">
                    <SegmentGroup.Root
                        size="xs"
                        value={shownLanguage}
                        onValueChange={(e) => {
                            if (e.value === "typescript" || e.value === "python") setLanguage(e.value);
                        }}
                        data-testid="code-language"
                    >
                        <SegmentGroup.Indicator />
                        <SegmentGroup.Items items={LANGUAGE_ITEMS} />
                    </SegmentGroup.Root>
                </Flex>
            )}
            <Box mt={selectable ? "8px" : "16px"} position="relative">
                <SourceBlock raw={shown} language={shownLanguage} maxH={collapsed ? COLLAPSE_HEIGHT : undefined} />
                {collapsed && (
                    <Flex
                        position="absolute"
                        bottom="0"
                        left="0"
                        right="0"
                        h="88px"
                        align="flex-end"
                        justify="center"
                        pb="10px"
                        borderBottomRadius="{radii.md}"
                        bgImage="linear-gradient(to bottom, transparent, {colors.gray.900} 80%)"
                    >
                        <Button
                            size="xs"
                            variant="outline"
                            onClick={() => setExpanded(true)}
                            bg="whiteAlpha.200"
                            color="fg.inverse"
                            borderColor="whiteAlpha.400"
                            _hover={{ bg: "whiteAlpha.300" }}
                        >
                            Show all {lines} lines
                        </Button>
                    </Flex>
                )}
            </Box>
            {collapsible && expanded && (
                <Flex justify="center" mt="6px">
                    <Button size="xs" variant="ghost" color="fg.muted" onClick={() => setExpanded(false)}>
                        Collapse
                    </Button>
                </Flex>
            )}
            {entry.returns && (
                <Flex
                    mt="14px"
                    pt="10px"
                    borderTopWidth="1px"
                    borderTopStyle="dashed"
                    borderTopColor="border.strong"
                    align="baseline"
                    gap="3"
                    minW={0}
                >
                    <Text textStyle="tag.kv.k" flexShrink={0}>
                        returns
                    </Text>
                    <Box
                        as="span"
                        fontFamily="mono"
                        fontSize="12px"
                        color="fg"
                        whiteSpace="nowrap"
                        overflowX="auto"
                        title={entry.returns}
                    >
                        {entry.returns}
                    </Box>
                </Flex>
            )}
        </>
    );
}

/** The dark, copyable source view. Natural height by default; `maxH` bounds
 *  it — clipped for the collapsed code-reference fade, or scrolling within
 *  when `scroll` is set (the source/dependencies disclosures). `language`
 *  drives the highlighting (the adapter registers both). */
function SourceBlock({ raw, language, maxH, scroll }: { raw: string; language: CodeLanguage; maxH?: string; scroll?: boolean }) {
    return (
        <CodeBlock.Root
            code={raw}
            language={language}
            data-testid="code-source"
            data-language={language}
            meta={{ colorScheme: "dark", showLineNumbers: true }}
            size="sm"
            borderRadius="{radii.md}"
            overflow="hidden"
            position="relative"
            style={maxH ? ({ "--code-block-max-height": maxH } as React.CSSProperties) : undefined}
        >
            <CodeBlock.Content maxH={maxH} overflow={maxH ? (scroll ? "auto" : "hidden") : undefined}>
                <CodeBlock.Code>
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
    );
}
