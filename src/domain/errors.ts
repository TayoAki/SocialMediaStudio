export type ErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "CAPABILITY_UNAVAILABLE"
  | "CONNECTION_EXPIRED"
  | "RATE_LIMITED"
  | "BUDGET_EXCEEDED"
  | "PROVIDER_REJECTED"
  | "OUTCOME_UNKNOWN"
  | "APPROVAL_REQUIRED"
  | "NEEDS_RESCHEDULING"
  | "TIME_AMBIGUOUS";

const STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VERSION_CONFLICT: 409,
  CAPABILITY_UNAVAILABLE: 422, CONNECTION_EXPIRED: 409, RATE_LIMITED: 429, BUDGET_EXCEEDED: 402,
  PROVIDER_REJECTED: 502, OUTCOME_UNKNOWN: 504, APPROVAL_REQUIRED: 409, NEEDS_RESCHEDULING: 409, TIME_AMBIGUOUS: 422,
};
const RETRYABLE = new Set<ErrorCode>(["RATE_LIMITED"]);

export class AppError extends Error {
  constructor(public code: ErrorCode, message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
  get status() { return STATUS[this.code]; }
  toEnvelope(correlationId: string) {
    return { code: this.code, message: this.message, retryable: RETRYABLE.has(this.code), correlationId, ...this.details };
  }
}
