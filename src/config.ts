export type AppMode = "fixture" | "connected";
export function appMode(): AppMode {
  const m = process.env.APP_MODE ?? "fixture";
  if (m !== "fixture" && m !== "connected") throw new Error("APP_MODE must be fixture or connected");
  return m;
}
