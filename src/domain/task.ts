export const TASK_STATES = ["queued", "running", "awaiting_input", "awaiting_approval", "succeeded", "failed", "cancelled"] as const;
export type TaskState = (typeof TASK_STATES)[number];

const ALLOWED: Record<TaskState, TaskState[]> = {
  queued: ["running", "cancelled"],
  running: ["awaiting_input", "awaiting_approval", "succeeded", "failed", "cancelled", "queued"],
  awaiting_input: ["queued", "cancelled"],
  awaiting_approval: ["queued", "succeeded", "cancelled"],
  succeeded: [],
  failed: ["queued", "cancelled"],
  cancelled: [],
};

export function canTaskTransition(from: TaskState, to: TaskState) {
  return ALLOWED[from].includes(to);
}

export const TERMINAL: TaskState[] = ["succeeded", "failed", "cancelled"];
