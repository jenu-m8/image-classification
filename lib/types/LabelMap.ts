import { NONE_CLASSIFICATION } from "lib/constants";

export const labelsMap = {
  BACKYARD: "Backyard",
  BASEMENT: "Basement",
  BATHROOM: "Bathroom",
  BEDROOM: "Bedroom",
  "DINING-ROOM": "Dining Room",
  FRONT: "Front",
  GARAGE: "Garage",
  KITCHEN: "Kitchen",
  "LIVING-ROOM": "Living Room",
  "AERIAL-VIEW": "Aerial View",
  PLOT: "Plot",
  "FLOOR-PLAN": "Floor Plan",
  POOL: "Pool",
  OFFICE: "Office",
  "WINE-CELLAR": "Wine Cellar",
  HALLWAY: "Hallway",
  STORAGE: "Storage",
  TERRACE: "Terrace",
  "UTILITY-ROOM": "Utility Room",
  UNCLASSIFIED: "Unclassified",
};

export type LabelMap = keyof typeof labelsMap;
export const getLabel = (label: string): string => {
  const labelKey = Object.keys(labelsMap).find((key) => label.includes(key)) as
    | LabelMap
    | undefined;
  return labelKey ? labelsMap[labelKey] : NONE_CLASSIFICATION;
};
