import { Handler } from "aws-lambda";
import {
  MIN_AWS_REKOGNITION_CONFIDENCE,
  NONE_CLASSIFICATION,
  RESIZED_IMAGES_PREFIX,
  UNCLASSIFIED_CLASSIFICATION,
} from "lib/constants";
import { Image } from "lib/types/Image";
import { getLabel } from "lib/types/LabelMap";
import { getAWSRekognitionPrice } from "lib/utils/getAWSRekognitionPrice";
import { getPreSignedUrl } from "lib/utils/getPreSignedUrl";
import { gptClassifyImage } from "lib/utils/gptClassifyImage";
import { queryDynamoDB } from "lib/utils/queryDynamoDB";
import { writeToDynamoDB } from "lib/utils/writeToDynamoDB";

type Event = {
  Payload: {
    requestId: string;
    unclassifiedImages: {
      imageId: string;
      imageType: string;
      requestId: string;
    }[];
    gptRetryCount: number;
  };
};

export const main: Handler = async (event: Event) => {
  let gptRetryCount = event.Payload?.gptRetryCount || 0;
  const response = await queryDynamoDB(event.Payload.requestId);
  const unclassifiedImages = response
    .filter(
      (item) =>
        item.classification === NONE_CLASSIFICATION &&
        (!item.tries || item.tries < 2),
    )
    .map((item) => ({
      id: item.imageId,
      type: item.imageType,
      requestId: item.requestId,
      resized: true,
      tries: item.tries,
    })) as Image[];

  let rateLimitError = false;

  const costOfEachLabelDetection = getAWSRekognitionPrice();

  const processedImages: Image[] = [];
  while (unclassifiedImages.length > 0) {
    const startTimestamp = Date.now();
    const image = unclassifiedImages.pop();
    if (!image) {
      continue;
    }

    image.signedUrl = await getPreSignedUrl(
      image,
      `${RESIZED_IMAGES_PREFIX}/${image.requestId}`,
    );
    try {
      const classificationResponse = await gptClassifyImage(image);
      const endTimestamp = Date.now();
      image.processingTime = endTimestamp - startTimestamp;
      image.classification = getLabel(
        classificationResponse.choices[0].message.content,
      );
      if (image.classification === NONE_CLASSIFICATION) {
        image.classification = UNCLASSIFIED_CLASSIFICATION;
      }
      image.confidence = MIN_AWS_REKOGNITION_CONFIDENCE;
      image.cost =
        (classificationResponse.usage.total_tokens * 0.001) / 100 +
        costOfEachLabelDetection;
      image.service = "GPTVision";
      image.tries = image.tries ? image.tries + 1 : 2;
      processedImages.push(image);
    } catch (error) {
      const apiError = error as { message: string; headers: any };
      processedImages.push(image);
      const remainingRequests = apiError.headers
        ? parseInt(apiError.headers["x-ratelimit-remaining-requests"] || "0")
        : 0;
      rateLimitError = true;
      delete image.signedUrl;
      break;
    }
  }

  if (unclassifiedImages.length > 0) {
    processedImages.push(...unclassifiedImages);
  }

  const imagesToWrite = processedImages.filter(
    (image) =>
      image.classification && image.classification !== NONE_CLASSIFICATION,
  );
  await writeToDynamoDB(imagesToWrite, event.Payload.requestId);

  const imagesToRetry = processedImages.filter(
    (image) =>
      !image.classification || image.classification === NONE_CLASSIFICATION,
  );

  if (gptRetryCount > 2) {
    rateLimitError = false;
  }

  return {
    requestId: event.Payload.requestId,
    rateLimitError: rateLimitError,
  };
};
