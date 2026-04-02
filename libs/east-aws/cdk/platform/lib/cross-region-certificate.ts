/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Cross-Region Certificate Construct
 *
 * Creates an ACM certificate in us-east-1 (required for CloudFront) from any region.
 * Handles DNS validation automatically, including cross-account hosted zones.
 */

import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export interface CrossRegionCertificateProps {
  /**
   * The domain name for the certificate (e.g., "dev.e3.elaraai.com").
   * A single-domain certificate will be created.
   */
  domainName: string;

  /**
   * Route53 Hosted Zone ID where the DNS validation record should be created.
   */
  hostedZoneId: string;

  /**
   * The domain name of the hosted zone (e.g., "e3.elaraai.com").
   * Used to construct the full validation record name.
   */
  hostedZoneName: string;

  /**
   * Optional: IAM role ARN to assume for cross-account Route53 access.
   * If the hosted zone is in a different account, provide the role ARN here.
   * The role must allow route53:ChangeResourceRecordSets on the hosted zone.
   */
  route53RoleArn?: string;

  /**
   * Optional: Removal policy for the certificate.
   * @default RemovalPolicy.DESTROY
   */
  removalPolicy?: cdk.RemovalPolicy;
}

/**
 * Creates an ACM certificate in us-east-1 with automatic DNS validation.
 *
 * This construct handles:
 * - Cross-region certificate creation (always us-east-1 for CloudFront)
 * - DNS validation record creation in Route53
 * - Cross-account hosted zone access via role assumption
 * - Waiting for certificate validation
 *
 * The certificate ARN is available via the `certificateArn` property.
 */
export class CrossRegionCertificate extends Construct {
  /**
   * The ARN of the created certificate (in us-east-1).
   */
  public readonly certificateArn: string;

