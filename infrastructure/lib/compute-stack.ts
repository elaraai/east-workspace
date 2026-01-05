/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

export interface ComputeStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  fileSystem: efs.IFileSystem;
}

export class ComputeStack extends cdk.Stack {
  public readonly dataflowStateMachine: sfn.IStateMachine;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    // EFS Access Point for runners
    const runnerAccessPoint = new efs.AccessPoint(this, 'RunnerAccessPoint', {
      fileSystem: props.fileSystem as efs.FileSystem,
      path: '/runners',
      createAcl: {
        ownerGid: '1001',
        ownerUid: '1001',
        permissions: '755',
      },
      posixUser: {
        gid: '1001',
        uid: '1001',
      },
    });

    // Security group for runners
    const runnerSg = new ec2.SecurityGroup(this, 'RunnerSg', {
      vpc: props.vpc,
      description: 'Security group for e3 task runners',
    });

    // Task runner Lambda (east-node)
    const taskRunner = new lambda.Function(this, 'TaskRunner', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          // Placeholder - will be replaced with e3-cloud-runner package
          console.log('Task execution:', JSON.stringify(event));
          return {
            state: 'success',
            outputHash: 'placeholder-hash',
          };
        };
      `),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [runnerSg],
      filesystem: lambda.FileSystem.fromEfsAccessPoint(runnerAccessPoint, '/mnt/efs'),
      timeout: cdk.Duration.minutes(15),
      memorySize: 3008,
      environment: {
        EFS_MOUNT_PATH: '/mnt/efs',
      },
    });

    // Step Functions: Task execution state machine
    const runTaskState = new tasks.LambdaInvoke(this, 'RunTask', {
      lambdaFunction: taskRunner,
      outputPath: '$.Payload',
    });

    const taskStateMachine = new sfn.StateMachine(this, 'TaskStateMachine', {
      stateMachineName: 'e3-task-execution',
      definitionBody: sfn.DefinitionBody.fromChainable(runTaskState),
      timeout: cdk.Duration.hours(1),
    });

    // Step Functions: Dataflow orchestration state machine
    // This is a placeholder - the actual implementation will iterate over the DAG
    const startState = new sfn.Pass(this, 'Start', {
      result: sfn.Result.fromObject({ status: 'started' }),
    });

    const endState = new sfn.Pass(this, 'End', {
      result: sfn.Result.fromObject({ status: 'completed' }),
    });

    this.dataflowStateMachine = new sfn.StateMachine(this, 'DataflowStateMachine', {
      stateMachineName: 'e3-dataflow',
      definitionBody: sfn.DefinitionBody.fromChainable(startState.next(endState)),
      timeout: cdk.Duration.hours(24),
    });

    // Outputs
    new cdk.CfnOutput(this, 'TaskStateMachineArn', {
      value: taskStateMachine.stateMachineArn,
    });
    new cdk.CfnOutput(this, 'DataflowStateMachineArn', {
      value: this.dataflowStateMachine.stateMachineArn,
    });
  }
}
