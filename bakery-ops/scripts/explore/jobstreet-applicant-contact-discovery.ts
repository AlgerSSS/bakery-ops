/**
 * JobStreet 申请者联系方式 Discovery 脚本 (READ-ONLY)
 *
 * 目的: 确认能否看到 'service crew' 岗位的申请者，以及申请者数据中
 *       是否暴露 phone/email/contact，用于评估每日 12:00 自动 WhatsApp 功能。
 *
 * 用法: npx tsx scripts/explore/jobstreet-applicant-contact-discovery.ts
 *
 * 绝不: 发消息 / shortlist / reject / apply / post。仅导航 + 读取 + dump。
 * 所有 PII 在打印前都会被 mask。
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getCookieFile,
  getStorageFile,
  hasValidSession,
} from "../../src/modules/domain/recruitment/connectors/jobstreet-login";

const SITE_URL = "https://my.employer.seek.com";
const OUT_DIR = path.join(os.tmpdir(), "jobstreet-discovery");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ── PII 脱敏 ──
function maskPhone(s: string): string {
  // 60123456789 -> 60xx****6789
  const digits = s.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  return `${digits.slice(0, 2)}xx****${digits.slice(-4)}`;
}
function maskEmail(s: string): string {
  const m = s.match(/^([^@]+)@(.+)$/);
  if (!m) return "***";
  const u = m[1];
  return `${u.slice(0, 1)}***@${m[2].replace(/^[^.]+/, "***")}`;
}
function maskString(s: string): string {
  if (s.length <= 2) return "**";
  return `${s.slice(0, 1)}***${s.slice(-1)}`;
}

// 递归收集对象里所有出现过的 key（用于"有哪些字段可用"判断），不输出 value
function collectKeys(obj: unknown, out: Set<string>, depth = 0, prefix = ""): void {
  if (depth > 8 || !obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const el of obj.slice(0, 3)) collectKeys(el, out, depth + 1, prefix);
    return;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const full = prefix ? `${prefix}.${k}` : k;
    out.add(full);
    collectKeys(v, out, depth + 1, full);
  }
}

// 检测一个 JSON 里是否含 phone/email 模式的 value（masked 输出）
const PHONE_RE = /(?:\+?6?0)1[0-9][-\s]?\d{3,4}[-\s]?\d{3,4}|\+?\d{8,15}/;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
function scanForContact(obj: unknown, hits: { phones: string[]; emails: string[]; paths: string[] }, depth = 0, pathStr = ""): void {
  if (depth > 10 || obj == null) return;
  if (typeof obj === "string") {
    const pm = obj.match(PHONE_RE);
    if (pm && pm[0].replace(/\D/g, "").length >= 8) {
      hits.phones.push(maskPhone(pm[0]));
      hits.paths.push(`${pathStr} (phone)`);
    }
    const em = obj.match(EMAIL_RE);
    if (em) {
      hits.emails.push(maskEmail(em[0]));
      hits.paths.push(`${pathStr} (email)`);
    }
    return;
  }
  if (typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach((el, i) => scanForContact(el, hits, depth + 1, `${pathStr}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    scanForContact(v, hits, depth + 1, pathStr ? `${pathStr}.${k}` : k);
  }
}

interface Intercept {
  url: string;
  method: string;
  status: number;
  operationName?: string;
  responseKeys: string[];
}

async function buildContext(): Promise<{ context: BrowserContext; close: () => Promise<void> }> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    acceptDownloads: true,
  });
  const cookieFile = getCookieFile();
  if (fs.existsSync(cookieFile)) {
    await context.addCookies(JSON.parse(fs.readFileSync(cookieFile, "utf-8")));
  }
  const storageFile = getStorageFile();
  if (fs.existsSync(storageFile)) {
    const storage = JSON.parse(fs.readFileSync(storageFile, "utf-8"));
    await context.addInitScript((data: Record<string, string>) => {
      for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
    }, storage);
  }
  return { context, close: () => browser.close() };
}

// 把每个 graphql/api 响应原始 JSON 落到磁盘（临时目录），并返回元信息
function attachInterceptor(page: Page, label: string, intercepts: Intercept[], rawStore: { url: string; json: unknown }[]) {
  page.on("response", async (response) => {
    const url = response.url();
    if (!(url.includes("graphql") || url.includes("/api/"))) return;
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return;
    }
    const req = response.request();
    let opName: string | undefined;
    try {
      const pd = req.postData();
      if (pd) {
        const parsed = JSON.parse(pd);
        opName = (Array.isArray(parsed) ? parsed[0]?.operationName : parsed?.operationName) as string | undefined;
      }
    } catch { /* ignore */ }
    intercepts.push({
      url: url.length > 120 ? url.slice(0, 120) + "..." : url,
      method: req.method(),
      status: response.status(),
      operationName: opName,
      responseKeys: typeof json === "object" && json ? Object.keys(json as object) : [],
    });
    rawStore.push({ url, json });
  });
  void label;
}

