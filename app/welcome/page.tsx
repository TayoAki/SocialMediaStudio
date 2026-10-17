import { requireActor } from "@/src/security/session";
import { ActionForm } from "@/components/Form";
import { createWorkspaceAction } from "@/app/(studio)/actions";

const ZONES = ["Europe/London", "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Singapore", "Australia/Sydney", "UTC"];

export default async function Welcome() {
  await requireActor();
  return (
    <main className="min-h-dvh grid place-items-center p-4">
      <div className="card p-6 w-full max-w-md">
        <h1 className="text-xl font-semibold">Create a workspace</h1>
        <p className="text-sm text-muted mt-1">One brand per workspace. You can add the brand profile next.</p>
        <ActionForm action={createWorkspaceAction} submit="Create workspace" className="mt-5 space-y-4">
          <div><label className="label" htmlFor="name">Brand or business name <span className="text-bad">*</span></label><input id="name" name="name" required maxLength={120} className="field" /></div>
          <div><label className="label" htmlFor="timezone">Timezone <span className="text-bad">*</span></label>
            <select id="timezone" name="timezone" className="field" defaultValue="Europe/London">{ZONES.map((z) => <option key={z}>{z}</option>)}</select>
            <p className="text-xs text-muted mt-1">All schedule times are shown and confirmed in this zone.</p></div>
        </ActionForm>
      </div>
    </main>
  );
}
