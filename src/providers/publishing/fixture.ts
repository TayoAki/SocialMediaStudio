import { randomUUID } from "node:crypto";
import { ProviderError, type PublishingAdapter, type ScheduleCandidate, type ScheduleRequest } from "./types";

/**
 * Fixture publishing provider. Never contacts a network. Supports fault injection
 * so acceptance tests can exercise lost responses, rejections and races.
 * All results are labelled fixture in the UI.
 */
type Fault = "lost_response" | "reject" | "rate_limit" | "auth" | "timeout_before_accept";

interface FixtureJob { submissionId: string; scheduleId: string; req: ScheduleRequest; status: string; remoteUrl?: string }

export class FixturePublishingAdapter implements PublishingAdapter {
  readonly name = "fixture";
  readonly fixture = true;
  jobs = new Map<string, FixtureJob>();
  faults: Fault[] = [];
  calls: string[] = [];

  async listAccounts() {
    return [
      { externalId: "fx-ig-1", platform: "instagram", displayName: "Fixture Café (Instagram)", capabilities: { formats: ["image_post" as const], schedule: true, update: true, cancel: true, statusPolling: true, analytics: true, statusWebhook: false } },
      { externalId: "fx-li-1", platform: "linkedin", displayName: "Fixture Owner (LinkedIn)", capabilities: { formats: ["text_post" as const, "image_post" as const], schedule: true, update: true, cancel: true, statusPolling: true, analytics: false, statusWebhook: false } },
    ];
  }
  async uploadMedia(filename: string) { return { publicUrl: `fixture://media/${randomUUID()}/${filename}` }; }

  private fault() { return this.faults.shift(); }

  async createScheduled(req: ScheduleRequest) {
    this.calls.push(`create:${req.accountExternalId}`);
    const f = this.fault();
    if (f === "reject") throw new ProviderError("rejected", "fixture rejection");
    if (f === "rate_limit") throw new ProviderError("rate_limited", "fixture 429", 1);
    if (f === "auth") throw new ProviderError("auth", "fixture auth");
    if (f === "timeout_before_accept") throw new ProviderError("unknown", "fixture timeout");
    const job: FixtureJob = { submissionId: randomUUID(), scheduleId: `sch_${randomUUID().slice(0, 8)}`, req, status: "scheduled" };
    this.jobs.set(job.submissionId, job);
    if (f === "lost_response") throw new ProviderError("unknown", "fixture: accepted but response lost");
    return { submissionId: job.submissionId };
  }
  async getStatus(id: string) {
    const j = this.jobs.get(id);
    if (!j) throw new ProviderError("not_found", "unknown submission");
    return { status: j.status, remoteUrl: j.remoteUrl, observedAt: new Date().toISOString() };
  }
  async listSchedules(): Promise<ScheduleCandidate[]> {
    return [...this.jobs.values()].filter((j) => j.status === "scheduled")
      .map((j) => ({ scheduleId: j.scheduleId, accountExternalId: j.req.accountExternalId, scheduledUtc: j.req.scheduledUtc, text: j.req.text }));
  }
  private bySchedule(id: string) {
    const j = [...this.jobs.values()].find((x) => x.scheduleId === id);
    if (!j || j.status !== "scheduled") throw new ProviderError("not_found", "schedule not found (may have dispatched)");
    return j;
  }
  async updateSchedule(id: string, patch: { scheduledUtc?: string; draft?: ScheduleRequest }) {
    this.calls.push(`update:${id}`);
    const f = this.fault();
    if (f === "reject") throw new ProviderError("rejected", "fixture rejection");
    if (f === "timeout_before_accept") throw new ProviderError("unknown", "fixture timeout");
    const j = this.bySchedule(id);
    if (patch.draft) j.req = patch.draft;
    if (patch.scheduledUtc) j.req = { ...j.req, scheduledUtc: patch.scheduledUtc };
  }
  async deleteSchedule(id: string) {
    this.calls.push(`delete:${id}`);
    const j = this.bySchedule(id);
    j.status = "cancelled";
  }
  /** Test helper: simulate the provider dispatching a job at due time. */
  dispatch(submissionId: string, outcome: "published" | "failed" = "published") {
    const j = this.jobs.get(submissionId)!;
    j.status = outcome;
    if (outcome === "published") j.remoteUrl = `https://fixture.invalid/p/${submissionId.slice(0, 8)}`;
  }
}

const g = globalThis as unknown as { __fixturePub?: FixturePublishingAdapter };
export function fixturePublisher() {
  return (g.__fixturePub ??= new FixturePublishingAdapter());
}
