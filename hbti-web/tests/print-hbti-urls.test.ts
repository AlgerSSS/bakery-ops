import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const SCRIPT = resolve("scripts/print-hbti-urls.mjs");

function runScript(baseUrl: string | undefined) {
  const env = { ...process.env };
  delete env.HBTI_LINK_BASE_URL;
  if (baseUrl !== undefined) env.HBTI_LINK_BASE_URL = baseUrl;

  return spawnSync(process.execPath, [SCRIPT], {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
  });
}

describe("print-hbti-urls", () => {
  it("prints only the OTP sign-in and no-coupon demo URLs", () => {
    const result = runScript("https://hbti.example.test");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    // 邀请链接已下线：这个脚本再也不能印出带身份的 /t/<token> 地址。
    expect(result.stdout).not.toContain("/t/");
    expect(result.stdout).toBe(
      [
        "Member sign-in (OTP): https://hbti.example.test/",
        "Demo only (no coupon is issued): https://hbti.example.test/demo",
        "",
      ].join("\n"),
    );
  });

  it("falls back to the production origin when no base URL is configured", () => {
    const result = runScript(undefined);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      [
        "Member sign-in (OTP): https://hbti-test.hotcrush.net/",
        "Demo only (no coupon is issued): https://hbti-test.hotcrush.net/demo",
        "",
      ].join("\n"),
    );
  });

  it("refuses to print a plaintext HTTP origin", () => {
    const result = runScript("http://hbti.example.test");

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Unable to print HBTI URLs. Check HBTI_LINK_BASE_URL.\n",
    );
  });
});
