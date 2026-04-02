#!/usr/bin/env npx tsx
/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * E3 Platform Deployment CLI
 *
 * Manages deployments defined in the deployments/ directory.
 *
 * Usage:
 *   ./scripts/deploy.ts list                    # List all deployments
 *   ./scripts/deploy.ts info <name>             # Show deployment details
 *   ./scripts/deploy.ts synth <name>            # Synthesize CloudFormation template
 *   ./scripts/deploy.ts diff <name>             # Show pending changes
 *   ./scripts/deploy.ts deploy <name>           # Deploy to AWS
 *   ./scripts/deploy.ts destroy <name>          # Destroy deployment (with confirmation)
 */

import { execSync, spawn } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const DEPLOYMENTS_DIR = join(ROOT_DIR, 'deployments');

// Deployment configuration interface
interface DeploymentConfig {
  name: string;
  description?: string;
  aws: {
    accountId: string;
    region: string;
    profile: string;
  };
  deployment: {
    id: string;
    callbackUrls?: string[];
    allowedOrigins?: string[];
  };
  domain?: {
    baseDomain: string;
    hostedZoneId: string;
    route53RoleArn?: string;
  };
  oidc?: {
    enabled?: boolean;
    providerName: string;
    clientId: string;
    issuerUrl: string;
    clientSecretArn: string;
  };
}

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string): void {
  console.log(message);
}

function logError(message: string): void {
  console.error(`${colors.red}Error:${colors.reset} ${message}`);
}

function logSuccess(message: string): void {
  console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function logInfo(message: string): void {
  console.log(`${colors.cyan}ℹ${colors.reset} ${message}`);
}

// Load all deployment configurations
function loadDeployments(): Map<string, DeploymentConfig> {
  const deployments = new Map<string, DeploymentConfig>();

  if (!existsSync(DEPLOYMENTS_DIR)) {
    return deployments;
  }

  const files = readdirSync(DEPLOYMENTS_DIR).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    const filePath = join(DEPLOYMENTS_DIR, file);
    const content = readFileSync(filePath, 'utf-8');
    const config = JSON.parse(content) as DeploymentConfig;
    deployments.set(config.name, config);
  }

  return deployments;
}

// Load a single deployment by name
function loadDeployment(name: string): DeploymentConfig {
  const deployments = loadDeployments();
  const config = deployments.get(name);

  if (!config) {
    const available = Array.from(deployments.keys()).join(', ');
    throw new Error(
      `Deployment '${name}' not found. Available: ${available || '(none)'}`
    );
  }

  return config;
}

// Build CDK context arguments from deployment config
function buildContextArgs(config: DeploymentConfig): string[] {
  const args: string[] = [
    `--context`, `deploymentId=${config.deployment.id}`,
  ];

  // Domain configuration
  if (config.domain) {
    args.push(`--context`, `domainBaseDomain=${config.domain.baseDomain}`);
    args.push(`--context`, `domainHostedZoneId=${config.domain.hostedZoneId}`);
    if (config.domain.route53RoleArn) {
      args.push(`--context`, `domainRoute53RoleArn=${config.domain.route53RoleArn}`);
    }
  }

  // OAuth/CORS configuration
  if (config.deployment.callbackUrls?.length) {
    args.push(`--context`, `callbackUrls=${JSON.stringify(config.deployment.callbackUrls)}`);
  }
  if (config.deployment.allowedOrigins?.length) {
    args.push(`--context`, `allowedOrigins=${JSON.stringify(config.deployment.allowedOrigins)}`);
  }

  // OIDC configuration
  if (config.oidc && config.oidc.enabled !== false) {
    args.push(`--context`, `oidcEnabled=true`);
    args.push(`--context`, `oidcProviderName=${config.oidc.providerName}`);
    args.push(`--context`, `oidcClientId=${config.oidc.clientId}`);
    args.push(`--context`, `oidcIssuerUrl=${config.oidc.issuerUrl}`);
    args.push(`--context`, `oidcSecretArn=${config.oidc.clientSecretArn}`);
  }

  return args;
}

