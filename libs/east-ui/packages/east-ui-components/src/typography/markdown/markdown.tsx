/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Markdown — themed GitHub-flavored markdown renderer.
 *
 * @remarks
 * Wraps `react-markdown` + `remark-gfm` with Chakra-themed components for
 * every supported element (`strong`, `em`, `code`, `a`, `h1`–`h6`, `p`,
 * `ul`/`ol`/`li`, `blockquote`, `hr`, `pre`, `table`, `del`, etc.).
 * Element overrides consume the canonical Elara theme (textStyle, layerStyle,
 * link / code / mono tokens) — no inline `style=`, no theme bypass.
 *
 * Two display modes:
 *  - **block** (default) — full GFM. Headings, paragraphs, lists, tables,
 *    code blocks, blockquotes, etc. all render. Suitable for prose.
 *  - **inline** — block-level wrappers (`<p>`, headings, lists, blockquotes,
 *    `<hr>`, tables, `<pre>`) collapse to fragments so the rendered content
 *    composes inside a parent `<Text>` / inline context. Inline emphasis
 *    (`**bold**`, `*italic*`, `` `code` ``, `[link](url)`, `~~strike~~`)
 *    still renders.
 *
 * Use `<Markdown>{src}</Markdown>` in card bodies, notes, briefings.
 * Use `<Markdown inline>{src}</Markdown>` in titles, labels, table cells.
 *
 * @example
 * ```tsx
 * import { Markdown } from "@elaraai/east-ui-components";
 *
 * <Text textStyle="title.card">
 *     <Markdown inline>{"Move 3 SE shifts from **Patel** → **Cho**"}</Markdown>
 * </Text>
 *
 * <Box layerStyle="card">
 *     <Markdown>{`
 *         ## Why this rec?
 *         The forecast is **+14%** vs base, driven by:
 *         - Holiday demand in SE
 *         - Promo extension week-of-May-11
 *     `}</Markdown>
 * </Box>
 * ```
 *
 * @packageDocumentation
 */

import type { ReactNode } from "react";
import { Box, Code, Heading, Link, List, Text } from "@chakra-ui/react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

export interface MarkdownProps {
    /** The markdown source. */
    children: string;
    /**
     * Inline mode — block-level wrappers collapse to fragments so the
     * rendered content composes inside a parent inline context. Defaults
     * to `false` (block).
     */
    inline?: boolean;
}

/* ─── Inline-only element overrides — composes inside parent Text ────── */

const inlineComponents: Components = {
    // Block elements collapse to fragments. The author can still write them
    // in source; they just lose their wrapping. Inline emphasis still works.
    p:          ({ children }) => <>{children}</>,
    h1:         ({ children }) => <Text as="strong" fontWeight="semibold">{children}</Text>,
    h2:         ({ children }) => <Text as="strong" fontWeight="semibold">{children}</Text>,
    h3:         ({ children }) => <Text as="strong" fontWeight="semibold">{children}</Text>,
    h4:         ({ children }) => <Text as="strong" fontWeight="semibold">{children}</Text>,
    h5:         ({ children }) => <Text as="strong" fontWeight="semibold">{children}</Text>,
    h6:         ({ children }) => <Text as="strong" fontWeight="semibold">{children}</Text>,
    ul:         ({ children }) => <>{children}</>,
    ol:         ({ children }) => <>{children}</>,
    li:         ({ children }) => <>{children}</>,
    blockquote: ({ children }) => <>{children}</>,
    pre:        ({ children }) => <>{children}</>,
    hr:         () => null,
    table:      ({ children }) => <>{children}</>,
    thead:      ({ children }) => <>{children}</>,
    tbody:      ({ children }) => <>{children}</>,
    tr:         ({ children }) => <>{children}</>,
    th:         ({ children }) => <>{children}</>,
    td:         ({ children }) => <>{children}</>,

    // Inline emphasis — same renderers in both modes.
    strong: ({ children }) => <Text as="strong" fontWeight="semibold">{children}</Text>,
    em:     ({ children }) => <Text as="em" fontStyle="italic">{children}</Text>,
    del:    ({ children }) => <Text as="del" textDecoration="line-through" opacity={0.7}>{children}</Text>,
    a: ({ href, children }) => (
        <Link href={href ?? "#"} color="link" textDecoration="underline" textUnderlineOffset="2px">
            {children as ReactNode}
        </Link>
    ),
    code: ({ children }) => (
        <Code fontFamily="mono" fontSize="0.92em" px="1" py="0.5" bg="bg.muted" borderRadius="sm">
            {children}
        </Code>
    ),
};

/* ─── Block element overrides — themed GFM ───────────────────────────── */

