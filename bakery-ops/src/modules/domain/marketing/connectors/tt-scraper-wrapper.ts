/**
 * tiktok-scraper wrapper — 绕过主 index.js 的循环 require 死锁
 *
 * 原包 require('tiktok-scraper') 在 Node 24 上挂死，
 * 因为 index.js → core → TikTok.js → require("../core") 循环引用。
 * 正确加载顺序：types → helpers → core → entry
 */

// 必须按这个顺序加载，否则循环引用死锁
require("tiktok-scraper/build/types");
require("tiktok-scraper/build/helpers");
const core = require("tiktok-scraper/build/core");
require("tiktok-scraper/build/entry");

const TikTokScraper = core.TikTokScraper as new (...args: any[]) => any;

// 暴露的 Promise-based API
export function hashtag(id: string, options?: Record<string, unknown>): Promise<any> {
  const instance = new TikTokScraper();
  return instance.scrape({ type: "hashtag", id, ...options }, options);
}

export function getUserProfileInfo(username: string, options?: Record<string, unknown>): Promise<any> {
  const instance = new TikTokScraper();
  return instance.getUserProfileInfo(username, options);
}

export function getHashtagInfo(name: string, options?: Record<string, unknown>): Promise<any> {
  const instance = new TikTokScraper();
  return instance.getHashtagInfo(name, options);
}

export default { hashtag, getUserProfileInfo, getHashtagInfo };
