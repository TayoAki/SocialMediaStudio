import { appMode } from "@/src/config";
import { FixtureCoordinator, FixtureCreator, FixtureResearcher } from "./fixture";
import type { Coordinator, Creator, Researcher } from "./types";

/**
 * Connected mode never silently falls back to fixture agents (FR40). The OpenAI
 * coordinator exists (./openai.ts) but connected research/creator adapters are
 * an open M0 item, so connected agent runs refuse rather than fake output.
 */
export function agents(): { coordinator: Coordinator; researcher: Researcher; creator: Creator } {
  if (appMode() === "fixture") return { coordinator: new FixtureCoordinator(), researcher: new FixtureResearcher(), creator: new FixtureCreator() };
  throw new Error("Connected research/creator adapters are not configured yet (docs/M0-BLOCKERS.md)");
}
