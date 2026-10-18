/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { BlockList, isIP } from 'node:net';
import { join } from 'node:path';
import { StringType, StructType, decodeBeast2For, encodeBeast2For, none } from '@elaraai/east';
import { ensureRackHome, HUB_CONFIG_FILE, HUB_TLS_FILE, rackHome } from '../paths.js';
import { readStateFile, writeStateFile } from '../state-file.js';
import { createHubCertificate, type HubCertificate } from '../tls/tls.js';

import { HubConfigType, type HubConfig } from '../protocol/control.js';
export { HubConfigType, type HubConfig } from '../protocol/control.js';

/** Creates independent defaults with external access disabled; a listener, once configured, serves TLS. */
export function defaultHubConfig(): HubConfig {
  return { listen: none, allow: [], idleExitMinutes: 15n, advertiseUrl: none, tls: true };
}

// The addresses plain HTTP may be served on: this machine's loopback and the
// private ranges (RFC 1918, shared address space for carrier-grade NAT and
// VPN overlays, link-local, IPv6 unique-local and link-local).
const PRIVATE = new BlockList();
for (const [address, prefix] of [['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10], ['169.254.0.0', 16]] as const) PRIVATE.addSubnet(address, prefix, 'ipv4');
PRIVATE.addAddress('::1', 'ipv6');
PRIVATE.addSubnet('fc00::', 7, 'ipv6');
PRIVATE.addSubnet('fe80::', 10, 'ipv6');

const unmapped = (address: string) => address.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');

/**
 * Whether a listen host binds every address of this machine.
 * @param host - The configured listen host
 * @returns True for `0.0.0.0` and `::`
 * @example
 * wildcardHost('0.0.0.0'); // true
 */
export function wildcardHost(host: string): boolean {
  const address = unmapped(host);
  return isIP(address) !== 0 && (address === '0.0.0.0' || /^[0:]+$/.test(address));
}

function privateHost(host: string): boolean {
  if (host === 'localhost') return true;
  const address = unmapped(host);
  const family = isIP(address);
  return family !== 0 && PRIVATE.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Explains why a configured rack listener must not be served, if it must not.
 * Anything that reaches a plain-HTTP listener reads every rack token, data
 * URL, input, output and log on it, so plain HTTP is served only on the
 * loopback or a private address, to the addresses `allow` names: for a TLS
 * terminator in front of the hub, or for a network path encrypted end to end.
 * A TLS listener must advertise an https:// origin.
 * @param config - The hub configuration
 * @returns The reason, or undefined when the listener may be served
 * @example
 * listenerProblem({ ...defaultHubConfig(), listen: some({ host: '0.0.0.0', port: 7331n }), tls: false });
 */
export function listenerProblem(config: HubConfig): string | undefined {
  if (config.listen.type === 'none') return undefined;
  const { host } = config.listen.value;
  if (config.tls) {
    if (config.advertiseUrl.type === 'some' && new URL(config.advertiseUrl.value).protocol !== 'https:') {
      return 'A TLS rack listener must advertise an https:// origin';
    }
    return undefined;
  }
  if (wildcardHost(host)) return `Plain HTTP cannot be served on every address (${host}); bind the loopback or a private address, or serve TLS`;
  if (!privateHost(host)) return `Plain HTTP is served only on the loopback or a private address, not ${host}; serve TLS instead`;
  if (config.allow.length === 0) return 'A plain-HTTP rack listener must name the addresses it admits (--allow)';
  return undefined;
}

/** Checks the configuration's form: addresses, ports, timers and origin. */
function validateForm(config: HubConfig): void {
  if (config.listen.type === 'some') {
    if (!config.listen.value.host.trim()) throw new Error('Rack listen host is empty');
    const port = Number(config.listen.value.port);
    if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('Rack listen port must be 0–65535');
  }
  for (const address of config.allow) if (isIP(unmapped(address)) === 0) throw new Error(`Rack allowed address '${address}' is not an IP address`);
  const minutes = Number(config.idleExitMinutes);
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 35_000) throw new Error('Rack idle timeout must be 0–35000 minutes');
  if (config.advertiseUrl.type === 'some') {
    const url = new URL(config.advertiseUrl.value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('Rack advertise URL must be an HTTP(S) origin without credentials, path or query');
    }
  }
}

/**
 * Validates a configuration before it changes a running hub: its form, and
 * that its listener may be served ({@link listenerProblem}).
 * @param config - The configuration to apply
 * @throws {Error} When it is malformed or its listener must not be served
 */
export function validateHubConfig(config: HubConfig): void {
  validateForm(config);
  const problem = listenerProblem(config);
  if (problem !== undefined) throw new Error(problem);
}

/**
 * Reads the hub configuration, using defaults only when it is absent. A saved
 * listener that may no longer be served is loaded anyway: the hub reports it
 * down with the reason, and `e3 rack config` can still change it.
 * @param home - Private rack home
 * @returns The configuration
 * @throws {Error} When state is corrupt or requires a newer release
 * @example
 * const config = await loadHubConfig();
 */
export async function loadHubConfig(home = rackHome()): Promise<HubConfig> {
  const bytes = await readStateFile(join(home, HUB_CONFIG_FILE));
  const config = bytes === null ? defaultHubConfig() : decodeBeast2For(HubConfigType)(bytes);
  validateForm(config);
  return config;
}

/**
 * Atomically persists a validated configuration in the private rack home.
 * @param config - Configuration to persist
 * @param home - Private rack home
 * @example
 * await saveHubConfig(config);
 */
export async function saveHubConfig(config: HubConfig, home = rackHome()): Promise<void> {
  validateHubConfig(config);
  ensureRackHome(home);
  await writeStateFile(join(home, HUB_CONFIG_FILE), encodeBeast2For(HubConfigType)(config));
}

/** The hub's TLS certificate and private key, as kept in its private home. */
export const HubCertificateType = StructType({ certificatePem: StringType, privateKeyPem: StringType });

/**
 * Reads the hub's TLS certificate, creating it the first time. It is kept
 * until removed on purpose: every rack pins it, so a new one must be pinned
 * again on every rack.
 * @param home - Private rack home
 * @returns The certificate and its key
 * @throws {Error} When state is corrupt or requires a newer release
 * @example
 * const { certificatePem } = await loadHubCertificate();
 */
export async function loadHubCertificate(home = rackHome()): Promise<HubCertificate> {
  const file = join(home, HUB_TLS_FILE);
  const bytes = await readStateFile(file);
  if (bytes !== null) return decodeBeast2For(HubCertificateType)(bytes);
  const created = createHubCertificate();
  ensureRackHome(home);
  await writeStateFile(file, encodeBeast2For(HubCertificateType)(created));
  return created;
}
