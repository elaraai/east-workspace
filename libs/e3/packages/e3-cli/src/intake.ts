/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * How taking files into a repository shows as it goes: a `✔` line per file as
 * it finishes — its name, size, time, rate and how it was taken in, naming the
 * runner that took it in — and, on a terminal, a live line for the files in
 * flight, each with how far it has got, and the rate and time left across them
 * all.
 *
 * A file is hashed before it is taken in: the hash is how the store knows a
 * delivery it already holds, which then costs nothing more. A collection is
 * then taken in by intake units on the runners, a piece of its segments each,
 * and moves forward as each piece finishes. The live line says which a file is
 * doing. A runner that fell back to another says why once, on the line of the
 * first file it took in.
 *
 * Against a server, a delivery is hashed here first, saying how far the read
 * has got, and the rest shows as the server says it: what its commit of the
 * upload is doing with the file, and what its deploy job is doing. A deploy
 * uploads its file sources side by side, shown as a local deploy's are: a `✔`
 * line per file as it finishes, and a live line for the files in flight.
 */

import { sha256File } from '@elaraai/e3';
import type { DatasetTaken, DeploySourceProgress } from '@elaraai/e3-core';
import type { DeployProgress, IntakeFile } from '@elaraai/e3-types';
import { formatBytes, type Progress, type StepHandle } from './progress.js';

/** How often the live line is redrawn, at most. */
const REDRAW_MS = 100;

/** How many files in flight the live line names; it counts the rest. */
const NAMED_IN_FLIGHT = 3;

/** What a file's line says of how it was taken in. */
function takenText(file: Pick<DeploySourceProgress, 'taken' | 'runners'>): string {
  switch (file.taken) {
    case 'known': return 'unchanged, already in the store';
    case 'taken': return file.runners === undefined || file.runners.length === 0
      ? 'taken in from the pieces an earlier intake finished'
      : `taken in by ${file.runners.join(' and ')}`;
    default: return 'carried';
  }
}

/** What each way a file was taken in says in the summary. */
const TAKEN_SHORT: Record<DatasetTaken, string> = { known: 'unchanged', carried: 'carried', taken: 'taken in' };

/** A file in flight. */
interface InFlight {
  readonly name: string;
  readonly since: number;
  phase: 'hash' | 'take-in';
  bytes: number;
  total: number;
  pieces: { readonly done: number; readonly total: number } | undefined;
}

/** Reports files as they are taken in. */
export interface IntakeReporter {
  /**
   * Hears how far a file has got.
   *
   * @param progress - The file's progress, with every file the intake takes in
   */
  report(progress: DeploySourceProgress): void;
  /** Ends the live line without a summary: the intake failed. */
  fail(): void;
}

/**
 * Builds the reporter of an intake of files.
 *
 * @param progress - Where the lines go
 * @param now - The clock, in milliseconds (injectable for tests)
 * @returns The reporter, which completes its live line with a summary once the
 *   last of the files it hears of is in
 */
