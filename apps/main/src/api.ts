/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Simple API client for the e3 cloud API.
 * In Phase 3, this will be replaced with @elaraai/e3-api-client.
 */
export class ApiClient {
  private baseUrl: string;

  constructor(tenant: string) {
    this.baseUrl = `/repos/${tenant}/api`;
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const token = localStorage.getItem('e3_token');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { ...headers, ...options?.headers },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async listWorkspaces(): Promise<string[]> {
    const data = await this.fetch<{ workspaces: string[] }>('/workspaces');
    return data.workspaces;
  }

  async startDataflow(workspace: string): Promise<{ executionArn: string }> {
    return this.fetch(`/workspaces/${workspace}/start`, {
      method: 'POST',
    });
  }
}

// Singleton per tenant
const clients = new Map<string, ApiClient>();

export function getApiClient(tenant: string): ApiClient {
  if (!clients.has(tenant)) {
    clients.set(tenant, new ApiClient(tenant));
  }
  return clients.get(tenant)!;
}
