import type { Plan } from "@/src/domain/plan";

export interface CoordinatorInput {
  text: string;
  timezone: string;
  now: Date;
  brand: { audience: string; offer: string; voice_rules: string; business_description: string };
  existingDrafts: { variantId: string; platform: string; concept: string; version: number }[];
}

export interface Coordinator { readonly fixture: boolean; plan(input: CoordinatorInput): Promise<Plan> }

export interface ResearchResult { sources: { url: string; title: string; excerpt: string; publishedAt?: string; claims: string[] }[]; uncertainty: string[] }
export interface Researcher { readonly fixture: boolean; research(topic: string, audience: string): Promise<ResearchResult> }

export interface DraftOutput { caption: string; altText: string; imageBrief: string; unresolvedClaims: string[] }
export interface Creator { readonly fixture: boolean; draft(input: { concept: string; platform: string; brand: CoordinatorInput["brand"]; research: ResearchResult | null }): Promise<DraftOutput> }
