/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Box, IconButton, Text, Flex } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCopy } from "@fortawesome/free-solid-svg-icons";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { CodeBlock } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";

// Pre-define the equality function at module level
const codeBlockEqual = equalFor(CodeBlock.Types.CodeBlock);

/** East CodeBlock value type */
export type CodeBlockValue = ValueTypeOf<typeof CodeBlock.Types.CodeBlock>;

export interface CodeBlockProps {
    language?: string | undefined;
    showLineNumbers?: boolean | undefined;
    highlightLines?: number[] | undefined;
    maxHeight?: string | undefined;
    showCopyButton?: boolean | undefined;
    title?: string | undefined;
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
}

/**
 * Converts an East UI CodeBlock value to component props.
 * Pure function - easy to test independently.
 */
export function toCodeBlockProps(value: CodeBlockValue): CodeBlockProps {
    const languageVariant = getSomeorUndefined(value.language);
    const language = languageVariant?.type;

    const highlightLinesBigint = getSomeorUndefined(value.highlightLines);
    const highlightLines = highlightLinesBigint?.map(n => Number(n));

    const padding = getSomeorUndefined(value.padding);
    const margin = getSomeorUndefined(value.margin);

    return {
        language,
        showLineNumbers: getSomeorUndefined(value.showLineNumbers),
        highlightLines,
        maxHeight: getSomeorUndefined(value.maxHeight),
        showCopyButton: getSomeorUndefined(value.showCopyButton),
        title: getSomeorUndefined(value.title),
        overflow: getSomeorUndefined(value.overflow)?.type,
        overflowX: getSomeorUndefined(value.overflowX)?.type,
        overflowY: getSomeorUndefined(value.overflowY)?.type,
        width: getSomeorUndefined(value.width),
        height: getSomeorUndefined(value.height),
        minWidth: getSomeorUndefined(value.minWidth),
        minHeight: getSomeorUndefined(value.minHeight),
        maxWidth: getSomeorUndefined(value.maxWidth),
        pt: padding ? getSomeorUndefined(padding.top) : undefined,
        pr: padding ? getSomeorUndefined(padding.right) : undefined,
        pb: padding ? getSomeorUndefined(padding.bottom) : undefined,
        pl: padding ? getSomeorUndefined(padding.left) : undefined,
        mt: margin ? getSomeorUndefined(margin.top) : undefined,
        mr: margin ? getSomeorUndefined(margin.right) : undefined,
        mb: margin ? getSomeorUndefined(margin.bottom) : undefined,
        ml: margin ? getSomeorUndefined(margin.left) : undefined,
        opacity: getSomeorUndefined(value.opacity),
    };
}

export interface EastChakraCodeBlockProps {
    value: CodeBlockValue;
}

/**
 * Renders an East UI CodeBlock value as a plain `<pre><code>` block.
 *
 * @remarks
 * Syntax highlighting has intentionally been removed — the previous Shiki
 * integration via Chakra's `CodeBlock.AdapterProvider` caused "Shiki instance
 * has been disposed" errors under virtualized mounts, and the singleton
 * highlighter lifecycle was fragile. This renderer is now a thin styled
 * `<pre>` with optional line numbers, line highlights, title and copy button.
 */
export const EastChakraCodeBlock = memo(function EastChakraCodeBlock({ value }: EastChakraCodeBlockProps) {
    const props = useMemo(() => toCodeBlockProps(value), [value]);
    const showHeader = props.title || props.showCopyButton;
    const highlightSet = useMemo(
        () => props.highlightLines ? new Set(props.highlightLines) : null,
        [props.highlightLines],
    );
    const lines = useMemo(() => value.code.split("\n"), [value.code]);

    const copy = () => {
        void navigator.clipboard.writeText(value.code);
    };

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
            bg="gray.50"
            _dark={{ bg: "gray.900", borderColor: "gray.700" }}
        >
            {showHeader && (
                <Flex
                    align="center"
                    justify="space-between"
                    px="3"
                    py="2"
                    borderBottomWidth="1px"
                    borderColor="inherit"
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
                        const highlightProps = highlighted
                            ? { bg: "yellow.100", _dark: { bg: "yellow.900" }, mx: "-3", px: "3" }
                            : {};
                        return (
                            <Flex key={i} {...highlightProps}>
                                {props.showLineNumbers && (
                                    <Box
                                        as="span"
                                        color="gray.500"
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
