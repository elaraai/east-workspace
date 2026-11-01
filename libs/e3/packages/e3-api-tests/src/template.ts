/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A workspace a suite deploys and fills once, and a copy of it for each test
 * (#1466).
 *
 * A record's suite deployed its package and seeded its record for every test:
 * some 1.3 seconds of each, its check a few milliseconds. A copy of a
 * workspace names the template's state by its hashes, so making one costs a
 * few writes, and what a test reads and writes is its copy's alone, as a fresh
 * repository's was.
 */

import { after, type TestContext as NodeTestContext } from 'node:test';

import { workspaceCopy } from '@elaraai/e3-api-client';

import type { TestContext } from './context.js';
import type { TestSetup } from './setup.js';

/** A test's copy of its suite's template. */
export interface TemplateCopy {
  /** The context the template was made in: its repository holds the copy. */
  readonly ctx: TestContext;
  /** The copy's workspace, the test's own. */
  readonly workspace: string;
}

/** The template's workspace, which no test reads or writes. */
const TEMPLATE = 'template';

/**
 * A suite's template, made the first time a test asks for a copy, and a copy
 * of it for each test. Called inside the suite's `describe`, so the template's
 * repository goes once the suite has run.
 *
 * @param setup - The harness's setup, the template's repository made with it
 * @param prepare - Deploys and fills the template's workspace, by its name
 * @returns What gives a test its copy
 */
export function templateWorkspace(
  setup: TestSetup<TestContext>,
  prepare: (ctx: TestContext, workspace: string) => Promise<void>,
): (t: NodeTestContext) => Promise<TemplateCopy> {
  // A harness registers a context's cleanup on the test it is made for: the
  // template's is held for the suite's end instead.
  const cleanups: (() => unknown)[] = [];
  const standIn = { after: (cleanup: () => unknown) => { cleanups.push(cleanup); } } as unknown as NodeTestContext;
  let template: Promise<TestContext> | undefined;
  let copies = 0;
  void after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
  });
  return async () => {
    template ??= (async () => {
      const ctx = await setup(standIn);
      await prepare(ctx, TEMPLATE);
      return ctx;
    })();
    const ctx = await template;
    const workspace = `copy-${++copies}`;
    await workspaceCopy(ctx.config.baseUrl, ctx.repoName, TEMPLATE, workspace, await ctx.opts());
    return { ctx, workspace };
  };
}
