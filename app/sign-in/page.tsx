export const dynamic = "force-dynamic";
import { appMode } from "@/src/config";
import { signInFixture } from "@/app/(studio)/actions";

export default function SignIn() {
  const fixture = appMode() === "fixture";
  return (
    <main className="min-h-dvh grid place-items-center p-4">
      <div className="card p-6 w-full max-w-sm">
        <h1 className="text-xl font-semibold">Social Agent Studio</h1>
        <p className="text-sm text-muted mt-1">Private beta (provisional name)</p>
        {fixture ? (
          <form action={signInFixture} className="mt-6">
            <p className="text-sm mb-4 text-warn">Fixture mode: signs you in as a local test owner. No real accounts are used.</p>
            <button className="btn w-full">Continue as fixture owner</button>
          </form>
        ) : (
          <p className="mt-6 text-sm text-bad">Connected sign-in requires the InsForge session bridge, which is not configured yet. See docs/M0-BLOCKERS.md.</p>
        )}
      </div>
    </main>
  );
}
