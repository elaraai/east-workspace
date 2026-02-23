/**
 * Setup script for chain performance test.
 *
 * Creates repo, imports chain packages (3, 5, 10 tasks), creates workspaces, deploys.
 */

import { readFileSync } from 'node:fs';
import {
  repoCreate,
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  ApiError,
} from '@elaraai/e3-api-client';
import { getToken } from './credentials.js';
import { createChainPackage, chainPackageName, PACKAGE_VERSION } from './package-def.js';

const SERVER = 'https://dev.e3.elaraai.com';
const REPO_NAME = 'chain-perf-test';
const CHAIN_LENGTHS = [3, 5, 10];

async function main() {
  const token = await getToken(SERVER);
  const opts = { token };

  // 1. Create repo
  console.log(`Creating repo "${REPO_NAME}"...`);
  try {
    await repoCreate(SERVER, REPO_NAME, opts);
    console.log('  Repo created');
  } catch (err) {
    if (err instanceof ApiError && err.code === 'already_exists') {
      console.log('  Repo already exists');
    } else {
      throw err;
    }
  }

  for (const length of CHAIN_LENGTHS) {
    const pkgName = chainPackageName(length);
    const workspace = `chain-${length}`;
    const packageRef = `${pkgName}@${PACKAGE_VERSION}`;

    // 2. Build and import package
    console.log(`\nBuilding chain-${length} package (${length} tasks)...`);
    const zipPath = await createChainPackage(length);
    const archive = readFileSync(zipPath);
    console.log(`Importing ${pkgName}...`);
    await packageImport(SERVER, REPO_NAME, archive, opts);
    console.log('  Package imported');

    // 3. Create workspace
    console.log(`Creating workspace "${workspace}"...`);
    try {
      await workspaceCreate(SERVER, REPO_NAME, workspace, opts);
      console.log('  Workspace created');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'already_exists') {
        console.log('  Workspace already exists');
      } else {
        throw err;
      }
    }

    // 4. Deploy package
    console.log(`Deploying ${packageRef}...`);
    await workspaceDeploy(SERVER, REPO_NAME, workspace, packageRef, opts);
    console.log('  Deployed');
  }

  console.log('\n=== Setup Complete ===');
  console.log(`  Server:     ${SERVER}`);
  console.log(`  Repo:       ${REPO_NAME}`);
  for (const length of CHAIN_LENGTHS) {
    console.log(`  Workspace:  chain-${length} (${length} tasks)`);
  }
  console.log('\nRun benchmark with: npm run perf -w e3-manual-chain-perf -- --chain 5 --compute serverless');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
