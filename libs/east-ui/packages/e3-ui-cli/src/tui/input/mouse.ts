/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * SGR mouse reporting — the sequences (`ESC [ < b ; x ; y M|m`) Ink hands
 * `useInput` intact (with the leading ESC stripped) once
 * `?1000;1002;1006h` is on: presses, releases, drags, wheel ticks and the
 * modifiers. `--no-mouse`, `TERM=dumb` and a non-TTY stdout keep the
 * enable sequence unwritten; every exit path writes the disable one.
 *
 * @packageDocumentation
 */

/** One mouse event, 0-based cells. */
export interface MouseEvent {
    kind: 'press' | 'release' | 'drag' | 'move' | 'wheelUp' | 'wheelDown';
    button: 'left' | 'middle' | 'right' | 'none';
    x: number;
    y: number;
    shift: boolean;
    alt: boolean;
    ctrl: boolean;
}

/** Turns SGR reporting on (buttons, drags, SGR encoding). */
export const MOUSE_ON = '\x1b[?1000h\x1b[?1002h\x1b[?1006h';
/** Turns SGR reporting off (the reverse order). */
export const MOUSE_OFF = '\x1b[?1006l\x1b[?1002l\x1b[?1000l';

const ONE = /\x1b?\[<(\d+);(\d+);(\d+)([mM])/g;
const ALL = /^(?:\x1b?\[<\d+;\d+;\d+[mM])+$/;

/**
 * Whether an input chunk is one or more SGR mouse reports.
 *
 * @param input - Ink's `input`
 * @returns `true` for mouse reports only
 */
export function isMouseInput(input: string): boolean {
    return ALL.test(input);
}

/**
 * Parses the SGR mouse reports in an input chunk.
 *
 * @param input - Ink's `input` (one or more reports, ESC optional)
 * @returns The events, in order
 */
export function parseSgr(input: string): MouseEvent[] {
    const out: MouseEvent[] = [];
    for (const m of input.matchAll(ONE)) {
        const code = Number(m[1]);
        const x = Number(m[2]) - 1;
        const y = Number(m[3]) - 1;
        const release = m[4] === 'm';
        const wheel = (code & 64) !== 0;
        const motion = (code & 32) !== 0;
        const low = code & 3;
        const button: MouseEvent['button'] = wheel ? 'none' : low === 0 ? 'left' : low === 1 ? 'middle' : low === 2 ? 'right' : 'none';
        const kind: MouseEvent['kind'] = wheel ? (low === 0 ? 'wheelUp' : 'wheelDown')
            : release ? 'release'
            : motion ? (button === 'none' ? 'move' : 'drag')
            : 'press';
        out.push({ kind, button, x: Math.max(0, x), y: Math.max(0, y), shift: (code & 4) !== 0, alt: (code & 8) !== 0, ctrl: (code & 16) !== 0 });
    }
    return out;
}

/**
 * Whether mouse reporting can be turned on for this terminal.
 *
 * @param env - The environment (`TERM`)
 * @param stdout - The output stream
 * @returns `true` for a TTY that is not `dumb`
 */
export function mouseSupported(env: NodeJS.ProcessEnv, stdout: { isTTY?: boolean | undefined }): boolean {
    return stdout.isTTY === true && env['TERM'] !== 'dumb';
}
