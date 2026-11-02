/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Every e3 example the search index serves builds its package and exports it:
 * an example that no longer builds fails here.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import e3 from '@elaraai/e3';
import type { E3Example } from './example.js';
import * as tasks from './tasks.examples.js';
import * as streams from './streams.examples.js';
import * as records from './records.examples.js';

const files: Record<string, Record<string, E3Example>> = { tasks, streams, records };

describe('e3 examples', () => {
  for (const [file, examples] of Object.entries(files)) {
    for (const [name, ex] of Object.entries(examples)) {
      it(`${file}.${name} builds and exports its package`, async () => {
        const dir = mkdtempSync(join(tmpdir(), 'e3-example-'));
        try {
          const zip = join(dir, `${name}.zip`);
          await e3.export(ex.fn(), zip);
          assert.ok(statSync(zip).size > 0);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
    }
  }
});
