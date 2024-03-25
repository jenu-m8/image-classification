export const AWS_REGION = "us-east-2";
export const GPT_API_KEY_SSM_PARAMETER_NAME =
  "/image-classification/gpt-api-key";
export const LABELS = [
  "Backyard",
  "Basement",
  "Bathroom",
  "Bedroom",
  "Dining Room",
  "Garage",
  "Kitchen",
  "Living Room",
  "Aerial View",
  "Plot",
  "Floor Plan",
  "Pool",
  "Office",
  "Wine Cellar",
  "Hallway",
  "Terrace",
]; //AWS Rekognition doesn't have Front as a label
export const MAX_DYNAMO_DB_BATCH_SIZE = 25;
export const NONE_CLASSIFICATION = "None";
export const UNCLASSIFIED_CLASSIFICATION = "Unclassified";
export const RESIZED_IMAGES_PREFIX = "resized-images";
export const SOURCE_IMAGES_PREFIX = "source-images";
export const MIN_AWS_REKOGNITION_CONFIDENCE = 95;
export const RESIZED_IMAGE_DIMENSION = 512;

export const MAX_REKOGNITION_BATCH_SIZE = 10;

//Tier 4
export const GPT_RPM = 300;
export const GPT_RPD = 2000;
export const GPT_TPM = 150000;

export const NOTIFICATION_EMAIL = "server.aws@azatiko.com";
