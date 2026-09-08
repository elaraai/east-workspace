/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The "ELARA AI" wordmark in the ANSI-shadow block font (the launch and
 * about screens), composed per glyph so the rows align — the same
 * generator as the design's mocks.
 *
 * @packageDocumentation
 */

const GLYPH: Record<string, string[]> = {
    E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
    L: ['██╗     ', '██║     ', '██║     ', '██║     ', '███████╗', '╚══════╝'],
    A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
    R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
    I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
    ' ': ['    ', '    ', '    ', '    ', '    ', '    '],
};

const ASCII_GLYPH: Record<string, string[]> = {
    E: ['#######', '#      ', '#####  ', '#      ', '#######', '       '],
    L: ['#      ', '#      ', '#      ', '#      ', '#######', '       '],
    A: [' ##### ', '#     #', '#######', '#     #', '#     #', '       '],
    R: ['###### ', '#     #', '###### ', '#   #  ', '#    # ', '       '],
    I: ['#', '#', '#', '#', '#', ' '],
    ' ': ['   ', '   ', '   ', '   ', '   ', '   '],
};

/**
 * The wordmark's six rows.
 *
 * @param text - The text to set (letters E L A R I and space)
 * @param ascii - Use the ASCII font
 * @returns Six rows of equal width
 */
export function blockText(text: string, ascii = false): string[] {
    const font = ascii ? ASCII_GLYPH : GLYPH;
    const rows = ['', '', '', '', '', ''];
    for (const ch of text) {
        const glyph = font[ch] ?? font[' ']!;
        for (let i = 0; i < 6; i++) rows[i] += glyph[i] + (ch === ' ' ? '' : ' ');
    }
    const width = Math.max(...rows.map(r => r.replace(/\s+$/, '').length));
    return rows.map(r => r.replace(/\s+$/, '').padEnd(width));
}

/** The product wordmark. */
export function wordmark(ascii = false): string[] {
    return blockText('ELARA AI', ascii);
}
