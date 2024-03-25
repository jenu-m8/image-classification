import { DetectLabelsCommand } from "@aws-sdk/client-rekognition";
import { rekognitionClient } from "lib/clients";
import {
  LABELS,
  MIN_AWS_REKOGNITION_CONFIDENCE,
  NONE_CLASSIFICATION,
  RESIZED_IMAGES_PREFIX,
} from "lib/constants";
import { DynamoDBImage } from "lib/types/DynamoDBImage";

export const awsClassifyImage = async (image: DynamoDBImage): Promise<any> => {
  const s3Key = `${RESIZED_IMAGES_PREFIX}/${image.requestId}/${image.imageId}.${image.imageType}`;
  const detectLabelsCommand = {
    Image: { S3Object: { Bucket: process.env.BUCKET_NAME, Name: s3Key } },
    MaxLabels: 10,
    MinConfidence: MIN_AWS_REKOGNITION_CONFIDENCE,
  };
  const startTimestamp = Date.now();
  const detectLabelsResult = await rekognitionClient.send(
    new DetectLabelsCommand(detectLabelsCommand),
  );
  const endTimestamp = Date.now();
  const detectedLabels = detectLabelsResult.Labels?.map((label) =>
    label.Name &&
    label.Confidence &&
    label.Confidence > MIN_AWS_REKOGNITION_CONFIDENCE
      ? label.Name
      : null,
  );
  const intersection =
    detectedLabels?.filter((label) => LABELS.includes(label ?? "")) || [];
  const classification =
    intersection?.length > 0 ? intersection[0] : NONE_CLASSIFICATION;
  const confidence = Math.round(
    detectLabelsResult.Labels?.find((label) => label.Name === classification)
      ?.Confidence || 0,
  );

  return {
    requestId: image.requestId,
    imageId: image.imageId,
    classification,
    confidence,
    resized: true,
    imageType: image.imageType,
    processingTime: endTimestamp - startTimestamp,
  };
};
