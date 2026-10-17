export interface ProviderAccount { externalId: string; platform: string; displayName: string; capabilities: Capabilities }

export interface Capabilities {
  formats: ("image_post" | "text_post")[];
  schedule: boolean;
  update: boolean;
  cancel: boolean;
  statusPolling: boolean;
  analytics: boolean;
  statusWebhook: boolean;
}

export interface ScheduleRequest {
  accountExternalId: string;
  platform: "instagram" | "linkedin";
  text: string;
  mediaUrls: string[];
  scheduledUtc: string;
}

/**
 * Error classes drive retry policy (FR27):
 * - rejected: definitive, provider did not accept. Safe to fix and retry.
 * - rate_limited: definitive non-acceptance; retry after delay.
 * - auth: credential/authorization failure; block new submissions.
 * - unknown: request may have been accepted (timeout, 5xx, lost response). Never retry blindly.
 */
export type ProviderErrorClass = "rejected" | "rate_limited" | "auth" | "not_found" | "unknown";

export class ProviderError extends Error {
  constructor(public errorClass: ProviderErrorClass, message: string, public retryAfterSeconds?: number) { super(message); }
}

export interface RemoteStatus { status: "in-progress" | "scheduled" | "published" | "failed" | string; remoteUrl?: string; errorMessage?: string; observedAt: string }

export interface ScheduleCandidate { scheduleId: string; accountExternalId: string; scheduledUtc: string; text: string }

export interface PublishingAdapter {
  readonly name: string;
  readonly fixture: boolean;
  listAccounts(): Promise<ProviderAccount[]>;
  uploadMedia(filename: string, bytes: Buffer, mime: string): Promise<{ publicUrl: string }>;
  createScheduled(req: ScheduleRequest): Promise<{ submissionId: string }>;
  getStatus(submissionId: string): Promise<RemoteStatus>;
  listSchedules(): Promise<ScheduleCandidate[]>;
  updateSchedule(scheduleId: string, patch: { scheduledUtc?: string; draft?: ScheduleRequest }): Promise<void>;
  deleteSchedule(scheduleId: string): Promise<void>;
}
