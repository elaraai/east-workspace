/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The overlay editor for a SCALAR cell (B§4.4 / B§6): one mono input over
 * the cell at inset −1 with the 2 px brand ring, the inline ghost drawn in a
 * mirror behind the caret, a `→ replacement` preview and a `k/n` badge on
 * the right, and the neg ring when the last commit was unrecognised. The
 * two-half link editor lands in P3.
 *
 * The editor stops keyboard propagation: the sheet owns every other key.
 */

import { memo, useLayoutEffect, useRef, type KeyboardEvent, type ChangeEvent } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRightLong } from "@fortawesome/free-solid-svg-icons";

type Styles = Record<string, Record<string, unknown>>;

/** A focus request — bumped by the machine's `focus.editor` effect. */
export interface EditorFocusRequest {
    seq: number;
    selectAll: boolean;
}

export interface SheetEditorProps {
    styles: Styles;
    value: string;
    /** The inline ghost (the top prefix candidate's suffix). */
    ghost: string;
    /** A non-prefix match, previewed as a replacement. */
    resolve: string;
    /** `k/n` over the candidates. */
    badge: string;
    /** The neg ring. */
    error: boolean;
    focus: EditorFocusRequest;
    ariaLabel: string;
    onChange: (val: string) => void;
    onKey: (e: { key: string; shift: boolean; meta: boolean; alt: boolean; atEnd: boolean }) => boolean;
    onBlur: () => void;
}

/** Renders the scalar overlay editor. */
export const SheetEditor = memo(function SheetEditor({ styles, value, ghost, resolve, badge, error, focus, ariaLabel, onChange, onKey, onBlur }: SheetEditorProps) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const lastFocus = useRef(-1);
    useLayoutEffect(() => {
        const el = inputRef.current;
        if (el === null || lastFocus.current === focus.seq) return;
        lastFocus.current = focus.seq;
        el.focus({ preventScroll: true });
        if (focus.selectAll) el.select();
        else el.setSelectionRange(el.value.length, el.value.length);
    }, [focus]);

    const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
        const el = e.currentTarget;
        const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
        const handled = onKey({ key: e.key, shift: e.shiftKey, meta: e.metaKey || e.ctrlKey, alt: e.altKey, atEnd });
        if (handled) e.preventDefault();
    };
    const handleChange = (e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value);

    return (
        <>
            <Box css={styles.editor} data-slot="editor" data-error={error ? "" : undefined} onMouseDown={(e) => e.stopPropagation()}>
                <Box css={styles.editorField}>
                    <Box css={styles.editorMirror} aria-hidden="true">
                        <span style={{ visibility: "hidden" }}>{value}</span>
                        <Box as="span" css={styles.editorGhost} data-slot="editorGhost">{ghost}</Box>
                    </Box>
                    <chakra.input
                        ref={inputRef}
                        css={styles.editorInput}
                        value={value}
                        aria-label={ariaLabel}
                        aria-autocomplete="inline"
                        data-slot="editorInput"
                        onChange={handleChange}
                        onKeyDown={handleKey}
                        onBlur={onBlur}
                        onCopy={(e) => e.stopPropagation()}
                        onPaste={(e) => e.stopPropagation()}
                    />
                </Box>
                {(resolve !== "" || badge !== "") && (
                    <Box display="flex" alignItems="center" gap="8px" paddingLeft="8px" flex="none">
                        {resolve !== "" && (
                            <Box as="span" css={styles.editorResolve} data-slot="editorResolve">
                                <FontAwesomeIcon icon={faArrowRightLong} style={{ fontSize: "9px" }} />
                                {resolve}
                            </Box>
                        )}
                        {badge !== "" && <Box as="span" css={styles.editorBadge}>{badge}</Box>}
                    </Box>
                )}
            </Box>
            {error && <Box css={styles.editorError} data-slot="editorError" />}
        </>
    );
});
