/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { East, IntegerType } from '@elaraai/east';
import { createTempDir, removeTempDir } from '@elaraai/e3-core/test';
import { readFunctionManifests } from './function-manifests.js';

describe('--functions', () => {
  let dir: string;
  beforeEach(() => { dir = createTempDir(); });
  afterEach(() => { removeTempDir(dir); });

  it('reads each manifest file it names, decoded, in order', () => {
    const double = East.function([IntegerType], IntegerType, (_$, x) => x.multiply(2n));
    const pricing = East.exportFunctions('pricing', '1.0.0', { double });
    const shipping = East.exportFunctions('shipping', '2.0.0', { double });
    const files = [join(dir, 'pricing.functions.beast2'), join(dir, 'shipping.functions.beast2')];
    writeFileSync(files[0]!, East.encodeFunctionManifest(pricing));
    writeFileSync(files[1]!, East.encodeFunctionManifest(shipping));
    const read = readFunctionManifests(files);
    assert.deepEqual(read.map((m) => Buffer.from(East.encodeFunctionManifest(m))), [pricing, shipping].map((m) => Buffer.from(East.encodeFunctionManifest(m))));
  });
});
