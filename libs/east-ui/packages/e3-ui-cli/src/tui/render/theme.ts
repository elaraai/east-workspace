/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Colour: the design system's semantic tokens mapped onto what the
 * terminal can show.
 *
 * `process.stdout.getColorDepth()` selects truecolor / 256 / 16 colours;
 * `NO_COLOR` forces monochrome (bold / dim / inverse only) and
 * `FORCE_COLOR` overrides detection, the way chalk reads them. The tokens
 * follow `libs/east-ui/app_design_system`: ink is the default foreground,
 * ink-4 is dim, brand (`#488e97`) marks the selection bar and the active
 * tab, pos / neg / warn / info colour status dots — "status is a dot + word,
 * never a tinted badge".
 *
 * @packageDocumentation
 */

/** The colour capability: 0 monochrome, 1 sixteen colours, 2 256 colours, 3 truecolor. */
export type ColorLevel = 0 | 1 | 2 | 3;

/** A stream that may report its colour depth (`process.stdout`). */
export interface ColorStream {
    isTTY?: boolean | undefined;
    getColorDepth?: ((env?: NodeJS.ProcessEnv) => number) | undefined;
}

/**
 * Detects the colour level of `stream` under `env`.
 *
 * @param env - The environment (`NO_COLOR`, `FORCE_COLOR`, `TERM`, `COLORTERM`)
 * @param stream - The output stream
 * @returns The level — `NO_COLOR` (non-empty) wins, then `FORCE_COLOR`
 *   (`0`–`3`, or any other value meaning 16 colours), then the stream's
 *   `getColorDepth()` (1 → 0, 4 → 1, 8 → 2, 24 → 3), then `COLORTERM` /
 *   `TERM` hints, else monochrome
 */
export function detectColorLevel(env: NodeJS.ProcessEnv, stream: ColorStream): ColorLevel {
    const noColor = env['NO_COLOR'];
    if (noColor !== undefined && noColor !== '') return 0;
    const force = env['FORCE_COLOR'];
    if (force !== undefined) {
        if (force === '' || force === 'true') return 1;
        if (force === 'false') return 0;
        const n = Number(force);
        if (n === 0) return 0;
        if (n === 1) return 1;
        if (n === 2) return 2;
        if (n >= 3) return 3;
        return 1;
    }
    if (typeof stream.getColorDepth === 'function') {
        const depth = stream.getColorDepth(env);
        if (depth >= 24) return 3;
        if (depth >= 8) return 2;
        if (depth >= 4) return 1;
        return 0;
    }
    if (env['COLORTERM'] === 'truecolor' || env['COLORTERM'] === '24bit') return 3;
    const term = env['TERM'] ?? '';
    if (term.includes('256color')) return 2;
    if (term !== '' && term !== 'dumb') return 1;
    return 0;
}

/**
 * The semantic colour tokens as Ink colour strings (`#hex`, `ansi256(n)`,
 * or a chalk colour name), or `undefined` when a token falls back to the
 * terminal default in the current level.
 *
 * @property level - The colour level the theme was built for
 * @property ink - Primary text (always the terminal default)
 * @property ink2 - Secondary text
 * @property ink3 - Tertiary text
 * @property ink4 - Muted text (rendered dim)
 * @property brand - Selection bar, active tab, the prompt
 * @property brandTint - The brand's tint, for a filled highlight
 * @property pos - Positive status (complete, up-to-date, connected)
 * @property neg - Negative status (failed, error, offline)
 * @property warn - Warning status (waiting, stale, reconnecting)
 * @property info - Informational status (running, in progress)
 * @property rule - Rules and scrollbar tracks
 */
export interface Theme {
    level: ColorLevel;
    ink: string | undefined;
    ink2: string | undefined;
    ink3: string | undefined;
    ink4: string | undefined;
    brand: string | undefined;
    brandTint: string | undefined;
    pos: string | undefined;
    neg: string | undefined;
    warn: string | undefined;
    info: string | undefined;
    rule: string | undefined;
}

/**
 * Builds the theme for a colour level.
 *
 * @param level - The colour level
 * @returns The theme — truecolor hex at 3, `ansi256(n)` at 2, the sixteen
 *   colour names at 1, and every token `undefined` at 0 (bold / dim /
 *   inverse carry the meaning)
 */
export function createTheme(level: ColorLevel): Theme {
    switch (level) {
        case 3:
            return {
                level,
                ink: undefined,
                ink2: '#9aa5a7',
                ink3: '#7d8a8c',
                ink4: undefined,
                brand: '#488e97',
                brandTint: '#2f5c62',
                pos: '#2f7a5b',
                neg: '#b85a4a',
                warn: '#b8862d',
                info: '#3a7780',
                rule: '#5f6b6d',
            };
        case 2:
            return {
                level,
                ink: undefined,
                ink2: 'ansi256(247)',
                ink3: 'ansi256(244)',
                ink4: undefined,
                brand: 'ansi256(73)',
                brandTint: 'ansi256(23)',
                pos: 'ansi256(29)',
                neg: 'ansi256(131)',
                warn: 'ansi256(136)',
                info: 'ansi256(30)',
                rule: 'ansi256(240)',
            };
        case 1:
            return {
                level,
                ink: undefined,
                ink2: undefined,
                ink3: undefined,
                ink4: undefined,
                brand: 'cyan',
                brandTint: 'cyan',
                pos: 'green',
                neg: 'red',
                warn: 'yellow',
                info: 'blue',
                rule: undefined,
            };
        default:
            return {
                level: 0,
                ink: undefined,
                ink2: undefined,
                ink3: undefined,
                ink4: undefined,
                brand: undefined,
                brandTint: undefined,
                pos: undefined,
                neg: undefined,
                warn: undefined,
                info: undefined,
                rule: undefined,
            };
    }
}

/** The tone a status word or dot carries. */
export type Tone = 'pos' | 'neg' | 'warn' | 'info' | 'muted' | 'brand' | 'plain';

/**
 * The theme colour of a tone (`undefined` = the terminal default).
 *
 * @param theme - The theme
 * @param tone - The tone
 * @returns The Ink colour string, if any
 */
export function toneColor(theme: Theme, tone: Tone): string | undefined {
    switch (tone) {
        case 'pos': return theme.pos;
        case 'neg': return theme.neg;
        case 'warn': return theme.warn;
        case 'info': return theme.info;
        case 'brand': return theme.brand;
        case 'muted': return theme.ink4;
        default: return undefined;
    }
}
