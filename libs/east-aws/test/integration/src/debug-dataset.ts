/**
 * Debug script to test dataset operations
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  repoCreate,
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  datasetSet,
  datasetGet,
  datasetList,
} from '@elaraai/e3-api-client';
import { StringType, encodeBeast2For, decodeBeast2For, decodeBeast2, variant, East } from '@elaraai/east';
import e3 from '@elaraai/e3';

async function createStringPackageZip(tempDir: string, name: string, version: string): Promise<string> {
  mkdirSync(tempDir, { recursive: true });
  const input = e3.input('config', StringType, 'default');
  const task = e3.task('echo', [input], East.function([StringType], StringType, ($, x) => x));
  const pkg = e3.package(name, version, task);
  const zipPath = join(tempDir, `${name}-${version}.zip`);
  await e3.export(pkg, zipPath);
  return zipPath;
}

const API_URL = 'https://dev.e3.elaraai.com';

// Read credentials
const credsFile = readFileSync(join(process.env.HOME!, '.e3', 'credentials.json'), 'utf8');
const creds = JSON.parse(credsFile);
const token = creds.credentials[API_URL]?.accessToken;

if (!token) {
  console.error('No token found for', API_URL);
  process.exit(1);
}

const opts = { token };

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), 'dataset-debug-'));
  const repoName = `debug-dataset-${Date.now()}`;

  try {
    console.log('=== Creating repo:', repoName);
    await repoCreate(API_URL, repoName, opts);
    console.log('Repo created');

    console.log('\n=== Creating package');
    const zipPath = await createStringPackageZip(tempDir, 'debug-pkg', '1.0.0');
    const packageZip = readFileSync(zipPath);
    await packageImport(API_URL, repoName, packageZip, opts);
    console.log('Package imported');

    console.log('\n=== Creating workspace');
    await workspaceCreate(API_URL, repoName, 'debug-ws', opts);
    console.log('Workspace created');

    console.log('\n=== Deploying package');
    await workspaceDeploy(API_URL, repoName, 'debug-ws', 'debug-pkg@1.0.0', opts);
    console.log('Package deployed');

    console.log('\n=== Listing datasets');
    const fields = await datasetList(API_URL, repoName, 'debug-ws', opts);
    console.log('Root fields:', fields);

    console.log('\n=== Setting dataset at .inputs.config');
    const encode = encodeBeast2For(StringType);
    const data = encode('hello world');
    const path = [variant('field', 'inputs'), variant('field', 'config')];

    try {
      await datasetSet(API_URL, repoName, 'debug-ws', path, data, opts);
      console.log('Dataset set');
    } catch (err: any) {
      console.error('datasetSet error:', err.message);
      console.error('Error details:', err);
    }

    console.log('\n=== Getting dataset at .inputs.config');
    try {
      const result = await datasetGet(API_URL, repoName, 'debug-ws', path, opts) as any;
      const retrieved: Uint8Array = result instanceof Uint8Array ? result : result.data;
      console.log('Retrieved bytes length:', retrieved.length);
      console.log('First 100 bytes hex:', Buffer.from(retrieved).toString('hex').slice(0, 200));

      // Decode as generic BEAST2 to see the actual value
      const { type, value } = decodeBeast2(retrieved);
      console.log('Decoded type:', JSON.stringify(type, null, 2));
      console.log('Decoded value:', JSON.stringify(value, (key, val) =>
        typeof val === 'bigint' ? val.toString() : val, 2));
    } catch (err: any) {
      console.error('datasetGet error:', err.message);
      console.error('Error details:', err);
    }

  } catch (err: any) {
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
