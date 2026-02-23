/**
 * Creates linear chain packages of configurable length.
 *
 * Each chain is: task-0 → task-1 → task-2 → ... → task-(N-1)
 * where task-0 returns 1n and each subsequent task adds 1.
 * Execution time is negligible — the test measures orchestration overhead.
 */

import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { IntegerType, East } from '@elaraai/east';
import e3 from '@elaraai/e3';

export function chainPackageName(length: number): string {
  return `chain-${length}`;
}

export const PACKAGE_VERSION = '1.0.0';

export async function createChainPackage(length: number): Promise<string> {
  if (length < 1) throw new Error('Chain length must be at least 1');

  // task-0: no inputs, returns 1n
  const task0 = e3.task(
    'task-0',
    [],
    East.function([], IntegerType, () => 1n),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lastTask: any = task0;

  // task-1 through task-(N-1): each takes previous output and adds 1
  for (let i = 1; i < length; i++) {
    lastTask = e3.task(
      `task-${i}`,
      [lastTask.output],
      East.function([IntegerType], IntegerType, (_$, x) => x.add(1n)),
    );
  }

  const name = chainPackageName(length);
  const dir = await mkdtemp(join(tmpdir(), `e3-chain-perf-${length}-`));
  const zipPath = join(dir, `${name}-${PACKAGE_VERSION}.zip`);
  // Use e3.package and e3.export with relaxed types due to dynamic task chain
  const pkg = (e3 as any).package(name, PACKAGE_VERSION, lastTask);
  await (e3 as any).export(pkg, zipPath);
  return zipPath;
}
