/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<VirtualizedLogViewer>` — a log, its lines virtualized, under a band
 * holding the stdout/stderr tabs, a search that marks its matches and steps
 * through them, and Copy. The view follows the log's end while it is there,
 * and says when new lines arrive while it is not.
 *
 * A host that draws the view's controls in its own header (#1209) passes
 * `toolbar={false}`, so the view draws no band and the log fills it edge to
 * edge; controls the search with `search`; hears the matches with
 * `onMatchesChange`; and steps through them and copies the log through
 * `controlsRef`.
 *
 * @packageDocumentation
 */

import { useRef, useMemo, useEffect, useState, useCallback, useImperativeHandle, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Box, Text, IconButton, Tabs, type UseTabsReturn, Input, Badge, chakra, useSlotRecipe, type SystemStyleObject } from '@chakra-ui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCopy, faCheck, faChevronUp, faChevronDown, faArrowDown } from '@fortawesome/free-solid-svg-icons';
import type { LogViewerControls } from './preview-controls.js';

interface Match {
    /** Its place among the log's matches. */
    index: number;
    lineIndex: number;
    start: number;
    end: number;
}

/** The search's matches, as a host's "3/17" shows them (#1209). */
export interface LogMatches {
    /** The match shown, from 0; 0 while there are none. */
    current: number;
    /** How many matches the log has. */
    count: number;
}

export interface VirtualizedLogViewerProps {
    /** The log's text. */
    content: string;
    /** The stdout/stderr tabs the band shows. */
    tabs: UseTabsReturn;
    /** `false` draws no band — no tabs, search, match count or chevrons, or
     *  Copy — and the log fills the view edge to edge, with no inset, corners
     *  or border, for the host's frame to hold (#1209). Default `true`. */
    toolbar?: boolean | undefined;
    /** The search, controlled: the view draws no search box, count or
     *  chevrons of its own, marks the text's matches in any case, and scrolls
     *  to the first; `''` clears (#1209). */
    search?: string | undefined;
    /** Told the text of the view's own search box as it is edited, unless
     *  `search` is given. */
    onSearchChange?: ((search: string) => void) | undefined;
    /** Told the match shown and how many there are whenever either changes
     *  (#1209). */
    onMatchesChange?: ((matches: LogMatches) => void) | undefined;
    /** Given the view's next and previous match and its Copy while it is
     *  mounted, for a host's own controls (#1209). */
    controlsRef?: Ref<LogViewerControls> | undefined;
}

type SlotStyles = Record<string, SystemStyleObject>;

/** A line, its matches marked, the current one strongest. */
function HighlightedLine({ text, lineMatches, current, styles }: {
    text: string;
    lineMatches: Match[];
    current: number;
    styles: SlotStyles;
}): ReactNode {
    if (lineMatches.length === 0) {
        return <>{text || ' '}</>;
    }

    const parts: ReactNode[] = [];
    let lastEnd = 0;

    lineMatches.forEach((match, idx) => {
        // Add text before this match
        if (match.start > lastEnd) {
            parts.push(<span key={`t${idx}`}>{text.slice(lastEnd, match.start)}</span>);
        }
        parts.push(
            <chakra.span key={`m${idx}`} css={styles['match']} {...(match.index === current && { 'data-current': '' })}>
                {text.slice(match.start, match.end)}
            </chakra.span>,
        );
        lastEnd = match.end;
    });

    // Add remaining text
    if (lastEnd < text.length) {
        parts.push(<span key="end">{text.slice(lastEnd)}</span>);
    }

    return <>{parts}</>;
}

export function VirtualizedLogViewer({
    content,
    tabs,
    toolbar = true,
    search,
    onSearchChange,
    onMatchesChange,
    controlsRef,
}: VirtualizedLogViewerProps) {
    const styles = useSlotRecipe({ key: 'logViewer' })() as SlotStyles;
    const parentRef = useRef<HTMLDivElement>(null);
    const [copied, setCopied] = useState(false);
    // The search: the host's when it controls it, else the view's own box's.
    const [ownSearch, setOwnSearch] = useState('');
    const searchQuery = search ?? ownSearch;
    const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
    const [isAtBottom, setIsAtBottom] = useState(true);
    const [hasNewLogs, setHasNewLogs] = useState(false);

    // Split content into lines
    const lines = useMemo(() => {
        if (!content) return [''];
        return content.split('\n');
    }, [content]);

    // Every match of the search, in any case and none overlapping another,
    // and each line's, for O(1) lookup
    const { matches, matchesByLine } = useMemo(() => {
        const matches: Match[] = [];
        const matchesByLine = new Map<number, Match[]>();

        if (!searchQuery) {
            return { matches, matchesByLine };
        }

        const query = searchQuery.toLowerCase();

        lines.forEach((line, lineIndex) => {
            const lineLower = line.toLowerCase();
            const lineMatches: Match[] = [];
            for (let found = lineLower.indexOf(query); found !== -1; found = lineLower.indexOf(query, found + query.length)) {
                const match: Match = { index: matches.length, lineIndex, start: found, end: found + query.length };
                matches.push(match);
                lineMatches.push(match);
            }
            if (lineMatches.length > 0) {
                matchesByLine.set(lineIndex, lineMatches);
            }
        });

        return { matches, matchesByLine };
    }, [lines, searchQuery]);

    // Reset current match when search changes
    useEffect(() => {
        setCurrentMatchIndex(0);
    }, [searchQuery]);

    // The match shown stays within the log's matches: another stream's log,
    // or a new run's, with fewer never shows one past its count (#1209).
    const current = matches.length === 0 ? 0 : Math.min(currentMatchIndex, matches.length - 1);

    const virtualizer = useVirtualizer({
        count: lines.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 20,
        overscan: 20,
    });

    // Scroll to current match
    const scrollToMatch = useCallback((index: number) => {
        const match = matches[index];
        if (match) {
            virtualizer.scrollToIndex(match.lineIndex, { align: 'center' });
        }
    }, [matches, virtualizer]);

    // Scroll to first match when search changes
    useEffect(() => {
        if (matches.length > 0) {
            scrollToMatch(0);
        }
    }, [matches, scrollToMatch]);

    const handlePrevMatch = useCallback(() => {
        const count = matches.length;
        if (count === 0) return;
        setCurrentMatchIndex(prev => {
            const newIndex = (Math.min(prev, count - 1) + count - 1) % count;
            scrollToMatch(newIndex);
            return newIndex;
        });
    }, [matches.length, scrollToMatch]);

    const handleNextMatch = useCallback(() => {
        const count = matches.length;
        if (count === 0) return;
        setCurrentMatchIndex(prev => {
            const newIndex = (Math.min(prev, count - 1) + 1) % count;
            scrollToMatch(newIndex);
            return newIndex;
        });
    }, [matches.length, scrollToMatch]);

    // The view's own search box, which tells the host of each edit
    const editSearch = useCallback((text: string) => {
        setOwnSearch(text);
        onSearchChange?.(text);
    }, [onSearchChange]);

    // Handle keyboard shortcuts
    const handleSearchKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Enter') {
            if (e.shiftKey) {
                handlePrevMatch();
            } else {
                handleNextMatch();
            }
            e.preventDefault();
        } else if (e.key === 'Escape') {
            editSearch('');
        }
    }, [handlePrevMatch, handleNextMatch, editSearch]);

    // Check if scrolled to bottom (within threshold)
    const checkIsAtBottom = useCallback(() => {
        const el = parentRef.current;
        if (!el) return true;
        const threshold = 50; // pixels from bottom
        return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    }, []);

    // Handle scroll events to track position
    const handleScroll = useCallback(() => {
        const atBottom = checkIsAtBottom();
        setIsAtBottom(atBottom);
        if (atBottom) {
            setHasNewLogs(false);
        }
    }, [checkIsAtBottom]);

    // Scroll to bottom and clear notification
    const scrollToBottom = useCallback(() => {
        virtualizer.scrollToIndex(lines.length - 1, { align: 'end' });
        setHasNewLogs(false);
        setIsAtBottom(true);
    }, [virtualizer, lines.length]);

    // Auto-scroll to bottom when new logs arrive (only if already at bottom and not searching)
    const prevLinesLength = useRef(lines.length);
    useEffect(() => {
        if (lines.length > prevLinesLength.current) {
            if (!searchQuery && isAtBottom) {
                virtualizer.scrollToIndex(lines.length - 1, { align: 'end' });
            } else if (!searchQuery) {
                setHasNewLogs(true);
            }
        }
        prevLinesLength.current = lines.length;
    }, [lines.length, virtualizer, searchQuery, isAtBottom]);

    // Copies the log, answering whether the clipboard took it
    const copy = useCallback(async (): Promise<boolean> => {
        try {
            await navigator.clipboard.writeText(content);
            return true;
        } catch {
            return false;
        }
    }, [content]);

    const handleCopy = useCallback(async () => {
        if (!await copy()) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [copy]);

    // A host's own controls do what the band's do (#1209).
    useImperativeHandle(controlsRef, () => ({
        nextMatch: handleNextMatch,
        previousMatch: handlePrevMatch,
        copy,
    }), [handleNextMatch, handlePrevMatch, copy]);

    // The host hears the matches as they change, and only then, whatever
    // function it passes on each render.
    const hearMatches = useRef(onMatchesChange);
    useEffect(() => {
        hearMatches.current = onMatchesChange;
    }, [onMatchesChange]);
    useEffect(() => {
        hearMatches.current?.({ current, count: matches.length });
    }, [current, matches.length]);

    // A view whose host draws its controls draws no band, and its log fills it.
    const bare = !toolbar;

    return (
        <Box css={styles['root']} {...(bare && { 'data-bare': '' })}>
            {toolbar && (
                <Box css={styles['band']}>
                    <Tabs.RootProvider value={tabs} size="sm" variant="line">
                        <Tabs.List css={styles['tabList']}>
                            <Tabs.Trigger value="stdout" css={styles['trigger']}>
                                stdout
                            </Tabs.Trigger>
                            <Tabs.Trigger value="stderr" css={styles['trigger']}>
                                stderr
                            </Tabs.Trigger>
                        </Tabs.List>
                    </Tabs.RootProvider>

                    {/* Search controls, unless the host controls the search */}
                    <Box css={styles['search']}>
                        {search === undefined && (
                            <>
                                <Input
                                    size="xs"
                                    placeholder="Search..."
                                    value={ownSearch}
                                    onChange={(e) => editSearch(e.target.value)}
                                    onKeyDown={handleSearchKeyDown}
                                    css={styles['searchInput']}
                                />
                                {ownSearch && (
                                    <Text css={styles['count']}>
                                        {matches.length > 0 ? `${current + 1}/${matches.length}` : '0/0'}
                                    </Text>
                                )}
                                <IconButton
                                    variant="ghost"
                                    size="xs"
                                    onClick={handlePrevMatch}
                                    css={styles['bandButton']}
                                    aria-label="Previous match"
                                    disabled={matches.length === 0}
                                >
                                    <FontAwesomeIcon icon={faChevronUp} />
                                </IconButton>
                                <IconButton
                                    variant="ghost"
                                    size="xs"
                                    onClick={handleNextMatch}
                                    css={styles['bandButton']}
                                    aria-label="Next match"
                                    disabled={matches.length === 0}
                                >
                                    <FontAwesomeIcon icon={faChevronDown} />
                                </IconButton>
                            </>
                        )}
                        <IconButton
                            variant="ghost"
                            size="xs"
                            onClick={handleCopy}
                            css={styles['bandButton']}
                            aria-label="Copy logs"
                        >
                            <FontAwesomeIcon icon={copied ? faCheck : faCopy} />
                        </IconButton>
                    </Box>
                </Box>
            )}

            {/* Virtualized content */}
            <Box css={styles['body']}>
                <Box
                    ref={parentRef}
                    css={styles['surface']}
                    {...(bare && { 'data-bare': '' })}
                    onScroll={handleScroll}
                >
                <div
                    style={{
                        height: `${virtualizer.getTotalSize()}px`,
                        width: '100%',
                        position: 'relative',
                    }}
                >
                    {virtualizer.getVirtualItems().map((virtualItem) => {
                        const lineIndex = virtualItem.index;
                        const lineText = lines[lineIndex] ?? '';
                        const lineMatches = matchesByLine.get(lineIndex) || [];

                        return (
                            <div
                                key={virtualItem.key}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: `${virtualItem.size}px`,
                                    transform: `translateY(${virtualItem.start}px)`,
                                }}
                            >
                                <Box css={styles['line']}>
                                    <chakra.span css={styles['gutter']}>
                                        {lineIndex + 1}
                                    </chakra.span>
                                    <chakra.span css={styles['text']}>
                                        <HighlightedLine
                                            text={lineText}
                                            lineMatches={lineMatches}
                                            current={current}
                                            styles={styles}
                                        />
                                    </chakra.span>
                                </Box>
                            </div>
                        );
                    })}
                </div>
                </Box>

                {/* New logs notification */}
                {hasNewLogs && (
                    <Box css={styles['newLogs']} onClick={scrollToBottom}>
                        <Badge variant="brand" css={styles['newLogsBadge']}>
                            <FontAwesomeIcon icon={faArrowDown} />
                            New logs
                        </Badge>
                    </Box>
                )}
            </Box>
        </Box>
    );
}
