import { chromium, type Browser, type Page } from "playwright";
import * as cheerio from "cheerio";
import { v4 as uuidv4 } from "uuid";
import type { JobSiteConnector } from "../connector.interface";
import type { Candidate, CrawlResult, ParsedJD } from "../types";
import { fileService } from "../../files/file-service";
import { logger } from "../../../shared/logger";

const DELAY_MIN = parseInt(process.env.CRAWLER_DELAY_MIN_MS || "5000");
const DELAY_MAX = parseInt(process.env.CRAWLER_DELAY_MAX_MS || "10000");

function randomDelay(): Promise<void> {
  const ms = DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN);
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Indeed Malaysia — 雇主端 Resume Search
 * 搜索候选人简历，非职位列表
 * 需要雇主账号（Employer Account）
 */
export class IndeedConnector implements JobSiteConnector {
  readonly siteName = "Indeed";
  readonly siteUrl = "https://my.indeed.com";

  async search(jd: ParsedJD, maxResults: number): Promise<CrawlResult> {
    const candidates: Candidate[] = [];
    const errors: string[] = [];
    let browser: Browser | null = null;

    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      });
      const page = await context.newPage();

      // 必须先登录雇主账号
      const loggedIn = await this.login(page);
      if (!loggedIn) {
        return {
          source: this.siteName,
          candidates: [],
          totalFound: 0,
          crawledAt: new Date().toISOString(),
          errors: ["Indeed: 未配置雇主账号或登录失败，跳过采集"],
        };
      }

      // Resume Search — 搜索候选人简历
      const query = encodeURIComponent(jd.jobTitle);
      const location = encodeURIComponent(jd.location || "Kuala Lumpur");
      const searchUrl = `${this.siteUrl}/resumes?q=${query}&l=${location}`;

      logger.info("Indeed Resume Search: searching candidates", { url: searchUrl });
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);

      // 提取简历链接
      const resumeLinks = await page.$$eval("a[href]", (els) =>
        els
          .map((el) => ({
            href: el.getAttribute("href") || "",
            text: el.textContent?.trim() || "",
          }))
          .filter(
            (l) =>
              l.href.includes("/resume/") ||
              l.href.includes("/r/") ||
              l.href.includes("profile"),
          ),
      );

      // 去重
      const seen = new Set<string>();
      const uniqueResumes: Array<{ href: string; text: string }> = [];
      for (const entry of resumeLinks) {
        if (!seen.has(entry.href) && entry.text.length > 2) {
          seen.add(entry.href);
          uniqueResumes.push(entry);
        }
      }

      logger.info(`Indeed: found ${uniqueResumes.length} candidate resumes`);

      for (const resume of uniqueResumes.slice(0, maxResults)) {
        try {
          const fullUrl = resume.href.startsWith("http")
            ? resume.href
            : `${this.siteUrl}${resume.href}`;

          await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
          await randomDelay();

          const candidate = await this.extractCandidateProfile(page, fullUrl, jd);
          if (candidate) {
            const resumeFile = await this.downloadResume(page, candidate);
            if (resumeFile) {
              candidate.resumeFileId = resumeFile.fileId;
              candidate.resumeFileName = resumeFile.fileName;
            }
            candidates.push(candidate);
          }
        } catch (err) {
          errors.push(`Indeed resume error: ${String(err)}`);
          logger.warn("Indeed: failed to parse resume", { error: String(err) });
        }
      }

      await context.close();
    } catch (err) {
      errors.push(`Indeed search error: ${String(err)}`);
      logger.error("Indeed: search failed", { error: String(err) });
    } finally {
      if (browser) await browser.close();
    }

    return {
      source: this.siteName,
      candidates,
      totalFound: candidates.length,
      crawledAt: new Date().toISOString(),
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  private async extractCandidateProfile(
    page: Page,
    url: string,
    jd: ParsedJD,
  ): Promise<Candidate | null> {
    const html = await page.content();
    const $ = cheerio.load(html);

    const name =
      $('[data-testid="resume-name"], h1').first().text().trim();
    const currentTitle =
      $('[data-testid="resume-headline"], [class*="headline"]')
        .first().text().trim();
    const location =
      $('[data-testid="resume-location"], [class*="location"]')
        .first().text().trim();
    const summary =
      $('[data-testid="resume-summary"], [class*="summary"]')
        .first().text().trim();
    const experience =
      $('[data-testid="resume-work-experience"], [class*="experience"]')
        .first().text().trim();
    const education =
      $('[data-testid="resume-education"], [class*="education"]')
        .first().text().trim();
    const skillsText =
      $('[data-testid="resume-skills"], [class*="skills"]')
        .first().text().trim();
    const email =
      $('a[href^="mailto:"]').first().text().trim();
    const phone =
      $('a[href^="tel:"]').first().text().trim();

    if (!name) return null;

    return {
      candidateId: uuidv4(),
      source: this.siteName,
      sourceUrl: url,
      name,
      phone: phone || undefined,
      email: email || undefined,
      location: location || jd.location,
      currentTitle: currentTitle || undefined,
      experience: experience?.slice(0, 300) || undefined,
      skills: this.parseSkills(skillsText),
      languages: this.extractLanguages(html),
      education: education || undefined,
      summary: summary?.slice(0, 500) || undefined,
    };
  }

  private async login(page: Page): Promise<boolean> {
    const email = process.env.INDEED_EMAIL;
    const password = process.env.INDEED_PASSWORD;
    if (!email || !password) {
      logger.info("Indeed: no employer credentials configured, skipping");
      return false;
    }

    try {
      await page.goto(`${this.siteUrl}/account/login`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(2000);

      // Indeed 登录流程：先输入邮箱，再输入密码
      await page.fill('input[type="email"], input[name="__email"], input[id*="email"]', email);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(3000);

      const passwordField = await page.$('input[type="password"]');
      if (passwordField) {
        await passwordField.fill(password);
        await page.click('button[type="submit"]');
      }

      await page.waitForURL("**/", { timeout: 15000 }).catch(() => {});

      const currentUrl = page.url();
      const isLoggedIn = !currentUrl.includes("login") && !currentUrl.includes("account");
      if (isLoggedIn) {
        logger.info("Indeed: employer login successful");
      } else {
        logger.warn("Indeed: login may have failed", { url: currentUrl });
      }
      return isLoggedIn;
    } catch (err) {
      logger.warn("Indeed: login failed", { error: String(err) });
      return false;
    }
  }

  private async downloadResume(
    page: Page,
    candidate: Candidate,
  ): Promise<{ fileId: string; fileName: string } | null> {
    try {
      const downloadBtn = await page.$(
        'a[href*="resume"], a[href*=".pdf"], ' +
        'button:has-text("Download"), button:has-text("PDF"), ' +
        'a:has-text("Download Resume"), a:has-text("Download PDF")',
      );
      if (!downloadBtn) return null;

      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 10000 }),
        downloadBtn.click(),
      ]);

      const filePath = await download.path();
      if (!filePath) return null;

      const fs = await import("fs");
      const buffer = fs.readFileSync(filePath);
      const fileName =
        download.suggestedFilename() || `resume_${candidate.name.replace(/\s+/g, "_")}.pdf`;
      const file = await fileService.saveFile(buffer, fileName, "application/pdf");

      logger.info("Resume downloaded", { candidate: candidate.name, fileName });
      return { fileId: file.fileId, fileName: file.fileName };
    } catch {
      return null;
    }
  }

  private parseSkills(text: string): string[] {
    if (!text) return [];
    return text
      .split(/[,;，；\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private extractLanguages(html: string): string[] {
    const langs = ["mandarin", "english", "malay", "cantonese", "bahasa", "chinese"];
    const lower = html.toLowerCase();
    return langs.filter((l) => lower.includes(l));
  }
}