async function main() {
  const verdict: Record<string, unknown> = {};

  // (a) session 是否存在
  if (!hasValidSession()) {
    console.log(JSON.stringify({ verdict: "NO_SESSION_FILE", detail: "cookies.json missing — owner must log in" }));
    return;
  }
  console.log("=== Session file present (cookies.json). hasValidSession()=true (file-exists check only) ===");

  const { context, close } = await buildContext();
  try {
    const page = await context.newPage();
    const intercepts: Intercept[] = [];
    const rawStore: { url: string; json: unknown }[] = [];
    attachInterceptor(page, "global", intercepts, rawStore);

    // ── Step 0: 验证 cookie 是否仍然有效（是否被重定向到 login）──
    console.log("\n=== Step 0: verify session (navigate home) ===");
    await page.goto(`${SITE_URL}/`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(6000);
    const homeUrl = page.url();
    const loggedOut = /login|oauth|authenticate|signin/i.test(homeUrl);
    console.log(`landed URL: ${homeUrl.slice(0, 100)}`);
    console.log(`session valid (not redirected to login)? ${!loggedOut}`);
    if (loggedOut) {
      verdict.sessionValid = false;
      console.log("\n!!! SESSION EXPIRED — owner must re-login. Stopping (no interactive/captcha login attempted). !!!");
      console.log("\nFINAL_VERDICT=" + JSON.stringify(verdict));
      return;
    }
    verdict.sessionValid = true;

    // ── Step 1: active jobs ──
    console.log("\n=== Step 1: navigate /job/managejob, list active jobs ===");
    await page.goto(`${SITE_URL}/job/managejob`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(8000);
    console.log(`managejob URL: ${page.url().slice(0, 100)}`);

    fs.writeFileSync(path.join(OUT_DIR, "managejob.html"), await page.content());

    // 从拦截到的 raw 响应里找 jobs 数组
    const jobsRaw = rawStore.slice();
    const allJobs: { jobId: string; title: string; applicantCount: number }[] = [];
    function findJobs(obj: unknown, depth = 0): void {
      if (depth > 8 || !obj || typeof obj !== "object") return;
      const rec = obj as Record<string, unknown>;
      for (const key of Object.keys(rec)) {
        const val = rec[key];
        if (Array.isArray(val) && val.length && val[0] && typeof val[0] === "object") {
          for (const it of val) {
            const j = it as Record<string, unknown>;
            const node = (j.node ?? j) as Record<string, unknown>;
            const title = node.title || node.jobTitle || node.name;
            const id = node.id || node.jobId || node.jobAdId || node.advertisementId;
            if (title && id) {
              const ac = node.applicantCount ?? node.applications ?? node.candidateCount ?? node.newApplicants ?? node.totalApplications;
              allJobs.push({ jobId: String(id), title: String(title), applicantCount: Number(ac ?? 0) });
            }
          }
        }
        findJobs(val, depth + 1);
      }
    }
    for (const r of jobsRaw) findJobs(r.json);

    // 去重
    const seen = new Set<string>();
    const jobs = allJobs.filter((j) => {
      const k = j.jobId + "|" + j.title;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    console.log(`\nGraphQL/API intercepts so far: ${intercepts.length}`);
    console.log("operationNames seen: " + JSON.stringify([...new Set(intercepts.map((i) => i.operationName).filter(Boolean))]));
    console.log(`\nActive jobs extracted from network: ${jobs.length}`);
    for (const j of jobs) console.log(`  - [${j.jobId}] "${j.title}"  applicants=${j.applicantCount}`);

    // DOM fallback: dump any title-like text
    if (jobs.length === 0) {
      console.log("\n(no jobs from network — dumping DOM candidate titles)");
      const domTitles = await page.$$eval(
        "a[href*='job'], [class*='title'], [class*='Title'], h2, h3",
        (els) => els.map((e) => (e.textContent || "").trim()).filter((t) => t.length > 2 && t.length < 80).slice(0, 40),
      ).catch(() => []);
      console.log(JSON.stringify(domTitles, null, 2));
    }

    // 定位 service crew
    const serviceCrew = jobs.find((j) => /service\s*crew/i.test(j.title));
    verdict.activeJobsCount = jobs.length;
    verdict.allJobTitles = jobs.map((j) => ({ jobId: j.jobId, title: j.title, applicants: j.applicantCount }));
    if (serviceCrew) {
      console.log(`\n>>> MATCH: service crew job = [${serviceCrew.jobId}] "${serviceCrew.title}" applicants=${serviceCrew.applicantCount}`);
      verdict.serviceCrew = { jobId: serviceCrew.jobId, title: serviceCrew.title, applicantCount: serviceCrew.applicantCount };
    } else {
      console.log("\n>>> NO exact 'service crew' match. Closest titles listed above.");
      verdict.serviceCrew = null;
    }

    // 保存 raw network dump (Step1)
    fs.writeFileSync(
      path.join(OUT_DIR, "managejob-network.json"),
      JSON.stringify(rawStore.map((r) => ({ url: r.url, json: r.json })), null, 2),
    );

    // ── Step 2: applicants for service crew (or first job with applicants) ──
    const target = serviceCrew || jobs.find((j) => j.applicantCount > 0) || jobs[0];
    if (!target) {
      console.log("\nNo job to inspect applicants for. Stopping.");
      verdict.contactObtainable = "no";
      console.log("\nFINAL_VERDICT=" + JSON.stringify(verdict));
      return;
    }
    console.log(`\n=== Step 2: applicants page for [${target.jobId}] "${target.title}" ===`);

    rawStore.length = 0; // reset to capture only applicant-page traffic
    intercepts.length = 0;

    const candidateUrls = [
      `${SITE_URL}/manage-applications/${target.jobId}`,
      `${SITE_URL}/job/${target.jobId}/applications`,
      `${SITE_URL}/job/managejob/${target.jobId}/applications`,
      `${SITE_URL}/manage-candidates/${target.jobId}`,
    ];
    let loadedUrl = "";
    for (const u of candidateUrls) {
      try {
        await page.goto(u, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(4000);
        const cur = page.url();
        if (!/error|404|not-found/i.test(cur) && !/login|oauth|authenticate/i.test(cur)) {
          loadedUrl = cur;
          console.log(`loaded applicants via: ${u}\n  -> ${cur.slice(0, 110)}`);
          break;
        }
      } catch { /* next */ }
    }
    if (!loadedUrl) {
      console.log("Could not load any applicants URL pattern. Dumping last DOM + network for inspection.");
    }
    await page.waitForTimeout(3000);
    fs.writeFileSync(path.join(OUT_DIR, "applicants.html"), await page.content());

    console.log(`\nApplicant-page GraphQL/API intercepts: ${intercepts.length}`);
    for (const i of intercepts) {
      console.log(`  [${i.status}] ${i.method} op=${i.operationName || "?"} keys=${JSON.stringify(i.responseKeys)}`);
    }

    // 收集申请者数组里的所有字段 key
    const applicantKeys = new Set<string>();
    const applicantArrays: unknown[] = [];
    function findApplicants(obj: unknown, depth = 0): void {
      if (depth > 8 || !obj || typeof obj !== "object") return;
      const rec = obj as Record<string, unknown>;
      for (const key of Object.keys(rec)) {
        if (/applicant|application|candidate|profile|prospect/i.test(key)) {
          const val = rec[key];
          if (Array.isArray(val) && val.length && typeof val[0] === "object") {
            for (const it of val) {
              const node = ((it as Record<string, unknown>).node ?? it) as unknown;
              applicantArrays.push(node);
              collectKeys(node, applicantKeys);
            }
          }
        }
        findApplicants(rec[key], depth + 1);
      }
    }
    for (const r of rawStore) findApplicants(r.json);

    console.log(`\nApplicant objects found in network: ${applicantArrays.length}`);
    console.log("=== EXACT FIELD KEYS available per applicant (from live response) ===");
    console.log(JSON.stringify([...applicantKeys].sort(), null, 2));

    // 扫描 list 响应里有没有 phone/email
    const listHits = { phones: [] as string[], emails: [] as string[], paths: [] as string[] };
    for (const a of applicantArrays) scanForContact(a, listHits);
    console.log("\n=== Contact scan on LIST/applicant objects (masked) ===");
    console.log(`phones found: ${listHits.phones.length} ${JSON.stringify(listHits.phones.slice(0, 5))}`);
    console.log(`emails found: ${listHits.emails.length} ${JSON.stringify(listHits.emails.slice(0, 5))}`);
    console.log(`paths: ${JSON.stringify([...new Set(listHits.paths)].slice(0, 10))}`);

    fs.writeFileSync(
      path.join(OUT_DIR, "applicants-network.json"),
      JSON.stringify(rawStore.map((r) => ({ url: r.url, json: r.json })), null, 2),
    );

    // DOM card dump (masked-ish: just structure + presence of tel:/mailto:)
    const telLinks = await page.$$eval("a[href^='tel:']", (els) => els.length).catch(() => 0);
    const mailLinks = await page.$$eval("a[href^='mailto:']", (els) => els.length).catch(() => 0);
    console.log(`\nDOM contact affordances on list page: tel: links=${telLinks}, mailto: links=${mailLinks}`);

    // ── Step 3: open ONE applicant detail page ──
    console.log("\n=== Step 3: open ONE applicant detail page (read-only) ===");
    rawStore.length = 0;
    intercepts.length = 0;

    // 找一个申请者链接
    const detailHref = await page.$$eval(
      "a[href*='candidate'], a[href*='applicant'], a[href*='profile'], a[href*='application']",
      (els) => {
        const hrefs = els.map((e) => e.getAttribute("href") || "").filter((h) => h && !h.includes("javascript"));
        return hrefs[0] || "";
      },
    ).catch(() => "");

    let detailKeys = new Set<string>();
    const detailHits = { phones: [] as string[], emails: [] as string[], paths: [] as string[] };
    if (detailHref) {
      const detailUrl = detailHref.startsWith("http") ? detailHref : `${SITE_URL}${detailHref}`;
      console.log(`opening detail: ${detailUrl.slice(0, 110)}`);
      await page.goto(detailUrl, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(5000);
      fs.writeFileSync(path.join(OUT_DIR, "applicant-detail.html"), await page.content());

      for (const r of rawStore) {
        collectKeys(r.json, detailKeys);
        scanForContact(r.json, detailHits);
      }
      const dTel = await page.$$eval("a[href^='tel:']", (els) => els.length).catch(() => 0);
      const dMail = await page.$$eval("a[href^='mailto:']", (els) => els.length).catch(() => 0);
      console.log(`detail-page intercepts: ${intercepts.length}, tel: links=${dTel}, mailto: links=${dMail}`);
      console.log("detail-page contact scan (masked): phones=" + JSON.stringify(detailHits.phones.slice(0, 3)) + " emails=" + JSON.stringify(detailHits.emails.slice(0, 3)));
      console.log("detail-page contact paths: " + JSON.stringify([...new Set(detailHits.paths)].slice(0, 12)));
      fs.writeFileSync(
        path.join(OUT_DIR, "applicant-detail-network.json"),
        JSON.stringify(rawStore.map((r) => ({ url: r.url, json: r.json })), null, 2),
      );
    } else {
      console.log("No applicant detail link found in DOM — cannot open detail page.");
    }

    // ── verdict assembly ──
    const phoneOnList = listHits.phones.length > 0;
    const phoneOnDetail = detailHits.phones.length > 0 || (await page.$$eval("a[href^='tel:']", (els) => els.length).catch(() => 0)) > 0;
    const emailOnList = listHits.emails.length > 0;
    const emailOnDetail = detailHits.emails.length > 0;

    verdict.applicantFieldKeys = [...applicantKeys].sort();
    verdict.detailFieldKeys = [...detailKeys].sort();
    verdict.phoneOnList = phoneOnList;
    verdict.phoneOnDetail = phoneOnDetail;
    verdict.emailOnList = emailOnList;
    verdict.emailOnDetail = emailOnDetail;
    verdict.contactObtainable =
      phoneOnList ? "yes-on-list" :
      phoneOnDetail ? "yes-on-detail-page" :
      "needs-resume-or-no";

    console.log("\n\n================ FINAL_VERDICT ================");
    console.log(JSON.stringify(verdict, null, 2));
    console.log(`\nRaw dumps saved under: ${OUT_DIR}`);
  } finally {
    await close();
  }
}

main().catch((e) => {
  console.error("DISCOVERY_ERROR:", String(e).slice(0, 300));
  process.exit(1);
});
