import { ProviderError, type Capabilities, type PublishingAdapter, type ProviderAccount, type ScheduleCandidate, type ScheduleRequest, type RemoteStatus } from "./types";

/**
 * Blotato v2 adapter. Shapes follow help.blotato.com as read on 2026-10-17 and are
 * NOT yet verified against a connected account (M0 gate; see docs/M0-BLOCKERS.md).
 * The key is passed in per instance and only ever placed in the blotato-api-key header.
 */
const CAPS: Record<string, Capabilities> = {
  instagram: { formats: ["image_post"], schedule: true, update: true, cancel: true, statusPolling: true, analytics: true, statusWebhook: false },
  linkedin: { formats: ["text_post", "image_post"], schedule: true, update: true, cancel: true, statusPolling: true, analytics: false, statusWebhook: false },
};

export class BlotatoAdapter implements PublishingAdapter {
  readonly name = "blotato";
  readonly fixture = false;
  constructor(private apiKey: string, private baseUrl = process.env.BLOTATO_BASE_URL ?? "https://backend.blotato.com/v2", private timeoutMs = 15000) {}

  private async call(method: string, path: string, body?: unknown): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { "blotato-api-key": this.apiKey, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      // Network error/timeout: for mutating calls the request may have been accepted.
      throw new ProviderError(method === "GET" ? "rejected" : "unknown", `network: ${(e as Error).name}`);
    }
    if (res.status === 204) return null;
    if (res.ok) return res.json();
    const text = (await res.text()).slice(0, 300);
    if (res.status === 401 || res.status === 403) throw new ProviderError("auth", `auth ${res.status}`);
    if (res.status === 404) throw new ProviderError("not_found", text);
    if (res.status === 429) throw new ProviderError("rate_limited", "rate limited", Number(res.headers.get("retry-after") ?? 60));
    if (res.status >= 400 && res.status < 500) throw new ProviderError("rejected", `${res.status}: ${text}`);
    throw new ProviderError(method === "GET" ? "rejected" : "unknown", `${res.status}`);
  }

  async listAccounts(): Promise<ProviderAccount[]> {
    const data = await this.call("GET", "/users/me/accounts");
    const items: any[] = data?.items ?? data?.accounts ?? [];
    return items
      .filter((a) => CAPS[a.platform])
      .map((a) => ({ externalId: String(a.id), platform: a.platform, displayName: a.fullname ?? a.username ?? String(a.id), capabilities: CAPS[a.platform] }));
  }

  async uploadMedia(filename: string, bytes: Buffer, mime: string) {
    const { presignedUrl, publicUrl } = await this.call("POST", "/media/uploads", { filename });
    const put = await fetch(presignedUrl, { method: "PUT", headers: { "content-type": mime }, body: new Uint8Array(bytes) });
    if (!put.ok) throw new ProviderError("rejected", `media upload ${put.status}`);
    return { publicUrl };
  }

  private draft(req: ScheduleRequest) {
    return {
      accountId: req.accountExternalId,
      content: { text: req.text, mediaUrls: req.mediaUrls, platform: req.platform },
      target: { targetType: req.platform },
    };
  }

  async createScheduled(req: ScheduleRequest) {
    if (new Date(req.scheduledUtc).getTime() <= Date.now()) throw new ProviderError("rejected", "scheduledTime must be in the future");
    // scheduledTime is top-level, not nested inside post.
    const data = await this.call("POST", "/posts", { post: this.draft(req), scheduledTime: req.scheduledUtc });
    if (!data?.postSubmissionId) throw new ProviderError("unknown", "accepted response without postSubmissionId");
    return { submissionId: String(data.postSubmissionId) };
  }

  async getStatus(submissionId: string): Promise<RemoteStatus> {
    const d = await this.call("GET", `/posts/${encodeURIComponent(submissionId)}`);
    return { status: d.status, remoteUrl: d.publicUrl, errorMessage: d.errorMessage, observedAt: new Date().toISOString() };
  }

  async listSchedules(): Promise<ScheduleCandidate[]> {
    const out: ScheduleCandidate[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const d = await this.call("GET", `/schedules?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      for (const s of d?.items ?? []) out.push({ scheduleId: String(s.id), accountExternalId: String(s.draft?.post?.accountId ?? s.draft?.accountId ?? ""), scheduledUtc: s.scheduledAt ?? s.scheduledTime, text: s.draft?.post?.content?.text ?? s.draft?.content?.text ?? "" });
      cursor = d?.cursor;
      if (!cursor) break;
    }
    return out;
  }

  async updateSchedule(scheduleId: string, patch: { scheduledUtc?: string; draft?: ScheduleRequest }) {
    await this.call("PATCH", `/schedules/${encodeURIComponent(scheduleId)}`, {
      patch: { ...(patch.scheduledUtc ? { scheduledTime: patch.scheduledUtc } : {}), ...(patch.draft ? { draft: { post: this.draft(patch.draft) } } : {}) },
    });
  }

  async deleteSchedule(scheduleId: string) {
    await this.call("DELETE", `/schedules/${encodeURIComponent(scheduleId)}`);
  }
}
