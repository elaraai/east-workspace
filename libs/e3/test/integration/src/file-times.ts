/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A test reporter writing each spec's time, the sum of its top-level tests',
 * in ms, as JSON under the system it ran on (`process.platform`) by the spec's
 * path from the package it runs in (#1466): the reports CI's integration and
 * e3-core shards upload and `dist/spec-timings.js` reads. libs/e3's Makefile adds it beside the spec reporter when given
 * `REPORT=file`.
 */

import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import type { TestEvent } from 'node:test/reporters';

/**
 * A spec's path as the Makefile names it, the compiled file. A run with source
 * maps reports a test's source, `src/x.spec.ts`, which compiles to
 * `dist/x.spec.js` here and to `dist/src/x.spec.js` in e3-core: whichever is
 * there.
 */
function compiled(file: string): string {
  const spec = relative(process.cwd(), file).replaceAll('\\', '/');
  if (!spec.endsWith('.ts')) return spec;
  const js = spec.replace(/\.ts$/, '.js');
  return [js.replace(/^src\//, 'dist/'), `dist/${js}`].find((candidate) => existsSync(candidate)) ?? spec;
}

export default async function* fileTimes(source: AsyncIterable<TestEvent>): AsyncGenerator<string> {
  const times = new Map<string, number>();
  for await (const event of source) {
    if ((event.type === 'test:pass' || event.type === 'test:fail') && event.data.nesting === 0 && event.data.file !== undefined) {
      const spec = compiled(event.data.file);
      times.set(spec, (times.get(spec) ?? 0) + event.data.details.duration_ms);
    }
  }
  yield `${JSON.stringify({ [process.platform]: Object.fromEntries([...times].map(([spec, ms]) => [spec, Math.round(ms)])) }, null, 1)}\n`;
}
