/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

it('loads the ordinary API server without rack and explains the missing optional ESM peer', async () => {
  // NODE_PATH does not control ESM resolution. Materialize a genuine isolated
  // install with every server dependency except its optional rack peer.
  const installed = resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/e3-api-server');
  const home = await mkdtemp(join(tmpdir(), 'e3-peer-'));
  try {
    const server = join(home, 'server'); await mkdir(server);
    await cp(join(installed, 'dist'), join(server, 'dist'), { recursive: true });
    await cp(join(installed, 'package.json'), join(server, 'package.json'));
    const manifest = JSON.parse(await readFile(join(server, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; peerDependencies: Record<string, string> };
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }).filter((name) => name !== '@elaraai/e3-rack')) {
      const destination = join(server, 'node_modules', name); await mkdir(dirname(destination), { recursive: true });
      await symlink(await realpath(join(installed, 'node_modules', name)), destination, process.platform === 'win32' ? 'junction' : 'dir');
    }
    const run = (...args: string[]) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [join(server, 'dist/src/cli.js'), ...args], { env: { ...process.env, NODE_PATH: home }, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; child.stdout.on('data', (chunk) => { output += chunk.toString(); }); child.stderr.on('data', (chunk) => { output += chunk.toString(); });
      child.on('error', reject); child.on('close', (code) => resolve({ code, output }));
    });
    assert.equal((await run('--help')).code, 0);
    const missing = await run('--repo', home, '--rack');
    assert.notEqual(missing.code, 0);
    assert.match(missing.output, /--rack needs @elaraai\/e3-rack installed next to e3-api-server/);
  } finally { await rm(home, { recursive: true, force: true }); }
});
