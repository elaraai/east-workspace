/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Integration tests for deployed e3 API endpoints.
 *
 * These tests validate that:
 * 1. The infrastructure is deployed correctly
 * 2. API Gateway routes to Lambda correctly
 * 3. Public endpoints work without authentication
 * 4. Protected endpoints require authentication
 * 5. CloudFront properly routes requests
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { getStackOutputs, getDeploymentId, type StackOutputs } from './helpers/stack-outputs.js';

describe('E3 Platform API Endpoints', { timeout: 60000 }, () => {
  let outputs: StackOutputs;
  const deploymentId = getDeploymentId();

  before(async () => {
    console.log(`\nRunning integration tests against deployment: ${deploymentId}`);
    outputs = await getStackOutputs(deploymentId);
    console.log(`API Endpoint: ${outputs.apiEndpoint}`);
    console.log(`Platform URL: ${outputs.platformUrl}\n`);
  });

  describe('Stack Outputs', () => {
    it('should have all required outputs', () => {
      // Storage
      assert.ok(outputs.dataBucketName, 'dataBucketName should be defined');
      assert.ok(outputs.dataTableName, 'dataTableName should be defined');

      // Auth
      assert.ok(outputs.userPoolId, 'userPoolId should be defined');
      assert.ok(outputs.userPoolClientId, 'userPoolClientId should be defined');
      assert.ok(outputs.cognitoIssuer, 'cognitoIssuer should be defined');
      assert.ok(outputs.cognitoDomain, 'cognitoDomain should be defined');

      // API
      assert.ok(outputs.apiEndpoint, 'apiEndpoint should be defined');

      // Compute
      assert.ok(outputs.taskStateMachineArn, 'taskStateMachineArn should be defined');
      assert.ok(outputs.dataflowStateMachineArn, 'dataflowStateMachineArn should be defined');
      assert.ok(outputs.gcStateMachineArn, 'gcStateMachineArn should be defined');

      // Frontend
      assert.ok(outputs.appsBucketName, 'appsBucketName should be defined');
      assert.ok(outputs.distributionId, 'distributionId should be defined');
      assert.ok(outputs.platformUrl, 'platformUrl should be defined');
    });

    it('should have valid API endpoint URL', () => {
      assert.match(
        outputs.apiEndpoint,
        /^https:\/\/.+\.execute-api\..+\.amazonaws\.com$/,
        'apiEndpoint should match API Gateway URL pattern'
      );
    });

    it('should have valid Platform URL', () => {
      // Could be CloudFront domain or custom domain
      assert.match(outputs.platformUrl, /^https:\/\/.+/, 'platformUrl should be HTTPS');
    });
  });

  describe('Health Check (Public)', () => {
    it('should respond to health check via API Gateway', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/health`);

      assert.strictEqual(response.status, 200);
      assert.ok(
        response.headers.get('content-type')?.includes('application/json'),
        'Content-Type should be application/json'
      );

      const body = await response.json();
      assert.deepStrictEqual(body, { status: 'ok' });
    });

    it('should respond to health check via CloudFront', async () => {
      const response = await fetch(`${outputs.platformUrl}/health`);

      assert.strictEqual(response.status, 200);

      const body = await response.json();
      assert.deepStrictEqual(body, { status: 'ok' });
    });
  });

  describe('OIDC Discovery (Public)', () => {
    interface OIDCConfig {
      issuer?: string;
      device_authorization_endpoint?: string;
      token_endpoint?: string;
      jwks_uri?: string;
      grant_types_supported?: string[];
    }

    it('should return OIDC configuration', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/.well-known/openid-configuration`);

      assert.strictEqual(response.status, 200);

      const config = (await response.json()) as OIDCConfig;
      assert.ok(config.issuer, 'issuer should be defined');
      assert.ok(config.device_authorization_endpoint, 'device_authorization_endpoint should be defined');
      assert.ok(config.token_endpoint, 'token_endpoint should be defined');
      assert.ok(config.jwks_uri, 'jwks_uri should be defined');
      assert.ok(
        config.grant_types_supported?.includes('urn:ietf:params:oauth:grant-type:device_code'),
        'grant_types_supported should include device_code'
      );
    });

    it('should return OIDC configuration via CloudFront', async () => {
      const response = await fetch(`${outputs.platformUrl}/.well-known/openid-configuration`);

      assert.strictEqual(response.status, 200);

      const config = (await response.json()) as OIDCConfig;
      assert.ok(config.issuer, 'issuer should be defined');
    });
  });

  describe('Device Flow Endpoints (Public)', () => {
    it('should accept device authorization request', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/oauth2/device_authorization`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'client_id=test',
      });

      // Should return 200 with device code, or 400 if client_id invalid
      assert.ok(
        [200, 400].includes(response.status),
        `Expected 200 or 400, got ${response.status}`
      );
    });

    it('should serve device approval page', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/device`);

      assert.strictEqual(response.status, 200);
      assert.ok(
        response.headers.get('content-type')?.includes('text/html'),
        'Content-Type should be text/html'
      );
    });
  });

  describe('Protected Endpoints (Require Auth)', () => {
    it('should require authentication for repo list', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/api/repos`);

      // API Gateway JWT authorizer returns 401
      assert.strictEqual(response.status, 401);
    });

    it('should require authentication for repo operations', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/api/repos/test-repo/packages`);

      assert.strictEqual(response.status, 401);
    });

    it('should require authentication for workspace operations', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/api/repos/test-repo/workspaces`);

      assert.strictEqual(response.status, 401);
    });
  });

  describe('CORS', () => {
    it('should include CORS headers for allowed origins', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/health`, {
        headers: {
          Origin: 'http://localhost:5173',
        },
      });

      assert.strictEqual(
        response.headers.get('access-control-allow-origin'),
        'http://localhost:5173'
      );
    });

    it('should handle preflight requests', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/api/repos`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'Authorization,Content-Type',
        },
      });

      assert.strictEqual(response.status, 204);
      assert.ok(
        response.headers.get('access-control-allow-methods'),
        'access-control-allow-methods should be defined'
      );
      assert.ok(
        response.headers.get('access-control-allow-headers'),
        'access-control-allow-headers should be defined'
      );
    });

    it('should allow credentials for allowed origins', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/health`, {
        headers: {
          Origin: 'http://localhost:5173',
        },
      });

      assert.strictEqual(response.headers.get('access-control-allow-credentials'), 'true');
    });
  });

  describe('CloudFront Distribution', () => {
    it('should route API requests through CloudFront', async () => {
      const response = await fetch(`${outputs.platformUrl}/api/repos`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'GET',
        },
      });

      // CloudFront should forward to API Gateway
      assert.strictEqual(response.status, 204);
    });

    it('should serve frontend for root path', async () => {
      const response = await fetch(outputs.platformUrl, {
        redirect: 'manual',
      });

      // Might be 200 (index.html), 403 (no index.html yet), or redirect
      assert.ok(
        [200, 301, 302, 403, 404].includes(response.status),
        `Expected 200, 301, 302, 403, or 404, got ${response.status}`
      );
    });
  });
});
