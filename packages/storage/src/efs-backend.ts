/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import * as path from 'node:path';

/**
 * EFS-backed StorageBackend implementation.
 *
 * This wraps the LocalBackend from e3-core, pointing it at the tenant's
 * EFS directory instead of a local filesystem path.
 *
 * Directory structure on EFS:
 *   /mnt/efs/tenants/{tenant-id}/.e3/
 *     ├── objects/
 *     ├── packages/
 *     ├── workspaces/
 *     └── executions/
 */
export class EfsBackend {
  private readonly basePath: string;

  constructor(
    tenantId: string,
    efsMountPath: string = '/mnt/efs'
  ) {
    this.basePath = path.join(efsMountPath, 'tenants', tenantId);
  }

  /**
   * Get the path to the .e3 directory for this tenant.
   */
  get repoPath(): string {
    return path.join(this.basePath, '.e3');
  }

  /**
   * Get the base path for this tenant's data.
   */
  get tenantPath(): string {
    return this.basePath;
  }

  // TODO: Implement StorageBackend interface
  // Once e3-core exports the StorageBackend interface and LocalBackend,
  // this class will delegate to LocalBackend with the EFS path.
  //
  // get objects(): ObjectStore {
  //   return new LocalObjectStore(this.repoPath);
  // }
  //
  // get refs(): RefStore {
  //   return new LocalRefStore(this.repoPath);
  // }
  //
  // get locks(): LockService {
  //   return new LocalLockService(this.repoPath);
  // }
  //
  // get logs(): LogStore {
  //   return new LocalLogStore(this.repoPath);
  // }
}
