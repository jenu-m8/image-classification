import { QueryCommand } from "@aws-sdk/client-dynamodb";
import {
  ListExecutionsCommand,
  StartExecutionCommand,
} from "@aws-sdk/client-sfn";
import { Handler } from "aws-lambda";
import { dynamoDBClient, sfnClient } from "lib/clients";
import { queryDynamoDB } from "lib/utils/queryDynamoDB";

const backfill = async (resizedOn: string) => {
  const queryCommand = new QueryCommand({
    TableName: process.env.CLASSIFICATION_TABLE_NAME,
    IndexName: "resizedOn-requestId-index",
    KeyConditionExpression: "resizedOn = :resizedOn",
    ExpressionAttributeValues: {
      ":resizedOn": { S: resizedOn },
      ":tries": { N: "3" },
    },
    FilterExpression: "attribute_not_exists(tries) OR tries < :tries",
  });
  const queryResult = await dynamoDBClient.send(queryCommand);
  const items = queryResult.Items;

  console.log("items?.length", items?.length);

  const allItems = items?.map((item) => item.requestId.S);
  const requestIds = [...new Set(allItems)];

  if (requestIds.length === 0) {
    return false;
  }

  let successfulStarts = 0;

  for (const requestId of requestIds) {
    if (!requestId) {
      continue;
    }
    const response = await queryDynamoDB(requestId);
    const allImagesResized = response.every(
      (item) => item.resized && item.requestId === requestId,
    );
    if (allImagesResized) {
      //Need to prevent the same requestId processing multiple times, need to update the items, the number of retries

      const startExecutionCommand = new StartExecutionCommand({
        stateMachineArn: process.env.STATE_MACHINE_ARN!,
        input: JSON.stringify({ requestId }),
      });
      await sfnClient.send(startExecutionCommand);
      successfulStarts++;
      if (successfulStarts >= 2) {
        break;
      }
    }
  }

  return successfulStarts > 0;
};

export const main: Handler = async (event: Event) => {
  const listExecutionsCommand = new ListExecutionsCommand({
    stateMachineArn: process.env.STATE_MACHINE_ARN!,
    statusFilter: "RUNNING",
  });
  const response = await sfnClient.send(listExecutionsCommand);
  const executions = response.executions;
  if (executions && executions.length > 0) {
    return;
  }
  for (let i = 3; i > 0; i--) {
    const today = new Date();
    const resizedOn = new Date(today.setDate(today.getDate() - i))
      .toISOString()
      .split("T")[0];
    const backfillResult = await backfill(resizedOn);
    if (backfillResult) {
      break;
    }
  }
};
