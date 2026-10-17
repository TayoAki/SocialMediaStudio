"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-read persisted state while work is active; never animates fake progress on its own. */
export function LiveRefresh({ active, ms = 4000 }: { active: boolean; ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [active, ms, router]);
  return null;
}
