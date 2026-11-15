/**
 * The phone's session list, kept to what the host is actually running (#17).
 *
 * The mobile bundle used to list only this browser's workspace, filled once
 * from `/api/seed`: a new browser showed nothing while the host ran many
 * sessions, and sessions started later on the desktop never appeared. Now the
 * host's `host_sessions` listing is the source of truth:
 *
 * - `planLiveSync` says which host rows to adopt (matched by daemon name, so a
 *   seeded or already-adopted row is never added twice) and which names are live.
 * - `liveFilter` hides local rows of that server whose daemon has ended. It is a
 *   view filter only — nothing is closed, killed or removed.
 *
 * Pure, so `ui/mobile-check.ts` proves it without a host.
 */
import { adoptedKind, programOf } from "./workspace-model.ts";

export type LiveRow = { name: string; alias?: string | null; command: string; cwd?: string | null };
export type LocalRow = { id: string; key: string; serverId: string };
export type Adoption = { hostName: string; kind: "claude" | "codex" | "pi" | "terminal"; alias: string | null; cwd: string | null };

/** Which kind a host row opens as on a phone. pi is a chat kind here too. */
export function liveKind(command: string): Adoption["kind"] {
  return programOf(command) === "pi" ? "pi" : adoptedKind(command);
}

export function planLiveSync(
  serverId: string,
  local: readonly LocalRow[],
  rows: readonly LiveRow[],
): { adopt: Adoption[]; live: Set<string> } {
  const have = new Set(local.filter((s) => s.serverId === serverId).map((s) => s.key));
  const live = new Set(rows.map((r) => r.name));
  const adopt: Adoption[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (have.has(r.name) || seen.has(r.name)) continue;
    // rmux's own companion shells (a Claude pane's terminal) are plumbing, not
    // sessions anyone started — the desktop rail does not list them either.
    if (r.name.startsWith("companion-")) continue;
    seen.add(r.name);
    adopt.push({ hostName: r.name, kind: liveKind(r.command), alias: r.alias?.trim() || null, cwd: r.cwd?.trim() || null });
  }
  return { adopt, live };
}

/**
 * The local rows to show. `live` is `undefined` until a listing has succeeded,
 * and a failed listing keeps the last good one — so an unreachable host hides
 * nothing; only an answer that leaves a session out does.
 */
export function liveFilter<T extends LocalRow>(rows: readonly T[], serverId: string, live: Set<string> | undefined): T[] {
  if (!live) return [...rows];
  return rows.filter((r) => r.serverId !== serverId || live.has(r.key));
}
