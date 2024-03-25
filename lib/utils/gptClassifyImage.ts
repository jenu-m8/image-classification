import { Image } from "lib/types/Image";
import { labelsMap } from "lib/types/LabelMap";
import OpenAI from "openai";

const openai = new OpenAI();
export const gptClassifyImage = async (image: Image): Promise<any> => {
  try {
    const keys = Object.keys(labelsMap).join(", ");
    const prompt = `Identify the location in this image with a single word: ${keys}.`;

    return await openai.chat.completions.create({
      model: "gpt-4-vision-preview",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt,
            },
            {
              type: "image_url",
              image_url: { url: image.signedUrl as string },
            },
          ],
        },
      ],
    });
  } catch (error) {
    console.error("Error classifying image:", image.id, JSON.stringify(error));
    throw error;
  }
};
