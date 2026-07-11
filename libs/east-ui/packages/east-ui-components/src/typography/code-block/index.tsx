/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Box, IconButton, Text, Flex } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCopy } from "@fortawesome/free-solid-svg-icons";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { CodeBlock } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { parseCssSize } from "../../style/parse-size.js";

// Pre-define the equality function at module level
const codeBlockEqual = equalFor(CodeBlock.Types.CodeBlock);

/** East CodeBlock value type */
export type CodeBlockValue = ValueTypeOf<typeof CodeBlock.Types.CodeBlock>;

export interface CodeBlockProps {
    language?: string | undefined;
    showLineNumbers?: boolean | undefined;
    highlightLines?: number[] | undefined;
    showCopyButton?: boolean | undefined;
    title?: string | undefined;
    maxHeight?: string | undefined;
    overflow?: string | undefined;
    overflowX?: string | undefined;
    overflowY?: string | undefined;
    width?: string | undefined;
    height?: string | undefined;
    minWidth?: string | undefined;
    minHeight?: string | undefined;
    maxWidth?: string | undefined;
    pt?: string | undefined;
    pr?: string | undefined;
    pb?: string | undefined;
    pl?: string | undefined;
    mt?: string | undefined;
    mr?: string | undefined;
    mb?: string | undefined;
    ml?: string | undefined;
    opacity?: number | undefined;
    // Colour slots
    background?: string | undefined;
    borderColor?: string | undefined;
    headerBackground?: string | undefined;
    lineNumberColor?: string | undefined;
    highlightBackground?: string | undefined;
}

/**
 * Converts an East UI CodeBlock value to component props.
 * Pure function — reads content / config from the main struct and visual
 * fields from the nested `style` sub-struct.
 */
export function toCodeBlockProps(value: CodeBlockValue): CodeBlockProps {
    const style = getSomeorUndefined(value.style);
    const padding = style ? getSomeorUndefined(style.padding) : undefined;
    const margin = style ? getSomeorUndefined(style.margin) : undefined;

    const languageVariant = getSomeorUndefined(value.language);
    const language = languageVariant?.type;

    const highlightLinesBigint = getSomeorUndefined(value.highlightLines);
    const highlightLines = highlightLinesBigint?.map(n => Number(n));

    return {
        // Content / config (main)
        language,
        showLineNumbers: getSomeorUndefined(value.showLineNumbers),
        highlightLines,
        showCopyButton: getSomeorUndefined(value.showCopyButton),
        title: getSomeorUndefined(value.title),
        // Visual (style)
        maxHeight: parseCssSize(style ? getSomeorUndefined(style.maxHeight) : undefined),
        overflow: style ? getSomeorUndefined(style.overflow)?.type : undefined,
        overflowX: style ? getSomeorUndefined(style.overflowX)?.type : undefined,
        overflowY: style ? getSomeorUndefined(style.overflowY)?.type : undefined,
        width: parseCssSize(style ? getSomeorUndefined(style.width) : undefined),
        height: parseCssSize(style ? getSomeorUndefined(style.height) : undefined),
        minWidth: parseCssSize(style ? getSomeorUndefined(style.minWidth) : undefined),
        minHeight: parseCssSize(style ? getSomeorUndefined(style.minHeight) : undefined),
        maxWidth: parseCssSize(style ? getSomeorUndefined(style.maxWidth) : undefined),
        pt: padding ? getSomeorUndefined(padding.top) : undefined,
        pr: padding ? getSomeorUndefined(padding.right) : undefined,
        pb: padding ? getSomeorUndefined(padding.bottom) : undefined,
        pl: padding ? getSomeorUndefined(padding.left) : undefined,
        mt: margin ? getSomeorUndefined(margin.top) : undefined,
        mr: margin ? getSomeorUndefined(margin.right) : undefined,
        mb: margin ? getSomeorUndefined(margin.bottom) : undefined,
        ml: margin ? getSomeorUndefined(margin.left) : undefined,
        opacity: style ? getSomeorUndefined(style.opacity) : undefined,
        background: style ? getSomeorUndefined(style.background) : undefined,
        borderColor: style ? getSomeorUndefined(style.borderColor) : undefined,
        headerBackground: style ? getSomeorUndefined(style.headerBackground) : undefined,
        lineNumberColor: style ? getSomeorUndefined(style.lineNumberColor) : undefined,
        highlightBackground: style ? getSomeorUndefined(style.highlightBackground) : undefined,
    };
}

export interface EastChakraCodeBlockProps {
    value: CodeBlockValue;
}

