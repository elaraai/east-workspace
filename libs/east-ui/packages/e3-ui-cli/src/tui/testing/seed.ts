/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A real fixture repository, built at test time with `@elaraai/e3-core` from
 * the `@elaraai/e3-api-tests` package zips: three workspaces — `main`
 * (the diamond dataflow, run once so outputs exist), `inputs` (two editable
 * integer inputs) and `table` (a large Dict input for paging) — so the
 * integration smoke (#730) and a manual `e3-ui <dir>` have something to
 * show. Test-only: excluded from the published tarball.
 *
 * @packageDocumentation
 */

import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    FileStateStore,
    LocalOrchestrator,
    LocalStorage,
    packageImport,
    repoInit,
    workspaceCreate,
    workspaceDeploy,
    workspaceSetDataset,
} from '@elaraai/e3-core';
import { createDiamondPackageZip, createMultiInputPackageZip, createTablePackageZip } from '@elaraai/e3-api-tests';
import { ArrayType, DictType, IntegerType, StringType, StructType, variant } from '@elaraai/east';

/** What {@link seedFixtureRepo} built. */
export interface SeededRepo {
    /** The repository directory. */
    path: string;
    /** The scratch directory holding it (remove when done). */
    scratch: string;
    /** Whether the `main` dataflow ran to completion (a runner was available). */
    ran: boolean;
    /** The entry count of the `table` workspace's `lookup` input. */
    lookupEntries: number;
}

/** Options for {@link seedFixtureRepo}. */
export interface SeedOptions {
    /** Entries in the paged Dict input (default 20,000). */
    lookupEntries?: number;
    /** Whether to run the `main` dataflow (default true). */
    run?: boolean;
}

/**
 * Builds the fixture repository.
 *
 * @param options - Sizes and whether to run the dataflow
 * @returns The seeded repository
 */
export async function seedFixtureRepo(options: SeedOptions = {}): Promise<SeededRepo> {
    const scratch = mkdtempSync(join(tmpdir(), 'e3-ui-fixture-'));
    const path = join(scratch, 'demo-repo');
    mkdirSync(path);
    repoInit(path);
    const storage = new LocalStorage();
    const zips = join(scratch, 'zips');

    const diamond = await createDiamondPackageZip(zips, 'demand', '1.4.2');
    const multi = await createMultiInputPackageZip(zips, 'params', '0.1.0');
    const table = await createTablePackageZip(zips, 'tables', '2.0.0');
    for (const zip of [diamond, multi, table]) await packageImport(storage, path, zip);

    await workspaceCreate(storage, path, 'main');
    await workspaceDeploy(storage, path, 'main', 'demand', '1.4.2');
    await workspaceCreate(storage, path, 'inputs');
    await workspaceDeploy(storage, path, 'inputs', 'params', '0.1.0');
    await workspaceCreate(storage, path, 'table');
    await workspaceDeploy(storage, path, 'table', 'tables', '2.0.0');

    const lookupEntries = options.lookupEntries ?? 20_000;
    const lookup = new Map<string, bigint>();
    for (let i = 0; i < lookupEntries; i++) lookup.set(`k${String(i).padStart(6, '0')}`, BigInt(i * 7));
    const rows = Array.from({ length: 1200 }, (_, i) => ({ id: BigInt(i), name: `row ${i}` }));
    const RowType = StructType({ id: IntegerType, name: StringType });
    await workspaceSetDataset(storage, path, 'table', [variant('field', 'inputs'), variant('field', 'lookup')], lookup, DictType(StringType, IntegerType));
    await workspaceSetDataset(storage, path, 'table', [variant('field', 'inputs'), variant('field', 'rows')], rows, ArrayType(RowType));
    await workspaceSetDataset(storage, path, 'inputs', [variant('field', 'inputs'), variant('field', 'a')], 40n, IntegerType);
    await workspaceSetDataset(storage, path, 'inputs', [variant('field', 'inputs'), variant('field', 'b')], 2n, IntegerType);

    let ran = false;
    if (options.run !== false) {
        try {
            const stateStore = new FileStateStore(join(path, 'workspaces'));
            const orchestrator = new LocalOrchestrator(stateStore);
            const handle = await orchestrator.start(storage, path, 'main', { concurrency: 2 });
            const result = await orchestrator.wait(handle);
            ran = result.success;
        } catch {
            ran = false;
        }
    }
    return { path, scratch, ran, lookupEntries };
}
