#!/usr/bin/env tsx

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Wait for Docker services to be healthy before running tests.
 *
 * This script checks the health status of all required Docker containers
 * and waits until they are all healthy before proceeding.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const SERVICES = [
    'postgres',
    'mysql',
    'mongodb',
    'redis',
    'minio',
    'ftp',
    'sftp'
] as const;

const MAX_RETRIES = 60; // 60 seconds max wait time
const RETRY_DELAY = 1000; // 1 second between checks

/**
 * Check if a Docker container is healthy.
 *
 * @param service - The service name to check
 * @returns True if healthy, false otherwise
 */
async function isServiceHealthy(service: string): Promise<boolean> {
    try {
        const { stdout } = await execAsync(
            `docker ps --filter "name=east-node-io-.*${service}" --format "{{.Status}}"`,
            { encoding: 'utf8' }
        );

        const status = stdout.trim();

        // Check if status contains "healthy" or "Up" for services without health checks
        if (status.includes('(healthy)')) {
            return true;
        }

        // FTP and SFTP don't have health checks in the compose file, so just check if running
        if ((service === 'ftp' || service === 'sftp') && status.startsWith('Up')) {
            return true;
        }

        return false;
    } catch (error) {
        return false;
    }
}

/**
 * Wait for all services to be healthy.
 */
async function waitForServices(): Promise<void> {
    console.log('Waiting for Docker services to be healthy...');

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const healthChecks = await Promise.all(
            SERVICES.map(async (service) => {
                const healthy = await isServiceHealthy(service);
                return { service, healthy };
            })
        );

        const allHealthy = healthChecks.every(check => check.healthy);
        const unhealthyServices = healthChecks
            .filter(check => !check.healthy)
            .map(check => check.service);

        if (allHealthy) {
            console.log('✓ All services are healthy and ready!');
            return;
        }

        if (attempt % 10 === 0 || attempt === 1) {
            console.log(
                `Attempt ${attempt}/${MAX_RETRIES}: Waiting for services: ${unhealthyServices.join(', ')}`
            );
        }

        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }

    console.error('✗ Timeout: Some services did not become healthy in time');
    process.exit(1);
}

// Run the script
waitForServices().catch((error: unknown) => {
    console.error('Error waiting for services:', error);
    process.exit(1);
});