const blockComponents: Components = {
    /* Headings — DM Sans, tight tracking. Use display.* for h1–h3 and
     * the inline title styles for the rest. */
    h1: ({ children }) => <Heading as="h1" textStyle="display.lg" mt="6" mb="3">{children}</Heading>,
    h2: ({ children }) => <Heading as="h2" textStyle="display.md" mt="6" mb="3">{children}</Heading>,
    h3: ({ children }) => <Heading as="h3" textStyle="display.sm" mt="5" mb="2">{children}</Heading>,
    h4: ({ children }) => <Heading as="h4" textStyle="display.xs" mt="4" mb="2">{children}</Heading>,
    h5: ({ children }) => <Heading as="h5" textStyle="title.card" mt="4" mb="2">{children}</Heading>,
    h6: ({ children }) => <Heading as="h6" textStyle="title.row"  mt="3" mb="1">{children}</Heading>,

    /* Paragraphs — Inter Tight 14/1.5 in product, generous gaps. */
    p: ({ children }) => <Text textStyle="body.md" my="3" color="fg">{children}</Text>,

    /* Lists. */
    ul: ({ children }) => <List.Root pl="5" my="3" gap="1">{children as ReactNode}</List.Root>,
    ol: ({ children }) => <List.Root as="ol" pl="5" my="3" gap="1">{children as ReactNode}</List.Root>,
    li: ({ children }) => <List.Item textStyle="body.md" color="fg">{children as ReactNode}</List.Item>,

    /* Blockquote — hairline brand left border. */
    blockquote: ({ children }) => (
        <Box
            as="blockquote"
            borderLeftWidth="3px"
            borderLeftColor="brand.500"
            pl="4"
            my="4"
            color="fg.muted"
            fontStyle="italic"
        >
            {children as ReactNode}
        </Box>
    ),

    /* Horizontal rule — subtle border. */
    hr: () => <Box as="hr" my="4" borderTopWidth="1px" borderTopColor="border.subtle" borderTopStyle="solid" />,

    /* Code blocks — use surface.muted layer-style for the fill. */
    pre: ({ children }) => (
        <Box
            as="pre"
            layerStyle="surface.muted"
            fontFamily="mono"
            fontSize="md"
            overflowX="auto"
            my="3"
        >
            {children as ReactNode}
        </Box>
    ),

    /* Inline code. */
    code: ({ children }) => (
        <Code fontFamily="mono" fontSize="0.92em" px="1" py="0.5" bg="bg.muted" borderRadius="sm">
            {children}
        </Code>
    ),

    /* Tables — themed with subtle borders. */
    table: ({ children }) => (
        <Box
            as="table"
            width="full"
            borderCollapse="separate"
            css={{ borderSpacing: 0 }}
            borderWidth="1px"
            borderColor="border.subtle"
            borderRadius="md"
            overflow="hidden"
            my="4"
            fontSize="md"
        >
            {children as ReactNode}
        </Box>
    ),
    thead: ({ children }) => <Box as="thead" bg="bg.muted">{children as ReactNode}</Box>,
    tr: ({ children }) => <Box as="tr">{children as ReactNode}</Box>,
    th: ({ children }) => (
        <Box
            as="th"
            textAlign="left"
            px="3"
            py="2"
            color="fg.muted"
            fontWeight="semibold"
            textStyle="caption"
            textTransform="uppercase"
            letterSpacing="wider"
            borderBottomWidth="1px"
            borderBottomColor="border.subtle"
        >
            {children as ReactNode}
        </Box>
    ),
    td: ({ children }) => (
        <Box
            as="td"
            px="3"
            py="2"
            borderBottomWidth="1px"
            borderBottomColor="border.subtle"
            verticalAlign="top"
        >
            {children as ReactNode}
        </Box>
    ),

    /* Inline emphasis — shared between modes. */
    strong: ({ children }) => <Text as="strong" fontWeight="semibold">{children}</Text>,
    em:     ({ children }) => <Text as="em" fontStyle="italic">{children}</Text>,
    del:    ({ children }) => <Text as="del" textDecoration="line-through" opacity={0.7}>{children}</Text>,
    a: ({ href, children }) => (
        <Link href={href ?? "#"} color="link" textDecoration="underline" textUnderlineOffset="2px">
            {children as ReactNode}
        </Link>
    ),
};

/**
 * Markdown — themed GitHub-flavored markdown renderer for any inline or
 * block context. See module-level docs for the full element vocabulary.
 */
export function Markdown({ children, inline = false }: MarkdownProps) {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={inline ? inlineComponents : blockComponents}
        >
            {children}
        </ReactMarkdown>
    );
}