export function intakeReporter(progress: Progress, now: () => number = Date.now): IntakeReporter {
  const inFlight = new Map<string, InFlight>();
  const taken: Record<DatasetTaken, number> = { known: 0, carried: 0, taken: 0 };
  let step: StepHandle | undefined;
  let started = 0;
  let finished = 0;
  let finishedBytes = 0;
  let drawn = 0;
  let fellBack = false;

  /** Bytes taken in so far: every finished file's, and the in-flight files'
   *  past their hash. */
  const moved = (): number => {
    let bytes = finishedBytes;
    for (const file of inFlight.values()) if (file.phase === 'take-in') bytes += file.bytes;
    return bytes;
  };

  const live = (sources: DeploySourceProgress['sources']): string => {
    const done = moved();
    const seconds = (now() - started) / 1000;
    const rate = seconds > 0 ? done / seconds : 0;
    const files = [...inFlight.values()];
    const named = files.slice(0, NAMED_IN_FLIGHT).map((file) => {
      const pieces = file.phase === 'take-in' && file.pieces !== undefined && file.pieces.total > 1 ? ` (${file.pieces.done}/${file.pieces.total} pieces)` : '';
      return `${file.name} ${file.phase === 'hash' ? 'hashing ' : ''}${formatBytes(file.bytes)}/${formatBytes(file.total)}${pieces}`;
    });
    if (files.length > NAMED_IN_FLIGHT) named.push(`${files.length - NAMED_IN_FLIGHT} more`);
    const pace = rate > 0 ? `, ${formatBytes(rate)}/s, ${formatSeconds((sources.bytes - done) / rate)} left` : '';
    return `taking in ${finished}/${sources.count} files, ${formatBytes(done)}/${formatBytes(sources.bytes)}${pace}: ${named.join(', ')}`;
  };

  const draw = (sources: DeploySourceProgress['sources'], force: boolean): void => {
    const at = now();
    if (!force && at - drawn < REDRAW_MS) return;
    drawn = at;
    step?.update(live(sources));
  };

  const summary = (sources: DeploySourceProgress['sources']): string => {
    const seconds = (now() - started) / 1000;
    const how = (Object.keys(TAKEN_SHORT) as DatasetTaken[])
      .filter((way) => taken[way] > 0)
      .map((way) => `${taken[way]} ${TAKEN_SHORT[way]}`);
    const files = `${sources.count} file${sources.count === 1 ? '' : 's'}`;
    return `took in ${files}, ${formatBytes(sources.bytes)} in ${formatSeconds(seconds)}${rateOf(sources.bytes, seconds)}: ${how.join(', ')}`;
  };

  return {
    report(p) {
      if (step === undefined) {
        started = now();
        step = progress.step(`taking in ${p.sources.count} file${p.sources.count === 1 ? '' : 's'} (${formatBytes(p.sources.bytes)})`);
      }
      const name = p.path.split('/').pop() ?? p.path;
      if (p.phase === 'done') {
        const file = inFlight.get(p.path);
        inFlight.delete(p.path);
        finished++;
        finishedBytes += p.total;
        const way = p.taken ?? 'carried';
        taken[way]++;
        const seconds = (now() - (file?.since ?? now())) / 1000;
        // Why a runner fell back is said once, on the first file it touched.
        const why = p.fallback !== undefined && !fellBack ? `, since ${p.fallback}` : '';
        if (p.fallback !== undefined) fellBack = true;
        progress.phase(`${name} ${formatBytes(p.total)} in ${formatSeconds(seconds)}${rateOf(p.total, seconds)}, ${takenText(p)}${why}`);
        if (finished === p.sources.count) {
          step.done(summary(p.sources));
        } else {
          draw(p.sources, true);
        }
        return;
      }
      const file = inFlight.get(p.path) ?? { name, since: now(), phase: p.phase, bytes: 0, total: p.total, pieces: undefined };
      file.phase = p.phase;
      file.bytes = p.bytes;
      file.total = p.total;
      file.pieces = p.pieces;
      inFlight.set(p.path, file);
      draw(p.sources, false);
    },
    fail() {
      step?.fail();
    },
  };
}

/** A file being uploaded, as the live line shows it. */
interface Uploading {
  readonly name: string;
  /** What it is doing, as the live line says it after its name. */
  doing: string;
}

/** One upload, as it tells an {@link UploadReporter} how far it has got. */
export interface UploadHandle {
  /**
   * Hears how far this machine has hashed the file.
   *
   * @param bytes - The bytes read so far
   */
  hashing(bytes: number): void;
  /** Hears that the file's bytes are being sent. */
  sending(): void;
  /**
   * Hears how far the server's commit has taken the file in.
   *
   * @param file - How far it has got, as the server says
   */
  committing(file: IntakeFile): void;
  /**
   * Prints the file's line: it is in.
   *
   * @param text - What the line says
   */
  done(text: string): void;
}

/** Reports files uploaded side by side. */
export interface UploadReporter {
  /**
   * Starts a file's upload, which joins the live line.
   *
   * @param name - What the lines call the file
   * @param total - Its size
   * @returns Where the upload says how far it has got
   */
  start(name: string, total: number): UploadHandle;
  /** Ends the live line without a summary: an upload failed, and the uploads
   *  still in flight are no longer heard. */
  fail(): void;
}

/**
 * Builds the reporter of files uploaded side by side: a `✔` line per file as
 * it finishes, a summary once the last is in, and on a terminal a live line
 * naming the files in flight, each with what it is doing — hashing here,
 * sending, or being taken in by the server's commit.
 *
 * @param progress - Where the lines go
 * @param count - How many files
 * @param bytes - Their bytes between them
 * @param now - The clock, in milliseconds (injectable for tests)
 * @returns The reporter, whose live line starts at once
 */
