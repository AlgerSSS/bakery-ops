import { describe, it, expect, vi, afterEach } from "vitest";

import { openrouterProvider } from "@/modules/shared/ai/openrouter.provider";
import { parseResumeFile } from "@/modules/domain/resume/resume-parser";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openrouterFetch timeout", () => {
  it("passes an AbortSignal timeout to fetch so hung requests abort", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ index: 0, embedding: [0.1] }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await openrouterProvider.getEmbedding("hello");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal.aborted).toBe(false);
  });
});

describe("resume-parser OCR fetch", () => {
  it("returns an empty resume when the OCR request fails (non-ok response)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseResumeFile(Buffer.from("fake-image"), "image/png");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ work_experience: [], project_experience: [], certifications: [] });
  });
});