// Run a CDK command
function runCdk(
  command: string,
  config: DeploymentConfig,
  extraArgs: string[] = [],
  options: { interactive?: boolean } = {}
): void {
  const stackName = `E3Platform-${config.deployment.id}`;
  const contextArgs = buildContextArgs(config);

  const args = [
    'cdk',
    command,
    stackName,
    ...contextArgs,
    ...extraArgs,
  ];

  const env = {
    ...process.env,
    AWS_PROFILE: config.aws.profile,
    CDK_DEFAULT_ACCOUNT: config.aws.accountId,
    CDK_DEFAULT_REGION: config.aws.region,
  };

  log(`${colors.dim}$ AWS_PROFILE=${config.aws.profile} npx ${args.join(' ')}${colors.reset}\n`);

  if (options.interactive) {
    // Use spawn for interactive commands (deploy with --require-approval)
    const result = spawn('npx', args, {
      cwd: ROOT_DIR,
      env,
      stdio: 'inherit',
    });

    result.on('close', (code) => {
      if (code !== 0) {
        process.exit(code ?? 1);
      }
    });
  } else {
    // Use execSync for non-interactive commands
    try {
      execSync(`npx ${args.join(' ')}`, {
        cwd: ROOT_DIR,
        env,
        stdio: 'inherit',
      });
    } catch (error) {
      process.exit(1);
    }
  }
}