/**
 * Renders an East UI CodeBlock value as a plain `<pre><code>` block.
 *
 * @remarks
 * Syntax highlighting has intentionally been left to CSS — the previous Shiki
 * integration via Chakra's `CodeBlock.AdapterProvider` caused "Shiki instance
 * has been disposed" errors under virtualized mounts, and the singleton
 * highlighter lifecycle was fragile. This renderer is a thin styled
 * `<pre>` with optional line numbers, line highlights, title, copy button,
 * and `diff` line-kind accenting (`+` → success, `-` → danger) driven off the
 * `data-language="diff"` attribute.
 */
export const EastChakraCodeBlock = memo(function EastChakraCodeBlock({ value }: EastChakraCodeBlockProps) {
    const props = useMemo(() => toCodeBlockProps(value), [value]);
    const showHeader = props.title || props.showCopyButton;
    const highlightSet = useMemo(
        () => props.highlightLines ? new Set(props.highlightLines) : null,
        [props.highlightLines],
    );
    const lines = useMemo(() => value.code.split("\n"), [value.code]);
    const isDiff = props.language === "diff";

    const copy = () => {
        void navigator.clipboard.writeText(value.code);
    };

    const defaultHighlightProps = props.highlightBackground
        ? { bg: props.highlightBackground, mx: "-3", px: "3" }
        : { bg: "bg.warning.subtle", mx: "-3", px: "3" };

    return (
        <Box
            maxHeight={props.maxHeight}
            overflow={props.overflow ?? "auto"}
            overflowX={props.overflowX}
            overflowY={props.overflowY}
            width={props.width}
            height={props.height}
            minWidth={props.minWidth}
            minHeight={props.minHeight}
            maxWidth={props.maxWidth}
            pt={props.pt}
            pr={props.pr}
            pb={props.pb}
            pl={props.pl}
            mt={props.mt}
            mr={props.mr}
            mb={props.mb}
            ml={props.ml}
            opacity={props.opacity}
            borderWidth="1px"
            borderRadius="md"
            bg={props.background ?? "gray.50"}
            borderColor={props.borderColor}
            _dark={{
                bg: props.background ?? "gray.900",
                borderColor: props.borderColor ?? "gray.700",
            }}
        >
            {showHeader && (
                <Flex
                    align="center"
                    justify="space-between"
                    px="3"
                    py="2"
                    borderBottomWidth="1px"
                    borderColor="inherit"
                    bg={props.headerBackground}
                >
                    {props.title
                        ? <Text fontSize="sm" fontWeight="medium">{props.title}</Text>
                        : <Box />}
                    {props.showCopyButton && (
                        <IconButton
                            variant="ghost"
                            size="2xs"
                            aria-label="Copy code"
                            onClick={copy}
                        >
                            <FontAwesomeIcon icon={faCopy} />
                        </IconButton>
                    )}
                </Flex>
            )}
            <Box
                as="pre"
                m="0"
                p="3"
                fontSize="sm"
                fontFamily="mono"
                lineHeight="1.5"
                overflow="auto"
                data-language={props.language}
            >
                <Box as="code">
                    {lines.map((line, i) => {
                        const n = i + 1;
                        const highlighted = highlightSet?.has(n);
                        const diffKind = isDiff
                            ? (line.startsWith("+") && !line.startsWith("+++")
                                ? "added"
                                : line.startsWith("-") && !line.startsWith("---")
                                    ? "removed"
                                    : undefined)
                            : undefined;

                        const diffProps = diffKind === "added"
                            ? { bg: "bg.success.subtle", color: "fg.success" }
                            : diffKind === "removed"
                                ? { bg: "bg.danger.subtle", color: "fg.danger" }
                                : {};
                        const highlightProps = highlighted ? defaultHighlightProps : {};
                        const lineProps = { ...diffProps, ...highlightProps };

                        return (
                            <Flex key={i} {...lineProps}>
                                {props.showLineNumbers && (
                                    <Box
                                        as="span"
                                        color={props.lineNumberColor ?? "fg.subtle"}
                                        textAlign="right"
                                        pr="3"
                                        userSelect="none"
                                        minW="2.5em"
                                    >
                                        {n}
                                    </Box>
                                )}
                                <Box as="span" flex="1" whiteSpace="pre">{line || "\u00a0"}</Box>
                            </Flex>
                        );
                    })}
                </Box>
            </Box>
        </Box>
    );
}, (prev, next) => codeBlockEqual(prev.value, next.value));
