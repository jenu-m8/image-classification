import { QueryCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { Handler } from "aws-lambda";
import { dynamoDBClient } from "lib/clients";
import { GPT_RPD, GPT_RPM } from "lib/constants";

type Event = {
  Payload: {
    requestId: string;
    retryCount?: number;
    unclassifiedImagesCount: number;
  };
};

async function checkAndUpdateLimit(
  rateLimitKey: string,
  count: number,
  limit: number,
  expireInSeconds: number,
): Promise<number> {
  let usedRateLimit = 0;

  const queryCommand = new QueryCommand({
    TableName: process.env.RATE_LIMIT_TABLE_NAME,
    KeyConditionExpression: "pk = :pk",
    ExpressionAttributeValues: {
      ":pk": { S: rateLimitKey },
    },
    ConsistentRead: true,
  });

  const queryResult = await dynamoDBClient.send(queryCommand);
  const items = queryResult.Items as Array<{ usedRateLimit: { N: string } }>;

  if (items && items.length > 0) {
    usedRateLimit = parseInt(items[0].usedRateLimit.N, 10);
  }

  let remainingRateLimit = limit - usedRateLimit;

  if (remainingRateLimit >= count) {
    const updateCommand = new UpdateItemCommand({
      TableName: process.env.RATE_LIMIT_TABLE_NAME,
      Key: {
        pk: { S: rateLimitKey },
      },
      UpdateExpression: "ADD usedRateLimit :count",
      ExpressionAttributeValues: {
        ":count": { N: count.toString() },
      },
    });
    await dynamoDBClient.send(updateCommand);
    return remainingRateLimit - count;
  } else {
    return -1; // Indicate that the limit has been exceeded
  }
}

export const main: Handler = async (event: Event) => {
  const now = new Date();

  // For minute limit
  now.setSeconds(0, 0);
  const currentMinuteTimestamp = Math.floor(now.getTime() / 1000);
  const minuteRateLimitKey = `minute_${currentMinuteTimestamp}`;

  // For day limit
  now.setHours(0, 0, 0, 0); // Reset hours, minutes, seconds, and milliseconds to get the start of the day
  const currentDayTimestamp = Math.floor(now.getTime() / 1000);
  const dayRateLimitKey = `day_${currentDayTimestamp}`;

  // Check minute limit
  let remainingMinuteLimit = await checkAndUpdateLimit(
    minuteRateLimitKey,
    event.Payload.unclassifiedImagesCount,
    GPT_RPM,
    60,
  );

  // Check day limit
  let remainingDayLimit = await checkAndUpdateLimit(
    dayRateLimitKey,
    event.Payload.unclassifiedImagesCount,
    GPT_RPD,
    86400,
  );

  let waitDuration = 0;

  if (remainingMinuteLimit < 0 || remainingDayLimit < 0) {
    waitDuration = remainingDayLimit < 0 ? 86400 : 60;
    remainingMinuteLimit = 0;
  }

  const retryCount = event.Payload.retryCount || 0;
  if (retryCount >= 3) {
    remainingMinuteLimit = 1;
  }

  return {
    requestId: event.Payload.requestId,
    remainingRateLimit: remainingMinuteLimit,
    retryCount: retryCount + 1,
    waitDuration,
    unclassifiedImagesCount: event.Payload.unclassifiedImagesCount,
  };

  // let usedRateLimit = 0;
  // const queryCommand = new QueryCommand({
  //   TableName: process.env.RATE_LIMIT_TABLE_NAME,
  //   KeyConditionExpression: "pk = :pk",
  //   ExpressionAttributeValues: {
  //     ":pk": { N: rateLimitKey },
  //   },
  //   ConsistentRead: true,
  // });
  // let waitDuration = 0;
  // const queryResult = await dynamoDBClient.send(queryCommand);
  // const items = queryResult.Items as { usedRateLimit: { N: string } }[];
  // if (items && items.length > 0) {
  //   usedRateLimit = items[0].usedRateLimit.N
  //     ? parseInt(items[0].usedRateLimit.N)
  //     : 0;
  // }
  // let remainingRateLimit = GPT_RPM - usedRateLimit;
  // if (remainingRateLimit >= event.Payload.unclassifiedImagesCount) {
  //   const updateRateLimitCommand = new UpdateItemCommand({
  //     TableName: process.env.RATE_LIMIT_TABLE_NAME,
  //     Key: {
  //       pk: { N: rateLimitKey },
  //     },
  //     UpdateExpression: "ADD usedRateLimit :limit SET expires_at = :expires_at",
  //     ExpressionAttributeValues: {
  //       ":limit": { N: `${event.Payload.unclassifiedImagesCount}` },
  //       ":expires_at": { N: `${currentMinute + 300}` },
  //     },
  //     ReturnValues: "ALL_NEW",
  //   });
  //   await dynamoDBClient.send(updateRateLimitCommand);
  // } else {
  //   waitDuration = 60;
  //   remainingRateLimit = 0;
  // }
  // const retryCount = event.Payload.retryCount || 0;
  // if (retryCount >= 3) {
  //   remainingRateLimit = 1;
  // }
  // return {
  //   requestId: event.Payload.requestId,
  //   remainingRateLimit: remainingRateLimit,
  //   retryCount: retryCount + 1,
  //   waitDuration: waitDuration,
  //   unclassifiedImagesCount: event.Payload.unclassifiedImagesCount,
  // };
};
