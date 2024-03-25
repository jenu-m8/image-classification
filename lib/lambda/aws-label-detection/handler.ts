import { Handler } from "aws-lambda";
import {
  MAX_REKOGNITION_BATCH_SIZE,
  NONE_CLASSIFICATION,
  UNCLASSIFIED_CLASSIFICATION,
} from "lib/constants";
import { DynamoDBImage } from "lib/types/DynamoDBImage";
import { awsClassifyImage } from "lib/utils/awsClassifyImage";
import { getAWSRekognitionPrice } from "lib/utils/getAWSRekognitionPrice";
import { queryDynamoDB } from "lib/utils/queryDynamoDB";
import { writeToDynamoDB } from "lib/utils/writeToDynamoDB";

type Event = {
  requestId: string;
};

const processBatch = async (images: DynamoDBImage[]) => {
  const promises = images.map(async (image) => {
    return await awsClassifyImage(image);
  });

  return await Promise.all(promises);
};

const processInBatches = async (allImages: DynamoDBImage[]) => {
  const results = [];
  for (let i = 0; i < allImages.length; i += MAX_REKOGNITION_BATCH_SIZE) {
    const batchedImages = allImages.slice(i, i + MAX_REKOGNITION_BATCH_SIZE);
    const batchResults = await processBatch(batchedImages);
    results.push(...batchResults);
    await new Promise((r) => setTimeout(r, 1000));
  }
  return results;
};

export const main: Handler = async (event: Event) => {
  const response = await queryDynamoDB(event.requestId);
  if (!response) {
    return {
      message: "No images to classify",
      ignore: true,
    };
  }
  const hasNonResizedImages = response.some((item) => !item.resized);
  if (hasNonResizedImages) {
    return {
      message: "There are non-resized images",
      ignore: true,
    };
  }

  const imagesToClassify = response.filter(
    (item) => item.classification === NONE_CLASSIFICATION && !item.tries,
  );

  const labelDetectionResults = await processInBatches(imagesToClassify);

  const triedImages = response.filter(
    (item) =>
      item.classification === NONE_CLASSIFICATION &&
      item.tries &&
      item.tries < 2,
  );

  const costOfEachLabelDetection = getAWSRekognitionPrice();
  const images = labelDetectionResults.map((result) => {
    const res = {
      id: result.imageId as string,
      type: result.imageType as string,
      classification: NONE_CLASSIFICATION,
      confidence: 0,
      resized: result.resized,
      requestId: result.requestId as string,
      cost: costOfEachLabelDetection,
      service: "AWSRekognition",
      processingTime: result.processingTime,
      tries: 1,
    };
    if (
      result.classification !== NONE_CLASSIFICATION ||
      result.classification !== UNCLASSIFIED_CLASSIFICATION
    ) {
      res.classification = result.classification;
      res.confidence = result.confidence as number;
      res.cost = costOfEachLabelDetection;
    }
    return res;
  });

  await writeToDynamoDB(images, event.requestId);

  const unclassifiedImages = labelDetectionResults.filter(
    (result) => result.classification === NONE_CLASSIFICATION,
  );
  const allUnclassifiedImagesLength =
    unclassifiedImages.length + triedImages.length;

  return {
    unclassifiedImagesCount: allUnclassifiedImagesLength,
    requestId: event.requestId,
  };
};