// Verify AWS credentials are valid
function verifyCredentials(config: DeploymentConfig): boolean {
  try {
    const result = execSync(
      `aws sts get-caller-identity --profile ${config.aws.profile} --output json`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const identity = JSON.parse(result);

    if (identity.Account !== config.aws.accountId) {
      logError(
        `Profile '${config.aws.profile}' is for account ${identity.Account}, ` +
        `but deployment expects ${config.aws.accountId}`
      );
      return false;
    }

    return true;
  } catch {
    logError(`AWS credentials not valid. Run: aws sso login --profile ${config.aws.profile}`);
    return false;
  }
}

// Commands
function cmdList(): void {
  const deployments = loadDeployments();

  if (deployments.size === 0) {
    log('No deployments configured. Add JSON files to deployments/');
    return;
  }

  log(`${colors.bold}Available Deployments${colors.reset}\n`);

  for (const [name, config] of deployments) {
    const domain = config.domain
      ? `${config.deployment.id}.${config.domain.baseDomain}`
      : '(CloudFront domain)';

    log(`  ${colors.cyan}${name}${colors.reset}`);
    log(`    Account:  ${config.aws.accountId} (${config.aws.profile})`);
    log(`    Region:   ${config.aws.region}`);
    log(`    Domain:   ${domain}`);
    if (config.description) {
      log(`    ${colors.dim}${config.description}${colors.reset}`);
    }
    log('');
  }
}

function cmdInfo(name: string): void {
  const config = loadDeployment(name);

  log(`${colors.bold}Deployment: ${config.name}${colors.reset}\n`);

  if (config.description) {
    log(`${config.description}\n`);
  }

  log(`${colors.cyan}AWS Configuration${colors.reset}`);
  log(`  Account ID: ${config.aws.accountId}`);
  log(`  Region:     ${config.aws.region}`);
  log(`  Profile:    ${config.aws.profile}`);
  log('');

  log(`${colors.cyan}Deployment Settings${colors.reset}`);
  log(`  ID:         ${config.deployment.id}`);
  log(`  Stack:      E3Platform-${config.deployment.id}`);
  log('');

  if (config.domain) {
    log(`${colors.cyan}Domain Configuration${colors.reset}`);
    log(`  URL:            https://${config.deployment.id}.${config.domain.baseDomain}`);
    log(`  Base Domain:    ${config.domain.baseDomain}`);
    log(`  Hosted Zone:    ${config.domain.hostedZoneId}`);
    if (config.domain.route53RoleArn) {
      log(`  Route53 Role:   ${config.domain.route53RoleArn}`);
    }
    log('');
  } else {
    log(`${colors.cyan}Domain Configuration${colors.reset}`);
    log(`  Using CloudFront default domain`);
    log('');
  }

  if (config.oidc) {
    log(`${colors.cyan}OIDC Configuration${colors.reset}`);
    log(`  Provider:   ${config.oidc.providerName}`);
    log(`  Issuer:     ${config.oidc.issuerUrl}`);
    log('');
  }
}

function cmdSynth(name: string, outputDir?: string): void {
  const config = loadDeployment(name);

  logInfo(`Synthesizing ${config.name}...`);

  const extraArgs = outputDir ? ['--output', outputDir] : [];
  runCdk('synth', config, extraArgs);

  logSuccess('Synthesis complete');
}

function cmdDiff(name: string): void {
  const config = loadDeployment(name);

  if (!verifyCredentials(config)) {
    process.exit(1);
  }

  logInfo(`Comparing ${config.name} with deployed stack...`);

  runCdk('diff', config);
}

function cmdDeploy(name: string, requireApproval = true): void {
  const config = loadDeployment(name);

  if (!verifyCredentials(config)) {
    process.exit(1);
  }

  logInfo(`Deploying ${config.name} to ${config.aws.accountId}...`);

  const extraArgs = requireApproval ? [] : ['--require-approval', 'never'];
  runCdk('deploy', config, extraArgs, { interactive: true });
}

function cmdDestroy(name: string): void {
  const config = loadDeployment(name);

  if (!verifyCredentials(config)) {
    process.exit(1);
  }

  log(`${colors.red}${colors.bold}WARNING: This will destroy all resources for ${config.name}${colors.reset}`);
  log(`Account: ${config.aws.accountId}`);
  log(`Stack:   E3Platform-${config.deployment.id}`);
  log('');

  runCdk('destroy', config, [], { interactive: true });
}

// Main CLI
function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];
  const target = args[1];

  switch (command) {
    case 'list':
    case 'ls':
      cmdList();
      break;

    case 'info':
      if (!target) {
        logError('Usage: deploy.ts info <deployment-name>');
        process.exit(1);
      }
      cmdInfo(target);
      break;

    case 'synth':
      if (!target) {
        logError('Usage: deploy.ts synth <deployment-name> [--output <dir>]');
        process.exit(1);
      }
      const outputIdx = args.indexOf('--output');
      const outputDir = outputIdx !== -1 ? args[outputIdx + 1] : undefined;
      cmdSynth(target, outputDir);
      break;

    case 'diff':
      if (!target) {
        logError('Usage: deploy.ts diff <deployment-name>');
        process.exit(1);
      }
      cmdDiff(target);
      break;

    case 'deploy':
      if (!target) {
        logError('Usage: deploy.ts deploy <deployment-name> [--yes]');
        process.exit(1);
      }
      const autoApprove = args.includes('--yes') || args.includes('-y');
      cmdDeploy(target, !autoApprove);
      break;

    case 'destroy':
      if (!target) {
        logError('Usage: deploy.ts destroy <deployment-name>');
        process.exit(1);
      }
      cmdDestroy(target);
      break;

    default:
      log(`${colors.bold}E3 Platform Deployment CLI${colors.reset}

Usage:
  ./scripts/deploy.ts <command> [options]

Commands:
  list                    List all configured deployments
  info <name>             Show deployment configuration details
  synth <name>            Synthesize CloudFormation template
  diff <name>             Show pending changes vs deployed stack
  deploy <name> [--yes]   Deploy to AWS (--yes skips confirmation)
  destroy <name>          Destroy deployment (with confirmation)

Examples:
  ./scripts/deploy.ts list
  ./scripts/deploy.ts info elara-dev
  ./scripts/deploy.ts deploy elara-dev
  ./scripts/deploy.ts diff elara-dev
`);
      if (command && command !== 'help' && command !== '--help' && command !== '-h') {
        logError(`Unknown command: ${command}`);
        process.exit(1);
      }
  }
}

main();
