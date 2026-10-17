/**
 * Delivery state machine (PRD §10). desired_state and observed provider state are
 * stored separately; this governs the product-facing `state` column.
 */
export const DELIVERY_STATES = [
  "approved", "schedule_pending", "scheduled", "change_pending", "cancelling", "processing",
  "published", "failed", "cancelled", "needs_reconciliation", "needs_connection", "needs_rescheduling",
] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

const ALLOWED: Record<DeliveryState, DeliveryState[]> = {
  approved: ["schedule_pending", "needs_rescheduling", "needs_connection", "cancelled"],
  schedule_pending: ["scheduled", "failed", "needs_reconciliation", "needs_connection", "needs_rescheduling", "processing"],
  scheduled: ["change_pending", "cancelling", "processing", "published", "failed", "needs_reconciliation", "needs_connection"],
  change_pending: ["scheduled", "needs_reconciliation", "processing", "published", "failed"],
  cancelling: ["cancelled", "scheduled", "processing", "published", "needs_reconciliation"],
  processing: ["published", "failed", "needs_reconciliation"],
  published: [],
  failed: ["schedule_pending", "needs_rescheduling"],
  cancelled: [],
  needs_reconciliation: ["scheduled", "processing", "published", "failed", "cancelled", "schedule_pending"],
  needs_connection: ["schedule_pending", "scheduled", "needs_reconciliation", "needs_rescheduling"],
  needs_rescheduling: ["schedule_pending", "cancelled"],
};

export function canTransition(from: DeliveryState, to: DeliveryState) {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: DeliveryState, to: DeliveryState) {
  if (!canTransition(from, to)) throw new Error(`Illegal delivery transition ${from} -> ${to}`);
}

/** Map a raw provider status to our state. Only definitive evidence yields published. */
export function mapProviderStatus(raw: string): DeliveryState | null {
  switch (raw) {
    case "scheduled": return "scheduled";
    case "in-progress": return "processing";
    case "published": return "published";
    case "failed": return "failed";
    default: return null;
  }
}

export const DELIVERY_LABEL: Record<DeliveryState, string> = {
  approved: "Approved, not submitted",
  schedule_pending: "Submitting to provider",
  scheduled: "Scheduled (provider confirmed)",
  change_pending: "Change pending (old schedule still active)",
  cancelling: "Cancelling (not yet confirmed)",
  processing: "Submitted / processing",
  published: "Published",
  failed: "Failed",
  cancelled: "Cancelled",
  needs_reconciliation: "Needs reconciliation",
  needs_connection: "Needs connection",
  needs_rescheduling: "Needs rescheduling",
};
