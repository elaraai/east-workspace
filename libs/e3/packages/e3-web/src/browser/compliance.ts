/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * east-node-std's compliance suite over east-web-std, in Chromium: what its
 * test page (`compliance.page.ts`) and its spec (`compliance.spec.ts`) share.
 *
 * `make -C libs/east-node test-export-std` writes east-node-std's East test
 * suites as IR, one JSON file per module's suite, to `EAST_NODE_STD_IR` (or
 * `/tmp/east-node-std`). The spec has the harness serve that directory under
 * {@link SUITES}; the page loads a module's suite from there, runs it over
 * east-web-std, and answers what each of its East suites and tests did.
 *
 * @packageDocumentation
 */

/** The name the harness serves the export under: a module's suite is at
 *  `/<SUITES>/<its file>`. */
export const SUITES = 'east-node-std';

/**
 * The file east-node-std's `describeEast` exports a module's suite to.
 *
 * @param module - The module, by east-node-std's name for it (`Fetch`)
 * @returns The suite's file name in the export
 */
export function suiteFile(module: string): string {
  return `${module}_platform_functions.json`;
}

/**
 * What an East suite (`describe`) or test did, as the page's test host
 * recorded it.
 */
export interface EastTestRecord {
  /** A suite, or a test */
  readonly kind: 'describe' | 'test';
  /** The suites it is in, outermost first, then its own name */
  readonly path: readonly string[];
  /** Whether its body ran to its end */
  readonly passed: boolean;
  /** Why it failed — the failed assertion's message, or the error's, with
   *  the East locations it was raised at — or `null` when it passed */
  readonly message: string | null;
}

/**
 * What a suite's program did, run in the page.
 */
export interface SuiteRun {
  /** Each suite and test the program declared, in the order each started */
  readonly records: readonly EastTestRecord[];
  /** What the program wrote to standard output, through the page's console
   *  sink */
  readonly stdout: string;
  /** What it wrote to standard error */
  readonly stderr: string;
  /** Why the program failed outside its suites — it did not compile, say —
   *  or `null` */
  readonly error: string | null;
}

/**
 * The modules whose suites the page runs, and those it does not.
 */
export interface ComplianceModules {
  /** The modules east-web-std provides: the page runs each one's suite */
  readonly provided: readonly string[];
  /** The modules a browser has no meaning for, which east-web-std leaves
   *  out */
  readonly notProvided: readonly string[];
}
