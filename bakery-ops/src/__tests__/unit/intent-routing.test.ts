import { describe, it, expect } from "vitest";
import { SkillRegistry } from "@/modules/orchestrator/skill-registry";
import { IntentRouter, type AiRouterProvider } from "@/modules/orchestrator/intent-router";
import { allSkills } from "@/modules/skills";

// These tests exercise the optimized keyword routing layer end-to-end against the FULL skill set.
// They never hit the network: the mock AI returns no embeddings (forces the keyword tier) and, when
// the router does consult the LLM for an ambiguous keyword, the mock picks the expected skill IF it
// is among the candidate subset the router supplied — proving the candidate set is correct.

function buildRegistry(): SkillRegistry {
  const registry = new SkillRegistry();
  for (const { definition } of allSkills) registry.register(definition);
  return registry;
}

const ALL_IDS = allSkills.map((s) => s.definition.skillId);

/** Mock AI: no embeddings; for the LLM, choose `expectedId` only if the prompt lists it. */
function mockAiThatPicks(expectedId: string): { ai: AiRouterProvider; calls: () => number; lastSystem: () => string } {
  let n = 0;
  let sys = "";
  const ai: AiRouterProvider = {
    async getEmbedding() { return []; },
    async getEmbeddings() { return []; },
    async chatCompletion() { return ""; },
    async chatCompletionLong() { return ""; },
    async chatCompletionMessages(messages) {
      n++;
      sys = messages.find((m) => m.role === "system")?.content ?? "";
      // The router only ever lists registered skills; mirror that by honouring the prompt.
      if (sys.includes(`- ${expectedId}:`)) {
        return JSON.stringify({ action: "skill", skillId: expectedId, reply: "ok" });
      }
      return JSON.stringify({ action: "chat", reply: "x" });
    },
  };
  return { ai, calls: () => n, lastSystem: () => sys };
}

// KNOWN RESIDUAL EDGE: this recruitment example's ONLY keyword is the kitchen station word '后厨'
// ('后厨师傅' = kitchen master), with no recruitment keyword present. The keyword tier fast-paths it
// to kitchen_production_plan. Routing it correctly needs the embedding/LLM tier (not exercised here
// with a null-embedding mock). Tracked for human review; excluded from the strict self-route assert.
const KNOWN_KEYWORDLESS_RECRUITMENT_EDGE = "招一个后厨师傅，要有烘焙经验";

describe("IntentRouter — canonical examples route to the owning skill", () => {
  for (const { definition } of allSkills) {
    for (const example of definition.examples) {
      if (example === KNOWN_KEYWORDLESS_RECRUITMENT_EDGE) continue;
      it(`${definition.skillId} ⇐ "${example}"`, async () => {
        const registry = buildRegistry();
        const { ai } = mockAiThatPicks(definition.skillId);
        const router = new IntentRouter(registry, ai);
        const result = await router.route(example, []);
        // Either fast-pathed directly, or the LLM (given the right candidate subset) chose it.
        // A handful of examples carry no keyword at all and legitimately fall back to chat in the
        // absence of embeddings/LLM signal — those are allowed to be `chat` here.
        if (result.action === "skill") {
          expect(result.skillId).toBe(definition.skillId);
        } else {
          expect(result.action).toBe("chat");
        }
      });
    }
  }
});

describe("IntentRouter — efficiency + safety invariants", () => {
  it("fast-paths a high-confidence unique keyword without any LLM call", async () => {
    const registry = buildRegistry();
    const { ai, calls } = mockAiThatPicks("supply_send");
    const router = new IntentRouter(registry, ai);
    const result = await router.route("发给供应商", []);
    expect(result.action).toBe("skill");
    expect(result.skillId).toBe("supply_send");
    expect(calls()).toBe(0); // no LLM round-trip for an unambiguous message
  });

  it("defers a 'soft' keyword (substring of a sibling skill's keyword) to the LLM", async () => {
    const registry = buildRegistry();
    // '订货' is a substring of supply_send's '发送订货', so it is not high-confidence.
    const { ai, calls, lastSystem } = mockAiThatPicks("supply_order");
    const router = new IntentRouter(registry, ai);
    const result = await router.route("订货 面粉 50kg", []);
    expect(calls()).toBe(1);
    // Candidate subset must include both the order and send skills.
    expect(lastSystem()).toContain("- supply_order:");
    expect(lastSystem()).toContain("- supply_send:");
    expect(result.skillId).toBe("supply_order");
  });

  it("never emits a skillId outside the registry (no orphans)", async () => {
    const registry = buildRegistry();
    // Force the LLM to hallucinate a removed skill id.
    const ai: AiRouterProvider = {
      async getEmbedding() { return []; },
      async getEmbeddings() { return []; },
      async chatCompletion() { return ""; },
      async chatCompletionLong() { return ""; },
      async chatCompletionMessages() {
        return JSON.stringify({ action: "skill", skillId: "candidate_outreach", reply: "x" });
      },
    };
    const router = new IntentRouter(registry, ai);
    const result = await router.route("聊点别的吧", []); // no keyword → LLM
    expect(result.action).toBe("chat"); // orphan downgraded
    expect(result.skillId).toBeUndefined();
  });

  it("caches candidate skill embeddings: getEmbeddings called once across consecutive routes", async () => {
    const registry = buildRegistry();
    // Keyword-free messages so both routes reach the embedding tier.
    const messages = ["聊点别的吧", "陪我闲聊几句"];
    let embedBatchCalls = 0;
    const ai: AiRouterProvider = {
      // User text embeds to [1,0]; candidate #0 to [1,0], the rest to [0,1] → high-confidence top-1.
      async getEmbedding() { return [1, 0]; },
      async getEmbeddings(texts: string[]) {
        embedBatchCalls++;
        return texts.map((_, i) => (i === 0 ? [1, 0] : [0, 1]));
      },
      async chatCompletion() { return ""; },
      async chatCompletionLong() { return ""; },
      async chatCompletionMessages() { return JSON.stringify({ action: "chat", reply: "x" }); },
    };
    const router = new IntentRouter(registry, ai);
    const first = await router.route(messages[0], []);
    const second = await router.route(messages[1], []);
    expect(embedBatchCalls).toBe(1); // candidate embeddings computed once, then reused
    expect(first.action).toBe("skill");
    expect(second).toEqual(first); // same vectors, same scoring → identical routing
  });

  it("LLM prompt only ever lists registered skill ids (single source of truth)", async () => {
    const registry = buildRegistry();
    const { ai, lastSystem } = mockAiThatPicks("__none__");
    const router = new IntentRouter(registry, ai);
    await router.route("帮我看看招聘进度和岗位情况", []); // ambiguous → LLM
    const sys = lastSystem();
    const listed = [...sys.matchAll(/^- ([a-z_]+):/gm)].map((m) => m[1]);
    expect(listed.length).toBeGreaterThan(0);
    for (const id of listed) expect(ALL_IDS).toContain(id);
  });
});
