import { BlotatoAdapter } from "./blotato";
import { fixturePublisher } from "./fixture";
import type { PublishingAdapter } from "./types";
import { appMode } from "@/src/config";

/** Resolve the adapter for a stored connection. Connected mode never falls back to fixtures (FR40). */
export function publisherFor(provider: string, secret: string): PublishingAdapter {
  if (provider === "fixture") {
    if (appMode() !== "fixture") throw new Error("Fixture provider is disabled in connected mode");
    return fixturePublisher();
  }
  if (provider === "blotato") return new BlotatoAdapter(secret);
  throw new Error(`Unknown provider ${provider}`);
}
