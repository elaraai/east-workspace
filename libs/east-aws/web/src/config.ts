/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

export interface PlatformConfig {
  cognitoDomain: string;
  cognitoClientId: string;
  redirectUri: string;
  oidcProviderName: string;
}

let configPromise: Promise<PlatformConfig> | null = null;

export function loadConfig(): Promise<PlatformConfig> {
  if (!configPromise) {
    configPromise = fetch('/config.json').then(res => {
      if (!res.ok) throw new Error(`Failed to load config: ${res.status}`);
      return res.json() as Promise<PlatformConfig>;
    });
  }
  return configPromise;
}
