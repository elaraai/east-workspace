/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The compliance spec's test page: east-node-std's exported compliance suite,
 * run over east-web-std in a browser, as east-web-std's Node leg runs it in
 * Node.
 *
 * It loads a module's suite from where the harness serves the export, and
 * runs its program over `createWebPlatform({ console, test })`: the program's
 * console output goes to a sink of the page's, and its suites and tests run
 * through a test host that records each one — its name path, whether it
 * passed, and why it failed. A canary program, built here, has a test that
 * passes, one whose assertion fails, one that raises an East error and a suite
 * that fails outside its tests, so the spec can show that the page reports a
 * failure as one.
 *
 * The harness bundles it for Chromium; `compliance.spec.ts` drives it.
 *
 * @packageDocumentation
 */

import {
  ArrayType,
  AsyncEastIR,
  AsyncFunctionType,
  East,
  EastError,
  IntegerType,
  IRType,
  NullType,
  SourceMap,
  StringType,
  StructType,
  decodeJSONFor,
  setLocationCapture,
} from '@elaraai/east';
import { TestFailure, createWebPlatform, type TestHost } from '@elaraai/east-web-std';
import { SUITES, suiteFile, type ComplianceModules, type EastTestRecord, type SuiteRun } from './compliance.js';
import { servePage } from './page.js';

/** The modules east-web-std provides: the page runs each one's suite. */
const PROVIDED = ['Console', 'Crypto', 'Fetch', 'Path', 'Random', 'Time'];

/** The modules a browser has no meaning for, which east-web-std leaves out. */
const NOT_PROVIDED = ['Env', 'FileSystem', 'Json'];

// The canary is built in this bundle, where East's frames and the page's share
// a file and a captured location would name nothing: its nodes carry none, so
// its errors' messages are theirs alone.
setLocationCapture(false);

// The wrapper east-node-std's `describeEast` exports a suite in: the suite's
// IR, and the stacks its location ids name
const LocationType = StructType({ column: IntegerType, filename: StringType, line: IntegerType });
const SourceMapType = StructType({ stacks: ArrayType(ArrayType(LocationType)) });
const ExportWrapperType = StructType({ ir: IRType, source_map: SourceMapType });
const decodeSuite = decodeJSONFor(ExportWrapperType);

/**
 * Loads a module's suite from where the harness serves the export, with the
 * source map its location ids resolve against.
 *
 * @param module - The module, by east-node-std's name for it
 * @returns The suite's program
 * @throws {Error} When the harness serves no such suite, or what it serves is
 *   not one
 */
async function loadSuite(module: string): Promise<AsyncEastIR<[], NullType>> {
  const url = `/${SUITES}/${suiteFile(module)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: the harness answered ${response.status} ${await response.text()}`);
  const { ir, source_map } = decodeSuite(new Uint8Array(await response.arrayBuffer()));
  if (ir.type !== 'AsyncFunction') throw new Error(`${url} holds a ${ir.type}, not the async function a suite is`);
  const program = new AsyncEastIR<[], NullType>(ir);
  // Interning the stacks in their order gives each the id it was exported
  // under: the export is a source map's entries, which are distinct and start
  // with the empty stack at id 0
  const map = new SourceMap();
  for (const stack of source_map.stacks.slice(1)) map.intern_stack(stack);
  if (map.size !== BigInt(source_map.stacks.length)) throw new Error(`${url}: its source map did not rebuild id for id`);
  program.source_map = map;
  return program;
}

/**
 * Why a body failed: a failed assertion's message, an East error's with the
 * East locations it was raised at, or any other error's name and message.
 *
 * @param error - What the body threw
 * @returns The message
 */
function messageOf(error: unknown): string {
  if (error instanceof EastError) return error.formattedMessage;
  if (error instanceof TestFailure) return error.message;
  return error instanceof Error ? `${error.name}: ${error.message}` : `${error as string}`;
}

/** A suite's or test's record, which the host fills in as its body runs. */
type Recording = { -readonly [K in keyof EastTestRecord]: EastTestRecord[K] };

