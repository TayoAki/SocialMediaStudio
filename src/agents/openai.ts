import { Plan } from "@/src/domain/plan";
import type { Coordinator, CoordinatorInput } from "./types";

/**
 * OpenAI coordinator via the Responses API with strict JSON output. Untested against a
 * live key in this repository (M0); the model must be pinned via OPENAI_MODEL.
 * Retrieved/web content is never placed in the system role.
 */
export class OpenAICoordinator implements Coordinator {
  readonly fixture = false;
  constructor(private apiKey: string, private model: string) {}
  async plan(i: CoordinatorInput) {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: this.model,
        input: [
          { role: "system", content: "You are the coordinator for a social media workspace. Return only a JSON plan. Never invent business facts, prices or dates; ask a question instead. Roles: researcher(search,retrieve,save_research), creator(save_draft,generate_image,render_template). Times are local wall times YYYY-MM-DDTHH:mm in the workspace timezone." },
          { role: "user", content: JSON.stringify({ request: i.text, timezone: i.timezone, now: i.now.toISOString(), brand: i.brand, drafts: i.existingDrafts }) },
        ],
        text: { format: { type: "json_object" } },
      }),
    });
    if (!res.ok) throw new Error(`model ${res.status}`);
    const data = await res.json();
    const text = data.output_text ?? data.output?.flatMap((o: any) => o.content ?? []).find((c: any) => c.type === "output_text")?.text;
    return Plan.parse(JSON.parse(text)); // validatePlan() still runs server-side afterwards
  }
}
