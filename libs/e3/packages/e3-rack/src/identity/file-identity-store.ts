/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { join } from 'node:path';
import { decodeBeast2For, encodeBeast2For } from '@elaraai/east';
import { ensureRackHome, IDENTITY_FILE } from '../paths.js';
import { readStateFile, writeStateFile } from '../state-file.js';
import { IdentityFileType, InMemoryMachineIdentityStore, type IdentityFile } from './in-memory-identity-store.js';

/**
 * Persists machine credentials atomically, with one writer under the hub lock.
 * Failed writes leave memory unchanged; corrupt files fail closed.
 * @example
 * const identities = new FileMachineIdentityStore(rackHome());
 */
export class FileMachineIdentityStore extends InMemoryMachineIdentityStore {
  private readonly file: string;

  /** @param home - The private rack home owned by this hub */
  constructor(home: string) {
    super();
    this.file = join(ensureRackHome(home), IDENTITY_FILE);
    this.ready = readStateFile(this.file).then((bytes) => {
      if (bytes !== null) this.state = decodeBeast2For(IdentityFileType)(bytes);
    });
    // Loading starts at construction; the first operation still receives
    // its failure, even if the caller has not made one yet.
    void this.ready.catch(() => undefined);
  }

  protected override persist(state: IdentityFile): Promise<void> {
    return writeStateFile(this.file, encodeBeast2For(IdentityFileType)(state));
  }
}
