import * as cdk from "aws-cdk-lib";

import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as aws_dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodeJs from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3Notifications from "aws-cdk-lib/aws-s3-notifications";
import * as sns from "aws-cdk-lib/aws-sns";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";
import {
  GPT_API_KEY_SSM_PARAMETER_NAME,
  NOTIFICATION_EMAIL,
  SOURCE_IMAGES_PREFIX,
} from "./constants";

export class ImageClassificationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const gptApiKey = ssm.StringParameter.valueForStringParameter(
      this,
      GPT_API_KEY_SSM_PARAMETER_NAME,
    );

    const rateLimitTable = new aws_dynamodb.Table(this, "RateLimitTable", {
      partitionKey: {
        name: "pk",
        type: cdk.aws_dynamodb.AttributeType.STRING,
      },
      billingMode: aws_dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: "expires_at",
    });

    const classificationTable = new aws_dynamodb.Table(
      this,
      "ClassificationTable",
      {
        partitionKey: {
          name: "requestId",
          type: cdk.aws_dynamodb.AttributeType.STRING,
        },
        sortKey: {
          name: "imageId",
          type: cdk.aws_dynamodb.AttributeType.STRING,
        },
        billingMode: aws_dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    );

    classificationTable.addGlobalSecondaryIndex({
      indexName: "resizedOn-requestId-index",
      partitionKey: {
        name: "resizedOn",
        type: cdk.aws_dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "requestId",
        type: cdk.aws_dynamodb.AttributeType.STRING,
      },
    });

    const bucket = new s3.Bucket(this, "Bucket", {
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const api = new apigateway.RestApi(this, "ImageClassificationApi", {
      restApiName: "Image Classification API",
      description: "This service serves Image Classification API.",
      endpointConfiguration: {
        types: [cdk.aws_apigateway.EndpointType.REGIONAL],
      },
    });

    const apiKey = new apigateway.ApiKey(this, "ImageClassificationApiKey", {
      apiKeyName: "Image Classification API Key",
    });

    const usagePlan = new apigateway.UsagePlan(
      this,
      "ImageClassificationUsagePlan",
      {
        name: "Image Classification Usage Plan",
        throttle: {
          rateLimit: 10,
          burstLimit: 2,
        },
      },
    );

    usagePlan.addApiKey(apiKey);

    usagePlan.addApiStage({
      stage: api.deploymentStage,
      api: api,
    });

    const uploadUrlLambda = new lambdaNodeJs.NodejsFunction(
      this,
      "UploadUrlLambda",
      {
        entry: "./lib/lambda/upload-url/handler.ts",
        handler: "main",
        environment: {
          BUCKET_NAME: bucket.bucketName,
          CLASSIFICATION_TABLE_NAME: classificationTable.tableName,
        },
        timeout: cdk.Duration.seconds(28),
        runtime: lambda.Runtime.NODEJS_18_X,
      },
    );

    uploadUrlLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:PutObject"],
        resources: [bucket.bucketArn + "/*"],
      }),
    );

    uploadUrlLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem",
          "dynamodb:GetItem",
          "dynamodb:BatchWriteItem",
        ],
        resources: [classificationTable.tableArn],
      }),
    );

    const awsLabelDetectionLambda = new lambdaNodeJs.NodejsFunction(
      this,
      "AwsLabelDetectionLambda",
      {
        entry: "./lib/lambda/aws-label-detection/handler.ts",
        handler: "main",
        environment: {
          BUCKET_NAME: bucket.bucketName,
          CLASSIFICATION_TABLE_NAME: classificationTable.tableName,
        },
        timeout: cdk.Duration.seconds(900),
        runtime: lambda.Runtime.NODEJS_18_X,
      },
    );

    awsLabelDetectionLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem",
          "dynamodb:GetItem",
          "dynamodb:BatchWriteItem",
        ],
        resources: [classificationTable.tableArn],
      }),
    );

    awsLabelDetectionLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["rekognition:DetectLabels"],
        resources: ["*"],
      }),
    );

    awsLabelDetectionLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [bucket.bucketArn + "/*"],
      }),
    );

    const gptLabelDetectionLambda = new lambdaNodeJs.NodejsFunction(
      this,
      "GptLabelDetectionLambda",
      {
        entry: "./lib/lambda/gpt-label-detection/handler.ts",
        handler: "main",
        environment: {
          BUCKET_NAME: bucket.bucketName,
          CLASSIFICATION_TABLE_NAME: classificationTable.tableName,
          OPENAI_API_KEY: gptApiKey,
        },
        timeout: cdk.Duration.seconds(900),
        runtime: lambda.Runtime.NODEJS_18_X,
      },
    );

    gptLabelDetectionLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem",
          "dynamodb:GetItem",
          "dynamodb:BatchWriteItem",
        ],
        resources: [classificationTable.tableArn],
      }),
    );

    gptLabelDetectionLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [bucket.bucketArn + "/*"],
      }),
    );

    const getStatusLambda = new lambdaNodeJs.NodejsFunction(
      this,
      "GetStatusLambda",
      {
        entry: "./lib/lambda/get-status/handler.ts",
        handler: "main",
        environment: {
          CLASSIFICATION_TABLE_NAME: classificationTable.tableName,
        },
        timeout: cdk.Duration.seconds(28),
        runtime: lambda.Runtime.NODEJS_18_X,
      },
    );

    getStatusLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query"],
        resources: [classificationTable.tableArn],
      }),
    );

    getStatusLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["states:DescribeExecution"],
        resources: ["*"],
      }),
    );

    const checkRateLimitLambda = new lambdaNodeJs.NodejsFunction(
      this,
      "CheckRateLimitLambda",
      {
        entry: "./lib/lambda/check-rate-limit/handler.ts",
        handler: "main",
        environment: {
          RATE_LIMIT_TABLE_NAME: rateLimitTable.tableName,
        },
        timeout: cdk.Duration.seconds(28),
        runtime: lambda.Runtime.NODEJS_18_X,
      },
    );

    checkRateLimitLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query", "dynamodb:UpdateItem"],
        resources: [rateLimitTable.tableArn],
      }),
    );

    const topic = new sns.Topic(this, "ImageClassificationTopic");

    const rateLimitErrorTopic = new sns.Topic(this, "RateLimitErrorTopic");
    new sns.Subscription(this, "RateLimitErrorSubscription", {
      topic: rateLimitErrorTopic,
      protocol: sns.SubscriptionProtocol.EMAIL,
      endpoint: NOTIFICATION_EMAIL,
    });

    const labelDetectionUsingAWS = new tasks.LambdaInvoke(
      this,
      "LabelDetectionUsingAWS",
      {
        lambdaFunction: awsLabelDetectionLambda,
      },
    );

    const labelDetectionUsingGPT = new tasks.LambdaInvoke(
      this,
      "LabelDetectionUsingGPT",
      {
        lambdaFunction: gptLabelDetectionLambda,
      },
    );

    const checkRateLimitTask = new tasks.LambdaInvoke(this, "CheckRateLimit", {
      lambdaFunction: checkRateLimitLambda,
    });

    const getStatusTask = new tasks.LambdaInvoke(this, "GetStatus", {
      lambdaFunction: getStatusLambda,
      payload: sfn.TaskInput.fromObject({
        requestId: sfn.JsonPath.stringAt("$.Payload.requestId"),
        "executionId.$": "$$.Execution.Id",
      }),
    });

    const sendNotificationTask = new tasks.SnsPublish(
      this,
      "SendNotification",
      {
        topic: topic,
        message: sfn.TaskInput.fromJsonPathAt("$.Payload"),
      },
    );

    const sendRateLimitErrorNotificationTask = new tasks.SnsPublish(
      this,
      "SendRateLimitErrorNotification",
      {
        topic: rateLimitErrorTopic,
        message: sfn.TaskInput.fromText("GPTVision rate limited"),
      },
    );

    getStatusTask.next(sendNotificationTask);

    const imageClassificationStepFunction = new sfn.StateMachine(
      this,
      "ImageClassificationStepFunction",
      {
        definitionBody: sfn.DefinitionBody.fromChainable(
          labelDetectionUsingAWS
            .addRetry({
              maxAttempts: 5,
              backoffRate: 2.0,
              interval: cdk.Duration.seconds(30),
              errors: ["States.ALL"],
            })
            .next(
              new sfn.Choice(this, "HasUnclassifiedImagesCheck")
                .when(
                  sfn.Condition.numberGreaterThan(
                    "$.Payload.unclassifiedImagesCount",
                    0,
                  ),
                  checkRateLimitTask.next(
                    new sfn.Choice(this, "RateLimitCheck")
                      .when(
                        sfn.Condition.numberGreaterThan(
                          "$.Payload.remainingRateLimit",
                          0,
                        ),
                        labelDetectionUsingGPT
                          .addRetry({
                            maxAttempts: 30,
                            backoffRate: 2.0,
                            interval: cdk.Duration.seconds(60),
                            errors: ["States.ALL"],
                          })
                          .next(
                            new sfn.Choice(this, "IsRateLimited")
                              .when(
                                sfn.Condition.booleanEquals(
                                  "$.Payload.rateLimitError",
                                  true,
                                ),
                                sendRateLimitErrorNotificationTask,
                              )
                              .otherwise(getStatusTask),
                          ),
                      )
                      .otherwise(
                        new sfn.Wait(this, "WaitForRateLimitLift", {
                          time: sfn.WaitTime.secondsPath(
                            "$.Payload.waitDuration",
                          ),
                        }).next(checkRateLimitTask),
                      ),
                  ),
                )
                .otherwise(getStatusTask),
            ),
        ),
      },
    );

    const sharpLayer = new lambda.LayerVersion(this, "SharpLayerVersion", {
      description: "Sharp layer",
      code: lambda.Code.fromAsset("./lib/layers/sharp"),
      compatibleArchitectures: [lambda.Architecture.X86_64],
      compatibleRuntimes: [
        lambda.Runtime.NODEJS_18_X,
        lambda.Runtime.NODEJS_20_X,
      ],
    });

    const resizeImageLambda = new lambdaNodeJs.NodejsFunction(
      this,
      "ResizeImageLambda",
      {
        entry: "./lib/lambda/resize-image/handler.ts",
        handler: "main",
        environment: {
          BUCKET_NAME: bucket.bucketName,
          CLASSIFICATION_TABLE_NAME: classificationTable.tableName,
          STATE_MACHINE_ARN: imageClassificationStepFunction.stateMachineArn,
        },
        timeout: cdk.Duration.seconds(900),
        runtime: lambda.Runtime.NODEJS_18_X,
        bundling: {
          externalModules: ["sharp"],
        },
        layers: [sharpLayer],
      },
    );

    resizeImageLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:PutObject"],
        resources: [bucket.bucketArn + "/*"],
      }),
    );

    resizeImageLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem",
          "dynamodb:GetItem",
          "dynamodb:BatchWriteItem",
        ],
        resources: [classificationTable.tableArn],
      }),
    );

    resizeImageLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["states:StartExecution"],
        resources: [imageClassificationStepFunction.stateMachineArn],
      }),
    );

    bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3Notifications.LambdaDestination(resizeImageLambda),
      {
        prefix: `${SOURCE_IMAGES_PREFIX}/`,
      },
    );

    const uploadUrlIntegration = new apigateway.LambdaIntegration(
      uploadUrlLambda,
    );
    const uploadUrlResource = api.root.addResource("upload-url");
    uploadUrlResource.addMethod("POST", uploadUrlIntegration, {
      apiKeyRequired: true,
    });

    const getStatusIntegration = new apigateway.LambdaIntegration(
      getStatusLambda,
    );
    const getStatusesResource = api.root.addResource("status");

    const getStatusResource = getStatusesResource.addResource("{requestId}");

    getStatusResource.addMethod("GET", getStatusIntegration, {
      apiKeyRequired: true,
    });

    const backfillLambda = new lambdaNodeJs.NodejsFunction(
      this,
      "BackfillLambda",
      {
        entry: "./lib/lambda/backfill/handler.ts",
        handler: "main",
        environment: {
          BUCKET_NAME: bucket.bucketName,
          CLASSIFICATION_TABLE_NAME: classificationTable.tableName,
          STATE_MACHINE_ARN: imageClassificationStepFunction.stateMachineArn,
        },
        timeout: cdk.Duration.seconds(60),
        runtime: lambda.Runtime.NODEJS_18_X,
      },
    );

    backfillLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query", "dynamodb:GetItem"],
        resources: [
          classificationTable.tableArn,
          classificationTable.tableArn + "/index/resizedOn-requestId-index",
        ],
      }),
    );

    backfillLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["states:StartExecution", "states:ListExecutions"],
        resources: [imageClassificationStepFunction.stateMachineArn],
      }),
    );

    const rule = new cdk.aws_events.Rule(this, "BackfillRule", {
      schedule: cdk.aws_events.Schedule.rate(cdk.Duration.hours(12)),
    });

    rule.addTarget(new cdk.aws_events_targets.LambdaFunction(backfillLambda));

    new cdk.CfnOutput(this, "API Base URL", {
      value: api.url,
    });
  }
}
