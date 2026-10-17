import { DateTime } from "luxon";
import type { Plan } from "@/src/domain/plan";
import type { Coordinator, CoordinatorInput, Creator, Researcher } from "./types";

const NUM: Record<string, number> = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };

/**
 * Deterministic, labelled fixture coordinator for local development and tests.
 * It understands a narrow grammar and asks a focused question for anything else
 * rather than inventing dates, prices or platforms.
 */
export class FixtureCoordinator implements Coordinator {
  readonly fixture = true;
  async plan(i: CoordinatorInput): Promise<Plan> {
    const t = i.text.toLowerCase();
    const revise = t.match(/make the (first|second|third|last) post about (.+)/);
    if (revise) {
      const idx = { first: 0, second: 1, third: 2, last: i.existingDrafts.length - 1 }[revise[1] as "first"]!;
      const target = i.existingDrafts[idx];
      if (!target) return clarify("Which draft do you mean? I could not find that post.");
      return {
        intent: "revise_draft", summary: `Revise ${revise[1]} draft to focus on ${revise[2]}`, questions: [], accountIds: [], posts: [],
        tasks: [{ key: "revise", role: "creator", dependsOn: [], tools: ["save_draft"], inputs: { variantId: target.variantId, expectedVersion: target.version, concept: revise[2], platform: target.platform }, estimatedCostMicros: 20000 }],
      };
    }
    const platform = t.includes("linkedin") ? "linkedin" : t.includes("instagram") ? "instagram" : null;
    if (!platform) return clarify("Which platform should these posts be for: Instagram or LinkedIn?");
    const count = Number(t.match(/\b(\d+)\b(?= \w* ?(instagram|linkedin|post))/)?.[1]) || NUM[t.match(/\b(one|two|three|four|five|six|seven|a|an)\b/)?.[1] ?? ""] || 1;
    const time = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
    const startsTomorrow = t.includes("tomorrow");
    if (!time || !startsTomorrow) return clarify("What date and local time should the first post go out?");
    let hour = Number(time[1]) % 12 + (time[3] === "pm" ? 12 : 0);
    const minute = Number(time[2] ?? 0);
    const base = DateTime.fromJSDate(i.now, { zone: i.timezone }).plus({ days: 1 }).startOf("day");
    const topic = t.match(/for (?:our |my )?(.+?)(?:,| one | on | at |$)/)?.[1] ?? "our update";
    const posts = Array.from({ length: Math.min(count, 25) }, (_, n) => ({
      platform: platform as "instagram" | "linkedin",
      concept: `${topic} — post ${n + 1}`,
      localTime: base.plus({ days: n }).set({ hour, minute }).toFormat("yyyy-LL-dd'T'HH:mm"),
    }));
    return {
      intent: "create_posts", summary: `${posts.length} ${platform} post(s) about ${topic}`, questions: [], accountIds: [], posts,
      tasks: [
        { key: "research", role: "researcher", dependsOn: [], tools: ["search", "save_research"], inputs: { topic }, estimatedCostMicros: 30000 },
        { key: "draft", role: "creator", dependsOn: ["research"], tools: ["save_draft", "generate_image"], inputs: {}, estimatedCostMicros: 80000 * posts.length },
      ],
    };
  }
}

function clarify(q: string): Plan {
  return { intent: "clarify", summary: "Need more information", questions: [q], tasks: [], posts: [], accountIds: [] };
}

export class FixtureResearcher implements Researcher {
  readonly fixture = true;
  async research(topic: string) {
    return {
      sources: [{ url: "https://example.org/fixture-source", title: `[Fixture] Background on ${topic}`, excerpt: "Fixture research excerpt. Not real evidence.", claims: [] }],
      uncertainty: ["Fixture mode: no live research was performed; no trend or factual claims are supported."],
    };
  }
}

export class FixtureCreator implements Creator {
  readonly fixture = true;
  async draft({ concept, platform, brand }: Parameters<Creator["draft"]>[0]) {
    const offer = brand.offer.trim();
    const caption = [
      concept.charAt(0).toUpperCase() + concept.slice(1) + ".",
      offer ? offer : "",
      brand.audience ? `Made for ${brand.audience.trim()}.` : "",
      platform === "instagram" ? "\n#fixture" : "",
    ].filter(Boolean).join(" ");
    const unresolved = /\d/.test(concept) && !offer ? ["Concept mentions numbers/dates not present in the brand brief"] : [];
    return { caption, altText: `Brand-coloured graphic for: ${concept}`, imageBrief: `Simple branded card: ${concept}`, unresolvedClaims: unresolved };
  }
}
