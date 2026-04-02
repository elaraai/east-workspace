/**
 * Defines a test package whose task output depends on execution time.
 *
 * The `timestamp` task has zero inputs — `Time.now()` is a coeffect that returns
 * the current time in milliseconds since epoch. Each scheduled run produces a
 * visibly different result.
 */

import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { IntegerType, East } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { Time } from '@elaraai/east-node-std';

export const PACKAGE_NAME = 'schedule-test';
export const PACKAGE_VERSION = '1.0.0';

export async function createPackage(): Promise<string> {
  const task = e3.task(
    'timestamp',
    [],
    East.function([], IntegerType, () => Time.now()),
  );

  const pkg = e3.package(PACKAGE_NAME, PACKAGE_VERSION, task);
  const dir = await mkdtemp(join(tmpdir(), 'e3-schedule-test-'));
  const zipPath = join(dir, `${PACKAGE_NAME}-${PACKAGE_VERSION}.zip`);
  await e3.export(pkg, zipPath);
  return zipPath;
}
