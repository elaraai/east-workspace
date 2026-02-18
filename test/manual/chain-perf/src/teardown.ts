/**
 * Teardown script for chain performance test.
 *
 * Removes the repo (which cascades to workspaces and packages).
 */

import { repoRemove } from '@elaraai/e3-api-client';
import { getToken } from './credentials.js';

const SERVER = 'https://dev.e3.elaraai.com';
const REPO_NAME = 'chain-perf-test';

async function main() {
  const token = await getToken(SERVER);
  const opts = { token };

  console.log(`Removing repo "${REPO_NAME}"...`);
  try {
    await repoRemove(SERVER, REPO_NAME, opts);
    console.log('  Repo removed');
  } catch (err) {
    console.log(`  Repo removal: ${err}`);
  }

  console.log('\nCleaned up');
}

main().catch((err) => {
  console.error('Teardown failed:', err);
  process.exit(1);
});
