/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Step-level CLI progress reporting (#311).
 *
 * Long remote operations (deploy, import, export) previously ran silent for
 * tens of seconds; the first line of output must appear within ~1s and a TTY
 * must never sit >5s without visible activity. All progress goes to
 * **stderr** so stdout stays machine-clean.
 *
 * - **TTY**: an active step renders an in-place spinner line (`⠸ text`);
 *   `update` rewrites it, `done` replaces it with a `✔ text` line.
 * - **Non-TTY** (CI, pipes): plain sequential lines, no ANSI — a step prints
 *   `text …` when it starts and `✔ text` when it completes; `update`s are
 *   suppressed.
 * - **`--quiet`**: everything is suppressed (errors still reach the caller).
 */

/** Handle for an in-flight step started with {@link Progress.step}. */
export interface StepHandle {
  /** Replace the step's text (TTY: rewrites the spinner line; non-TTY: ignored). */
  update(text: string): void;
  /** Complete the step, printing `✔ text` (defaults to the last text). */
  done(text?: string): void;
  /** Abandon the step, clearing the spinner line without printing a summary. */
  fail(): void;
}

/** Step-level progress reporter — see the module docs for TTY behaviour. */
export interface Progress {
  /** Print a completed phase line (`✔ text`). */
  phase(text: string): void;
  /** Start a step with live activity; complete it via the returned handle. */
  step(text: string): StepHandle;
  /** Whether output is suppressed (`--quiet`). */
  readonly quiet: boolean;
}

/** Minimal stream surface (injectable for tests). */
export interface ProgressStream {
  write(chunk: string): unknown;
  isTTY?: boolean | undefined;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 100;

/**
 * Create a {@link Progress} reporter.
 *
 * @param options - `quiet` suppresses all output; `stream` defaults to
 *   `process.stderr` (injectable for tests)
 * @returns The reporter
 */
export function createProgress(options?: { quiet?: boolean; stream?: ProgressStream }): Progress {
  const quiet = options?.quiet === true;
  const stream = options?.stream ?? process.stderr;
  const tty = stream.isTTY === true;

  let active: { text: string; timer: ReturnType<typeof setInterval> | undefined; frame: number } | undefined;

  const clearLine = (): void => {
    if (tty) stream.write('\r\x1b[K');
  };

  const renderSpinner = (): void => {
    if (!active) return;
    stream.write(`\r\x1b[K${SPINNER_FRAMES[active.frame % SPINNER_FRAMES.length]} ${active.text}`);
    active.frame++;
  };

  const stopActive = (): void => {
    if (!active) return;
    if (active.timer !== undefined) clearInterval(active.timer);
    clearLine();
    active = undefined;
  };

  const phase = (text: string): void => {
    if (quiet) return;
    const hadActive = active !== undefined;
    const activeText = active?.text;
    stopActive();
    stream.write(`✔ ${text}\n`);
    // Resume the interrupted step's line (a capture phase can complete while
    // a surrounding step is still spinning).
    if (hadActive && activeText !== undefined) {
      startStepInternal(activeText);
    }
  };

  const startStepInternal = (text: string): void => {
    if (tty) {
      active = { text, timer: undefined, frame: 0 };
      renderSpinner();
      active.timer = setInterval(renderSpinner, SPINNER_INTERVAL_MS);
      // Never keep the process alive just for a spinner.
      (active.timer as { unref?: () => void }).unref?.();
    } else {
      active = { text, timer: undefined, frame: 0 };
      stream.write(`${text} …\n`);
    }
  };

  const step = (text: string): StepHandle => {
    if (quiet) {
      return { update: () => undefined, done: () => undefined, fail: () => undefined };
    }
    stopActive();
    startStepInternal(text);
    const mine = active;
    return {
      update(next: string): void {
        if (active !== mine || !active) return;
        active.text = next;
        if (tty) renderSpinner();
        // non-TTY: suppressed — the completion line carries the summary.
      },
      done(finalText?: string): void {
        if (active !== mine || !active) return;
        const summary = finalText ?? active.text;
        stopActive();
        stream.write(`✔ ${summary}\n`);
      },
      fail(): void {
        if (active !== mine || !active) return;
        stopActive();
      },
    };
  };

  return { phase, step, quiet };
}

/**
 * Format a byte count for progress lines (`812 kB`, `1.2 MB`).
 *
 * @param bytes - The byte count
 * @returns Human-readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
