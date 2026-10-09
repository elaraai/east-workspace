/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { encodeBeast2For, some, variant, type EastType, type ValueTypeOf } from '@elaraai/east';
import * as wire from './rack-wire.js';
import * as registration from './registration.js';

const at = new Date(1_700_000_000_000);
const host = { label: 'rack', tiers: ['node', 'py'], capacity: 2n, agentVersion: '0.5.0+e3.1.0.85' };
const ref = { repo: 'repo', leaseId: 'lease' };
const size = { hash: 'a'.repeat(64), size: 4n };
const layer = { digest: 'sha256:abc', url: 'https://rack.invalid/layer', sizeBytes: 5n };
const target = variant('put', { url: 'https://rack.invalid/put', headers: new Map([['x-checksum', 'abc']]) });

/** A fully populated protocol value, with its encoder and name. @internal */
function sample<T extends EastType>(name: string, type: T, value: ValueTypeOf<T>): { name: string; value: unknown; encode: () => Uint8Array } {
  return { name, value, encode: () => encodeBeast2For(type)(value) };
}

/** Fixed samples used by this package and cloud adoption checks. @internal */
export const wireSamples = [
  sample('RackHostInfoType', wire.RackHostInfoType, host),
  sample('RackEnrollRequestType', wire.RackEnrollRequestType, { enrollmentToken: 'enroll', hostInfo: host }),
  sample('RackEnrollResponseType', wire.RackEnrollResponseType, { rackId: 'rack', rackToken: 'token' }),
  sample('RackLeaseRefType', wire.RackLeaseRefType, ref),
  sample('RackLeaseRequestType', wire.RackLeaseRequestType, { tiers: ['node'], bootId: 'boot' }),
  sample('RackLeaseGrantType', wire.RackLeaseGrantType, { ...ref, workspace: 'dev', tier: 'node', computeSize: 'large', eventJson: '{}', visibilityDeadline: at }),
  sample('RackHeartbeatRequestType', wire.RackHeartbeatRequestType, { healthy: true, freeCapacity: 1n, runningLeases: [ref], agentVersion: host.agentVersion, bootId: 'boot', cacheBytes: 123n }),
  sample('RackHeartbeatResponseType', wire.RackHeartbeatResponseType, { stop: [ref], rotatedToken: some('token'), pendingApproval: true }),
  sample('RackExtendRequestType', wire.RackExtendRequestType, ref),
  sample('RackCompleteRequestType', wire.RackCompleteRequestType, { ...ref, resultJson: '{}', outputUploadId: some('upload'), inlineOutput: some(new Uint8Array([1, 2])) }),
  sample('RackObjectSizeType', wire.RackObjectSizeType, size),
  sample('RackObjectCommitType', wire.RackObjectCommitType, { ...size, version: 'receipt' }),
  sample('RackStorageRequestType', wire.RackStorageRequestType, { ...ref, need: [size.hash], output: some(size), envManifest: some('env'), outputs: [size], commits: [{ ...size, version: 'receipt' }] }),
  sample('RackObjectDescriptorType', wire.RackObjectDescriptorType, variant('inline', { hash: size.hash, data: new Uint8Array([1, 2]) })),
  sample('RackEnvLayerType', wire.RackEnvLayerType, layer),
  sample('RackWriteTargetType', wire.RackWriteTargetType, target),
  sample('RackStorageResponseType', wire.RackStorageResponseType, {
    objects: [variant('url', { hash: size.hash, url: 'https://rack.invalid/get' })],
    output: some({ url: 'https://rack.invalid/put', uploadId: 'upload' }),
    env: some({ manifestJson: '{}', layers: [layer] }),
    targets: [{ hash: size.hash, target }, { hash: 'b'.repeat(64), target: variant('held', null) }],
    committed: [{ hash: size.hash, committed: true }],
  }),
  sample('RackLogChunkType', wire.RackLogChunkType, { stream: variant('stdout', null), data: 'hello\n' }),
  sample('RackLogsRequestType', wire.RackLogsRequestType, { ...ref, chunks: [{ stream: variant('stderr', null), data: 'error\n' }] }),
  sample('RackCompleteResponseType', wire.RackCompleteResponseType, { disposition: variant('recorded', null) }),
  sample('RackSecurityPolicyType', registration.RackSecurityPolicyType, { requireStartApproval: true }),
  sample('RackRegistrationType', registration.RackRegistrationType, { rackId: 'rack', ...host, enrolledAt: at, lastSeenAt: at, healthy: true, lastBootId: some('boot'), approvedBootId: some('boot') }),
  sample('RackActivityEntryType', registration.RackActivityEntryType, { repo: 'repo', workspace: 'dev', taskName: 'test', tier: 'node', status: 'completed', outcome: some('success'), error: some('message'), claimedAt: at, completedAt: some(at) }),
];
