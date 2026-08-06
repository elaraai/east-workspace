/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A stand-in npm registry for the `@elaraai` scope — and, under `/pypi/`, a
 * flat wheel index for the `elaraai-*` python packages — run as its OWN
 * PROCESS.
 *
 * Serves synthesized packuments and tarballs for the packages packed into the
 * directory given as `argv[2]`, a find-links-style HTML listing + wheel bytes
 * for the wheel directory given as `argv[3]`, and 302-redirects every other
 * npm name to npmjs so unserved `@elaraai` packages still resolve. Prints its
 * base URL on stdout as the first line, then stays up until killed.
 *
 * ## Why python rides the server too
 *
 * `uv lock` records a `file://` flat index as a registry path RELATIVE to the
 * project (`source = { registry = "../../.." }`). The captured lock is later
 * materialized by e3 in `<repo>/envs/<hash>.building-<pid>` — a different
 * directory depth — where the relative path resolves to nothing and the sync
 * fails. An `http://127.0.0.1` index locks absolutely, so the materialized
 * env resolves it from anywhere (while this process lives, which spans the
 * whole test run).
 *
 * ## Why a separate process
 *
 * The suite drives `npm`/`uv` with `execFileSync`, which blocks the Node event
 * loop for the duration of the child. A registry served from inside the test
 * process therefore cannot answer `npm install`'s requests while that very
 * install is running — npm waits on the registry, the registry waits on npm,
 * and the run deadlocks. Keeping the server in its own process makes it
 * immune to whatever the test process happens to be blocking on.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface PackedPackage {
  file: string;
  bytes: Buffer;
  manifest: { name: string; version: string; [k: string]: unknown };
  integrity: string;
}

const dir = process.argv[2];
if (!dir) {
  process.stderr.write('usage: localRegistry <tarball-dir> [wheel-dir]\n');
  process.exit(2);
}
const wheelDir = process.argv[3];

const packages = new Map<string, PackedPackage>();
for (const file of readdirSync(dir).filter(f => f.endsWith('.tgz'))) {
  const path = join(dir, file);
  const bytes = readFileSync(path);
  const manifest = JSON.parse(
    execFileSync('tar', ['-xzOf', path, 'package/package.json'], {
      encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024,
    }),
  ) as PackedPackage['manifest'];
  packages.set(manifest.name, {
    file, bytes, manifest,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  });
}

const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url ?? '');
  // Flat python index: a find-links-style page of wheel links, then the
  // wheel bytes themselves. Filenames are constrained to the directory
  // listing, so no path can escape the wheel dir.
  if (wheelDir !== undefined && (url === '/pypi' || url === '/pypi/')) {
    const wheels = readdirSync(wheelDir).filter(f => f.endsWith('.whl'));
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!DOCTYPE html><html><body>${wheels.map(f => `<a href="/pypi/${f}">${f}</a>`).join('\n')}</body></html>`);
    return;
  }
  if (wheelDir !== undefined && url.startsWith('/pypi/')) {
    const file = url.slice('/pypi/'.length);
    const known = readdirSync(wheelDir).includes(file);
    if (known && existsSync(join(wheelDir, file))) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(readFileSync(join(wheelDir, file)));
      return;
    }
    res.writeHead(404);
    res.end();
    return;
  }
  const tarball = [...packages.values()].find(p => url.endsWith(`/-/${p.file}`));
  if (tarball) {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end(tarball.bytes);
    return;
  }
  const name = url.replace(/^\//, '').split('/-/')[0] ?? '';
  const pkg = packages.get(name);
  if (pkg) {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      name,
      'dist-tags': { latest: pkg.manifest.version },
      versions: {
        [pkg.manifest.version]: {
          ...pkg.manifest,
          dist: {
            tarball: `http://127.0.0.1:${port}/${name}/-/${pkg.file}`,
            integrity: pkg.integrity,
          },
        },
      },
    }));
    return;
  }
  res.writeHead(302, { location: `https://registry.npmjs.org${url}` });
  res.end();
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  process.stdout.write(`http://127.0.0.1:${port}\n`);
});