  constructor(scope: Construct, id: string, props: CrossRegionCertificateProps) {
    super(scope, id);

    const { domainName, hostedZoneId, hostedZoneName, route53RoleArn, removalPolicy } = props;

    // Log group for certificate handler
    const logGroup = new logs.LogGroup(this, 'HandlerLogs', {
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda function for certificate management
    const certHandler = new lambda.Function(this, 'Handler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(14), // ACM validation can take time
      code: lambda.Code.fromInline(this.getLambdaCode()),
      logGroup,
    });

    // Grant ACM permissions (us-east-1)
    certHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'acm:RequestCertificate',
          'acm:DescribeCertificate',
          'acm:DeleteCertificate',
          'acm:ListTagsForCertificate',
          'acm:AddTagsToCertificate',
        ],
        resources: ['*'], // ACM requires * for RequestCertificate
        conditions: {
          StringEquals: {
            'aws:RequestedRegion': 'us-east-1',
          },
        },
      })
    );

    // Grant Route53 permissions (for DNS validation)
    if (route53RoleArn) {
      // Cross-account: grant permission to assume the provided role
      certHandler.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['sts:AssumeRole'],
          resources: [route53RoleArn],
        })
      );
    } else {
      // Same account: grant direct Route53 access
      certHandler.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['route53:ChangeResourceRecordSets', 'route53:GetChange'],
          resources: [
            `arn:aws:route53:::hostedzone/${hostedZoneId}`,
            'arn:aws:route53:::change/*',
          ],
        })
      );
    }

    // Custom resource provider
    const provider = new cr.Provider(this, 'Provider', {
      onEventHandler: certHandler,
    });

    // Custom resource for certificate
    const certResource = new cdk.CustomResource(this, 'Certificate', {
      serviceToken: provider.serviceToken,
      resourceType: 'Custom::CrossRegionCertificate',
      properties: {
        DomainName: domainName,
        HostedZoneId: hostedZoneId,
        HostedZoneName: hostedZoneName,
        Route53RoleArn: route53RoleArn ?? '',
        // Force update when domain changes
        DomainHash: cdk.Fn.base64(domainName),
      },
      removalPolicy: removalPolicy ?? cdk.RemovalPolicy.DESTROY,
    });

    this.certificateArn = certResource.getAttString('CertificateArn');
  }

  private getLambdaCode(): string {
    return `
const { ACMClient, RequestCertificateCommand, DescribeCertificateCommand, DeleteCertificateCommand } = require('@aws-sdk/client-acm');
const { Route53Client, ChangeResourceRecordSetsCommand, GetChangeCommand } = require('@aws-sdk/client-route-53');
const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');

const acm = new ACMClient({ region: 'us-east-1' });
const sts = new STSClient({});

async function getRoute53Client(roleArn) {
  if (!roleArn) {
    return new Route53Client({});
  }

  const assumeResult = await sts.send(new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: 'CrossRegionCertificate',
  }));

  return new Route53Client({
    credentials: {
      accessKeyId: assumeResult.Credentials.AccessKeyId,
      secretAccessKey: assumeResult.Credentials.SecretAccessKey,
      sessionToken: assumeResult.Credentials.SessionToken,
    },
  });
}

async function waitForValidation(certificateArn, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await acm.send(new DescribeCertificateCommand({ CertificateArn: certificateArn }));
    const status = result.Certificate.Status;

    if (status === 'ISSUED') {
      return true;
    }
    if (status === 'FAILED') {
      throw new Error('Certificate validation failed');
    }

    // Wait 10 seconds between checks
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error('Certificate validation timed out');
}

async function waitForRoute53Change(route53, changeId) {
  for (let i = 0; i < 30; i++) {
    const result = await route53.send(new GetChangeCommand({ Id: changeId }));
    if (result.ChangeInfo.Status === 'INSYNC') {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const { DomainName, HostedZoneId, HostedZoneName, Route53RoleArn } = event.ResourceProperties;

  if (event.RequestType === 'Create' || event.RequestType === 'Update') {
    // For Update, we create a new cert (ACM certs can't be modified)
    // The old cert will be deleted by CloudFormation

    // Request certificate
    const certResult = await acm.send(new RequestCertificateCommand({
      DomainName,
      ValidationMethod: 'DNS',
      Tags: [
        { Key: 'ManagedBy', Value: 'CDK-CrossRegionCertificate' },
        { Key: 'Domain', Value: DomainName },
      ],
    }));

    const certificateArn = certResult.CertificateArn;
    console.log('Certificate requested:', certificateArn);

    // Wait for DNS validation options to be available
    let validationOptions;
    for (let i = 0; i < 10; i++) {
      const descResult = await acm.send(new DescribeCertificateCommand({ CertificateArn: certificateArn }));
      validationOptions = descResult.Certificate.DomainValidationOptions;

      if (validationOptions?.[0]?.ResourceRecord) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (!validationOptions?.[0]?.ResourceRecord) {
      throw new Error('Failed to get DNS validation options');
    }

    const validation = validationOptions[0].ResourceRecord;
    console.log('Validation record:', validation);

    // Create DNS validation record
    const route53 = await getRoute53Client(Route53RoleArn || null);

    const changeResult = await route53.send(new ChangeResourceRecordSetsCommand({
      HostedZoneId,
      ChangeBatch: {
        Comment: 'ACM certificate validation for ' + DomainName,
        Changes: [{
          Action: 'UPSERT',
          ResourceRecordSet: {
            Name: validation.Name,
            Type: validation.Type,
            TTL: 300,
            ResourceRecords: [{ Value: validation.Value }],
          },
        }],
      },
    }));

    console.log('DNS record created, change ID:', changeResult.ChangeInfo.Id);

    // Wait for DNS change to propagate
    await waitForRoute53Change(route53, changeResult.ChangeInfo.Id);

    // Wait for certificate validation
    await waitForValidation(certificateArn);

    console.log('Certificate validated:', certificateArn);

    return {
      PhysicalResourceId: certificateArn,
      Data: {
        CertificateArn: certificateArn,
      },
    };
  }

  if (event.RequestType === 'Delete') {
    const certificateArn = event.PhysicalResourceId;

    if (certificateArn && certificateArn.startsWith('arn:aws:acm:')) {
      try {
        // Delete the DNS validation record first
        const descResult = await acm.send(new DescribeCertificateCommand({ CertificateArn: certificateArn }));
        const validationOptions = descResult.Certificate?.DomainValidationOptions;

        if (validationOptions?.[0]?.ResourceRecord) {
          const validation = validationOptions[0].ResourceRecord;
          const route53 = await getRoute53Client(Route53RoleArn || null);

          try {
            await route53.send(new ChangeResourceRecordSetsCommand({
              HostedZoneId,
              ChangeBatch: {
                Comment: 'Cleanup ACM validation record for ' + DomainName,
                Changes: [{
                  Action: 'DELETE',
                  ResourceRecordSet: {
                    Name: validation.Name,
                    Type: validation.Type,
                    TTL: 300,
                    ResourceRecords: [{ Value: validation.Value }],
                  },
                }],
              },
            }));
          } catch (e) {
            console.log('Failed to delete validation record (may not exist):', e.message);
          }
        }

        // Delete the certificate
        await acm.send(new DeleteCertificateCommand({ CertificateArn: certificateArn }));
        console.log('Certificate deleted:', certificateArn);
      } catch (e) {
        console.log('Error during cleanup:', e.message);
        // Don't fail deletion
      }
    }

    return {
      PhysicalResourceId: event.PhysicalResourceId,
    };
  }
};
`;
  }
}
