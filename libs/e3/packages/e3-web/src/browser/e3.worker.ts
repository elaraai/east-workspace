/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The e3 worker the specs' e3 page starts: `serveE3`, as an app's e3 worker
 * script calls it, over persisted repositories of the name its URL gives,
 * with the specs' callers known by their tokens and granted by their roles.
 * Its unit workers run `e3-unit.worker.ts`, holding when its URL says.
 *
 * Small upload parts, no commit wait and small export rounds, as the local
 * server's compliance run has, so the suites' uploads go through the
 * protocol's multi-part path and a polled commit, and an export resumes from
 * its checkpoint round after round. A piece size its URL gives is the one
 * split tasks are planned with, as `E3_TEST_PIECE_BYTES` sets the local
 * runner's.
 *
 * The harness bundles it for Chromium; `e3.page.ts` starts it.
 *
 * @packageDocumentation
 */

import { readTestPieceBytesFrom } from '@elaraai/e3-core/portable';
import { identifyCaller } from '../testing/callers.js';
import { oneShotAccessByRoles, serveE3 } from '../worker.js';

const params = new URL(self.location.href).searchParams;
const pieceBytes = params.get('pieceBytes') ?? undefined;
readTestPieceBytesFrom(() => pieceBytes);
const hold = params.get('hold') === '1' ? '1' : '0';

serveE3({
  units: () => new Worker(`/e3-unit-worker.js?hold=${hold}`, { type: 'module' }),
  name: params.get('name') ?? 'e3',
  identify: identifyCaller,
  access: oneShotAccessByRoles(),
  transferPartBytes: 256 * 1024,
  transferCommitWaitMs: 0,
  transferExportRoundBytes: 64 * 1024,
});
