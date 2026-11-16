/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Work a command waits on that Ctrl-C stops.
 */

/**
 * Runs work that Ctrl-C stops: the work is given a signal Ctrl-C aborts, and
 * ends by it — a call a server keeps is given up, a lease on a rack is left.
 * A second Ctrl-C stops this process at once.
 *
 * @remarks
 * Work that ends after Ctrl-C was interrupted, whatever it answered or threw:
 * `said` is printed to stderr, and the process exits with 130 once the
 * command returns.
 *
 * @param work - The work, given the signal Ctrl-C aborts
 * @param said - What Ctrl-C did, after `Interrupted: `
 * @returns What the work answered, or null once Ctrl-C has stopped it
 * @throws What the work throws, unless Ctrl-C stopped it
 * @example
 * const result = await untilInterrupted((signal) => runner.runDetached(spec, { signal }), 'the call\'s rack is told to stop it');
 * if (result === null) return;
 */
export async function untilInterrupted<T>(work: (signal: AbortSignal) => Promise<T>, said: string): Promise<T | null> {
  const stop = new AbortController();
  const interrupt = (): void => stop.abort(new Error('interrupted'));
  process.once('SIGINT', interrupt);
  try {
    const result = await work(stop.signal);
    if (!stop.signal.aborted) return result;
  } catch (err) {
    if (!stop.signal.aborted) throw err;
  } finally {
    process.off('SIGINT', interrupt);
  }
  console.error(`Interrupted: ${said}`);
  process.exitCode = 130;
  return null;
}