export function uploadReporter(progress: Progress, count: number, bytes: number, now: () => number = Date.now): UploadReporter {
  const files = `${count} file${count === 1 ? '' : 's'}`;
  const started = now();
  const step = progress.step(`uploading ${files} (${formatBytes(bytes)})`);
  const inFlight = new Set<Uploading>();
  let finished = 0;
  let drawn = 0;
  let failed = false;

  const draw = (force: boolean): void => {
    const at = now();
    if (!force && at - drawn < REDRAW_MS) return;
    drawn = at;
    const named = [...inFlight].slice(0, NAMED_IN_FLIGHT).map((file) => `${file.name} ${file.doing}`);
    if (inFlight.size > NAMED_IN_FLIGHT) named.push(`${inFlight.size - NAMED_IN_FLIGHT} more`);
    step.update(`uploading ${finished}/${count} files: ${named.join(', ')}`);
  };

  return {
    start(name, total) {
      const file: Uploading = { name, doing: `hashing 0 B/${formatBytes(total)}` };
      const hear = (doing: string, force: boolean): void => {
        if (failed || !inFlight.has(file)) return;
        file.doing = doing;
        draw(force);
      };
      if (!failed) {
        inFlight.add(file);
        draw(true);
      }
      return {
        hashing: (read) => hear(`hashing ${formatBytes(read)}/${formatBytes(total)}`, false),
        sending: () => hear(`sending ${formatBytes(total)}`, true),
        committing: (intake) => hear(`server ${serverDoing(intake)}`, false),
        done(text) {
          if (failed || !inFlight.delete(file)) return;
          finished++;
          progress.phase(text);
          if (finished < count) {
            draw(true);
            return;
          }
          const seconds = (now() - started) / 1000;
          step.done(`uploaded ${files}, ${formatBytes(bytes)} in ${formatSeconds(seconds)}${rateOf(bytes, seconds)}`);
        },
      };
    },
    fail() {
      failed = true;
      step.fail();
    },
  };
}

/** What a server's commit is doing with an upload, as the live line says it. */
function serverDoing(file: IntakeFile): string {
  const moved = `${formatBytes(Number(file.bytes))}/${formatBytes(Number(file.total))}`;
  switch (file.step.type) {
    case 'waiting': return 'waiting';
    case 'hashing': return `hashing ${moved}`;
    case 'taking_in': {
      const { pieces, done } = file.step.value;
      return `taking in ${moved}${pieces > 1n ? ` (${done}/${pieces} pieces)` : ''}`;
    }
    default: return 'done';
  }
}

/**
 * Hashes a delivery before it is uploaded, saying on the upload's line how far
 * the read has got: the hash is how the server knows a delivery it already
 * holds, which then costs no upload at all.
 *
 * @param file - The delivery
 * @param size - Its size
 * @param name - What the line calls it
 * @param step - The upload's line
 * @param now - The clock, in milliseconds (injectable for tests)
 * @returns The file's SHA-256, as lowercase hex
 */
export async function hashDelivery(file: string, size: number, name: string, step: StepHandle, now: () => number = Date.now): Promise<string> {
  let drawn = 0;
  return sha256File(file, (bytes) => {
    const at = now();
    if (at - drawn < REDRAW_MS) return;
    drawn = at;
    step.update(`hashing ${name}: ${formatBytes(bytes)}/${formatBytes(size)}`);
  });
}

/**
 * What a server says of a delivery its commit is taking in, as the line that
 * uploaded it shows it: `the server is hashing it: 12.0 MB/67.4 MB`, then
 * `taking it in`, with its pieces when it has several.
 *
 * @param file - How far the commit has got, as the server says
 * @returns The text
 */
export function commitText(file: IntakeFile): string {
  const doing = file.step.type === 'hashing' ? 'hashing it'
    : file.step.type === 'taking_in'
      ? (file.step.value.pieces > 1n ? `taking it in (${file.step.value.done}/${file.step.value.pieces} pieces)` : 'taking it in')
    : file.step.type === 'waiting' ? 'about to take it in'
    : 'done with it';
  return `the server is ${doing}: ${formatBytes(Number(file.bytes))}/${formatBytes(Number(file.total))}`;
}

/**
 * What a server's deploy job says it is doing, as the line that waits for it
 * shows it: its file sources while it takes them in, then the record it
 * migrates or builds an index of, or `finishing`.
 *
 * @param progress - How far the job has got, as the server says
 * @returns The text
 */
export function deployJobText(progress: DeployProgress): string {
  const files = progress.files;
  const done = files.filter((file) => file.step.type === 'done').length;
  if (done < files.length) return `taking in ${done}/${files.length} files`;
  for (const record of progress.records) {
    const name = record.plan.record.split('/').pop() ?? record.plan.record;
    if (record.step.type === 'migrating') {
      return `migrating ${name}: ${record.step.value.name} (${record.step.value.step}/${record.step.value.steps})`;
    }
    if (record.step.type === 'indexing') {
      return `building ${name}.${record.step.value.index} (${record.step.value.build}/${record.step.value.builds})`;
    }
  }
  return 'finishing';
}

/** `12.3 s`, or `2 min 5 s` past a minute. */
function formatSeconds(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

/** ` (58.2 MB/s)`, or nothing for no time at all. */
function rateOf(bytes: number, seconds: number): string {
  return seconds > 0 ? ` (${formatBytes(bytes / seconds)}/s)` : '';
}
