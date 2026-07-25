/**
 * Chinese keyword keys shared by the AI-failure fallbacks in jd-generator.ts and
 * jd-parser.ts. Each file keeps its own values (English job title vs. English
 * search keyword — do NOT merge them); this array only pins the key set so the
 * two mappings can't drift apart. Order matters: first key found in the input wins.
 */
export const JD_TITLE_KEYS = [
  "店员",
  "前场",
  "后厨",
  "师傅",
  "烘焙",
  "面包",
  "蛋糕",
  "收银",
  "服务员",
  "经理",
  "主管",
] as const;

export type JdTitleKey = (typeof JD_TITLE_KEYS)[number];
