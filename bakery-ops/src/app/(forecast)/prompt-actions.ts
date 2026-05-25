"use server";

import {
  getPromptSegments,
  upsertPromptSegment,
  deletePromptSegment,
  getPromptTemplates,
  upsertPromptTemplate,
  deletePromptTemplate,
} from "@/modules/data/repositories/forecast.repository";

export {
  getPromptSegments,
  upsertPromptSegment,
  deletePromptSegment,
  getPromptTemplates,
  upsertPromptTemplate,
  deletePromptTemplate,
};