/**
 * A test host that runs each suite and test where the program declares it,
 * and records each one: its name path, whether its body ran to its end, and
 * why it did not. Every test runs, whether or not the ones before it passed.
 *
 * @param records - Where the records go, in the order each suite and test
 *   starts
 * @returns The host
 */
function recordingHost(records: Recording[]): TestHost {
  const suites: string[] = [];
  /** Runs a suite's or a test's body, under a record of its own. */
  async function run(kind: Recording['kind'], name: string, body: () => Promise<void>): Promise<void> {
    const record: Recording = { kind, path: [...suites, name], passed: true, message: null };
    records.push(record);
    if (kind === 'describe') suites.push(name);
    try {
      await body();
    } catch (error) {
      record.passed = false;
      record.message = messageOf(error);
    } finally {
      if (kind === 'describe') suites.pop();
    }
  }
  return {
    describe: (name, body) => run('describe', name, body),
    test: (name, body) => run('test', name, body),
  };
}

/**
 * Runs a test program over east-web-std: its console output to the page's
 * sink, and its suites and tests through a host that records each.
 *
 * @param program - The program
 * @returns What it did
 */
async function runProgram(program: AsyncEastIR<[], NullType>): Promise<SuiteRun> {
  const records: Recording[] = [];
  let stdout = '';
  let stderr = '';
  const platform = createWebPlatform({
    console: {
      stdout: (text) => { stdout += text; },
      stderr: (text) => { stderr += text; },
    },
    test: recordingHost(records),
  });
  let error: string | null = null;
  try {
    await program.compile(platform)();
  } catch (err) {
    error = messageOf(err);
  }
  return { records, stdout, stderr, error };
}

// The platform functions the canary calls, declared as east-node-std's
// `describeEast`, its `Assert` and its Console declare them
const describe = East.asyncPlatform('describe', [StringType, AsyncFunctionType([], NullType)], NullType);
const test = East.asyncPlatform('test', [StringType, AsyncFunctionType([], NullType)], NullType);
const testPass = East.platform('testPass', [], NullType);
const testFail = East.platform('testFail', [StringType], NullType);
const consoleLog = East.platform('console_log', [StringType], NullType);

/**
 * The canary: a program whose suites and tests pass or fail as their names
 * say — a test fails by an assertion and by an East error, and a suite by an
 * East error outside its tests — and which writes a line to standard output.
 *
 * @returns The program
 */
function canary(): AsyncEastIR<[], NullType> {
  return East.asyncFunction([], NullType, ($) => {
    $(consoleLog('the canary sings'));
    $(describe('canary', East.asyncFunction([], NullType, ($) => {
      $(test('passes', East.asyncFunction([], NullType, ($) => {
        $(testPass());
      })));
      $(test('fails an assertion', East.asyncFunction([], NullType, ($) => {
        $(testFail('the canary\'s assertion'));
      })));
      $(test('raises an East error', East.asyncFunction([], NullType, ($) => {
        $.error('the canary\'s error');
      })));
      $(describe('nested', East.asyncFunction([], NullType, ($) => {
        $(test('passes', East.asyncFunction([], NullType, ($) => {
          $(testPass());
        })));
      })));
    })));
    $(describe('a suite that fails outside its tests', East.asyncFunction([], NullType, ($) => {
      $(test('passes', East.asyncFunction([], NullType, ($) => {
        $(testPass());
      })));
      $.error('the suite\'s error');
    })));
  }).toIR();
}

servePage({
  /** The modules whose suites the page runs, and those east-web-std leaves
   *  out. */
  modules(): ComplianceModules {
    return { provided: PROVIDED, notProvided: NOT_PROVIDED };
  },

  /** Runs the suite of a module east-web-std provides, and answers what it
   *  did. */
  async runSuite(module: string): Promise<SuiteRun> {
    if (!PROVIDED.includes(module)) throw new Error(`east-web-std provides no ${module}: the page runs no suite of it`);
    return runProgram(await loadSuite(module));
  },

  /** Runs the canary, and answers what it did. */
  runCanary(): Promise<SuiteRun> {
    return runProgram(canary());
  },
});
