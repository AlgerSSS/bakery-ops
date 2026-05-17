import type { CrawlResult, ParsedJD } from "./types";

/**
 * 招聘网站 Connector 接口
 * 每个招聘网站实现一个 Connector
 */
export interface JobSiteConnector {
  readonly siteName: string;
  readonly siteUrl: string;

  /**
   * 根据 JD 搜索候选人
   * @param jd 解析后的 JD
   * @param maxResults 最大结果数
   */
  search(jd: ParsedJD, maxResults: number): Promise<CrawlResult>;
}
