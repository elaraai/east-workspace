/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { Command } from 'commander';
import { createRequire } from 'module';
import { EastError } from '@elaraai/east/internal';
import { loadPlatforms, loadPlatformWithMetadata } from './loader.js';
import { runProgram } from './runner.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string; name: string };

interface RunOptions {
    package?: string[];
    input?: string[];
    output?: string;
    verbose?: boolean;
}

interface VersionOptions {
    package?: string[];
}

async function cmdRun(irFile: string, options: RunOptions): Promise<void> {
    const packages = options.package ?? [];

    if (packages.length === 0) {
        console.error('Error: At least one platform package is required.');
        console.error('Example: east-node run program.beast2 -p @elaraai/east-node-std');
        process.exit(1);
    }

    try {
        if (options.verbose) {
            console.error(`Loading ${packages.length} platform package(s)...`);
        }

        const platformFns = await loadPlatforms(packages);

        if (options.verbose) {
            console.error(`Loaded ${platformFns.length} platform function(s)`);
            console.error(`Running: ${irFile}`);
        }

        const result = await runProgram(
            irFile,
            platformFns,
            options.input ?? [],
            options.output,
            options.verbose ?? false
        );

        // If no output file specified, print result to stdout
        if (!options.output && result !== undefined && result !== null) {
            console.log(JSON.stringify(result, null, 2));
        }
    } catch (err) {
        if (err instanceof EastError) {
            console.error(`Error: ${err.toString()}`);
        } else {
            console.error(`Error: ${(err as Error).message}`);
        }
        process.exit(1);
    }
}

async function cmdVersion(options: VersionOptions): Promise<void> {
    console.log(`${pkg.name} ${pkg.version}`);

    // Try to get east version
    try {
        const eastPkg = require('@elaraai/east/package.json') as { version: string };
        console.log(`@elaraai/east ${eastPkg.version}`);
    } catch {
        // east package not found or no package.json export
    }

    const packages = options.package ?? [];
    if (packages.length > 0) {
        console.log('');
        console.log('Platforms:');

        for (const pkgName of packages) {
            try {
                const meta = await loadPlatformWithMetadata(pkgName);
                console.log(`  ${meta.name} ${meta.version} (${meta.fns.length} platform functions)`);
            } catch (err) {
                console.log(`  ${pkgName}: ${(err as Error).message}`);
            }
        }
    }
}

export function main(): void {
    const program = new Command();

    program
        .name('east-node')
        .description('Run East IR programs with Node.js platform functions')
        .version(pkg.version);

    program
        .command('run')
        .description('Run an East IR program')
        .argument('<ir_file>', 'Path to IR file (.beast2, .beast, .east, or .json)')
        .option('-p, --package <package...>', 'Platform packages to load (can be repeated)')
        .option('-i, --input <file...>', 'Input data files (order matches function parameters)')
        .option('-o, --output <file>', 'Output file path for result')
        .option('-v, --verbose', 'Enable verbose output')
        .action(cmdRun);

    program
        .command('version')
        .description('Show version information')
        .option('-p, --package <package...>', 'Platform packages to check')
        .action(cmdVersion);

    program.parse();
}
