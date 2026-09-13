import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EastLspClient } from '../lib/lsp-client.js';

test('LSP startup errors reject promptly and can be closed', async () => {
  const client = new EastLspClient('/definitely-missing-east-lsp.js', process.cwd());
  try { await assert.rejects(client.ready, /exited/); }
  finally { client.close(); }
});
