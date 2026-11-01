/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A test reporter writing each spec's time, the sum of its top-level tests',
 * in ms, as JSON by the spec's path from this package (#1466): the reports CI's
 * integration shards upload and `dist/integration-timings.js` reads. libs/e3's
 * Makefile adds it beside the spec reporter when given `REPORT=file`.
 */

import { relative } from 'node:path';
import type { TestEvent } from 'node:test/reporters';

/** A spec's path as the Makefile names it, the compiled file: a run with source maps reports a test's source. */
function compiled(file: string): string {
  return relative(process.cwd(), file).replaceAll('\\', '/').replace(/^src\/(.*)\.ts$/, 'dist/$1.js');
}

export default async function* fileTimes(source: AsyncIterable<TestEvent>): AsyncGenerator<string> {
  const times = new Map<string, number>();
  for await (const event of source) {
    if ((event.type === 'test:pass' || event.type === 'test:fail') && event.data.nesting === 0 && event.data.file !== undefined) {
      const spec = compiled(event.data.file);
      times.set(spec, (times.get(spec) ?? 0) + event.data.details.duration_ms);
    }
  }
  yield `${JSON.stringify(Object.fromEntries([...times].map(([spec, ms]) => [spec, Math.round(ms)])), null, 1)}\n`;
}
