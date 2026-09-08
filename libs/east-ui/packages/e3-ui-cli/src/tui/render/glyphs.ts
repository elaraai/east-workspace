/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The glyph sets — one unicode, one ASCII — every view draws with. Chosen
 * once at start-up by {@link selectGlyphs}: `--ascii`, `E3_UI_ASCII=1`, a
 * non-UTF-8 locale or `TERM=linux` select the ASCII set.
 *
 * @packageDocumentation
 */

/**
 * The named glyphs of a set.
 *
 * @property expanded - An expanded tree row's twist (`▾`)
 * @property collapsed - A collapsed tree row's twist (`▸`)
 * @property leaf - A leaf row's marker (`·`)
 * @property add - The append ghost row's marker (`+`)
 * @property dot - Complete / up-to-date / connected (`●`)
 * @property half - Waiting / stale / reconnecting (`◐`)
 * @property quarter - In progress / running (`◔`)
 * @property empty - Ready / unset / never (`○`)
 * @property cross - Failed / error / offline (`✗`)
 * @property diamond - Dirty / pending edits (`◆`)
 * @property sel - The selection bar (`▌`)
 * @property tabL - The active tab's left bracket (`▌`)
 * @property tabR - The active tab's right bracket (`▐`)
 * @property rule - The full-width rule (`─`)
 * @property dashed - The dashed section rule (`┄`)
 * @property vbar - The scrollbar track (`│`)
 * @property scrollUp - The scrollbar's top cap (`▲`)
 * @property thumb - The scrollbar's thumb (`█`)
 * @property scrollDown - The scrollbar's bottom cap (`▼`)
 * @property placeholder - An unloaded row's fill (`░`)
 * @property loading - The loading marker (`▒`)
 * @property spinner - The braille spinner frames
 * @property crumb - The breadcrumb separator (`›`)
 * @property prompt - The command box prompt (`›`)
 * @property sep - The inline separator (`·`)
 * @property enter - The Enter key (`⏎`)
 * @property up - The up arrow (`↑`)
 * @property down - The down arrow (`↓`)
 * @property left - The left arrow (`←`)
 * @property right - The right arrow (`→`)
 * @property backspace - The backspace key (`⌫`)
 * @property shift - The shift key (`⇧`)
 * @property edited - The changed-row marker (`┆`)
 * @property square - The stop marker (`■`)
 * @property bullet - The note marker (`▪`)
 * @property bars - The accounted bar's steps, low to high (`▁▃▅▇`)
 * @property ellipsis - The truncation marker (`…`)
 * @property cursor - The command box caret (`_`)
 * @property hidden - A hidden collapsed marker for the shift-left hint
 */
export interface Glyphs {
    expanded: string;
    collapsed: string;
    leaf: string;
    add: string;
    dot: string;
    half: string;
    quarter: string;
    empty: string;
    cross: string;
    diamond: string;
    sel: string;
    tabL: string;
    tabR: string;
    rule: string;
    dashed: string;
    vbar: string;
    scrollUp: string;
    thumb: string;
    scrollDown: string;
    placeholder: string;
    loading: string;
    spinner: readonly string[];
    crumb: string;
    prompt: string;
    sep: string;
    enter: string;
    up: string;
    down: string;
    left: string;
    right: string;
    backspace: string;
    shift: string;
    edited: string;
    square: string;
    bullet: string;
    bars: readonly string[];
    ellipsis: string;
    cursor: string;
}

/** The unicode glyph set (the design's mocks). */
export const UNICODE: Glyphs = {
    expanded: '▾',
    collapsed: '▸',
    leaf: '·',
    add: '+',
    dot: '●',
    half: '◐',
    quarter: '◔',
    empty: '○',
    cross: '✗',
    diamond: '◆',
    sel: '▌',
    tabL: '▌',
    tabR: '▐',
    rule: '─',
    dashed: '┄',
    vbar: '│',
    scrollUp: '▲',
    thumb: '█',
    scrollDown: '▼',
    placeholder: '░',
    loading: '▒',
    spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
    crumb: '›',
    prompt: '›',
    sep: '·',
    enter: '⏎',
    up: '↑',
    down: '↓',
    left: '←',
    right: '→',
    backspace: '⌫',
    shift: '⇧',
    edited: '┆',
    square: '■',
    bullet: '▪',
    bars: ['▁', '▃', '▅', '▇'],
    ellipsis: '…',
    cursor: '_',
};

/** The ASCII glyph set (`--ascii`, `E3_UI_ASCII=1`, non-UTF-8 locales, `TERM=linux`). */
export const ASCII: Glyphs = {
    expanded: 'v',
    collapsed: '>',
    leaf: '-',
    add: '+',
    dot: '*',
    half: 'o',
    quarter: 'o',
    empty: '.',
    cross: 'x',
    diamond: '+',
    sel: '>',
    tabL: '[',
    tabR: ']',
    rule: '-',
    dashed: '.',
    vbar: '|',
    scrollUp: '^',
    thumb: '#',
    scrollDown: 'v',
    placeholder: ':',
    loading: ';',
    spinner: ['-', '\\', '|', '/'],
    crumb: '>',
    prompt: '>',
    sep: '.',
    enter: 'Enter',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    backspace: 'Bksp',
    shift: 'Shift-',
    edited: '|',
    square: '#',
    bullet: '*',
    bars: ['_', '.', ':', '|'],
    ellipsis: '...',
    cursor: '_',
};

/** What {@link selectGlyphs} looks at. */
export interface GlyphSelection {
    /** `--ascii` was given. */
    ascii?: boolean | undefined;
    /** The environment (`E3_UI_ASCII`, `LANG` / `LC_ALL` / `LC_CTYPE`, `TERM`). */
    env: NodeJS.ProcessEnv;
}

/**
 * Whether the locale declares a UTF-8 charset (a missing locale counts as
 * UTF-8 — every modern terminal is — while an explicit non-UTF-8 charset
 * selects ASCII).
 *
 * @param env - The environment
 * @returns `true` unless a locale variable names a non-UTF-8 charset
 */
export function localeIsUtf8(env: NodeJS.ProcessEnv): boolean {
    const locale = env['LC_ALL'] || env['LC_CTYPE'] || env['LANG'];
    if (locale === undefined || locale === '' || locale === 'C' || locale === 'POSIX') return true;
    const dot = locale.indexOf('.');
    if (dot === -1) return true;
    const charset = locale.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
    return charset === 'utf8';
}

/**
 * Selects the glyph set for this session.
 *
 * @param selection - The flag and the environment
 * @returns {@link ASCII} for `--ascii`, `E3_UI_ASCII=1`, a non-UTF-8 locale or `TERM=linux`; else {@link UNICODE}
 */
export function selectGlyphs(selection: GlyphSelection): Glyphs {
    if (selection.ascii === true) return ASCII;
    if (selection.env['E3_UI_ASCII'] === '1') return ASCII;
    if (selection.env['TERM'] === 'linux') return ASCII;
    if (!localeIsUtf8(selection.env)) return ASCII;
    return UNICODE;
}
