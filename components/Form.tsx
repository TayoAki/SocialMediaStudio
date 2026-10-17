"use client";
import { useActionState } from "react";
import type { ActionResult } from "@/app/(studio)/actions";

/** Progressive-enhancement form with an accessible status line for server action results. */
export function ActionForm({ action, children, className, submit, pendingLabel = "Working…", encType }: {
  action: (s: ActionResult | null, f: FormData) => Promise<ActionResult>; children: React.ReactNode; className?: string; submit: string; pendingLabel?: string; encType?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className} encType={encType}>
      {children}
      <div className="flex flex-wrap items-center gap-3 mt-3">
        <button className="btn" disabled={pending}>{pending ? pendingLabel : submit}</button>
        <p role="status" aria-live="polite" className={`text-sm ${state && !state.ok ? "text-bad" : "text-ok"}`}>
          {state ? (state.ok ? state.message ?? "Done" : state.error) : ""}
        </p>
      </div>
    </form>
  );
}
