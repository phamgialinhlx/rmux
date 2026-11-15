import type { AgentSession } from "./api";

/**
 * Which session names this desktop should write to a host's `aliases.json`.
 *
 * Names live in this machine's workspace, so a phone on rmux-web or a second
 * computer only sees daemon keys ("claude-session-…") unless the name is also
 * written where every client reads it (issue #20). A rename writes it at once;
 * this covers names given before that was true, and agent sessions, which the
 * rename path used to skip.
 *
 * Pure so it can be checked without a host. Only names the operator chose
 * (`renamed`) are published: Claude's own titles change by themselves, and
 * writing each one would keep rewriting a shared file other people read.
 *
 * A name is skipped when:
 * - the host is not running the session (the agent would refuse it anyway);
 * - the host already shows that name;
 * - the name is another live session's key, or two local sessions want the same
 *   name — the agent refuses both, and asking would just log the refusal.
 */
export type AliasCandidate = { id: string; name: string; renamed?: boolean; key: string };
export type AliasWrite = { id: string; key: string; name: string };

export function aliasesToPublish(local: AliasCandidate[], rows: AgentSession[]): AliasWrite[] {
  const live = new Map(rows.map((r) => [r.name, r]));
  const wanted = local.filter((s) => s.renamed && s.name.trim() && live.has(s.key));
  const count = new Map<string, number>();
  for (const s of wanted) count.set(s.name.trim(), (count.get(s.name.trim()) ?? 0) + 1);
  const takenByOthers = new Map<string, string>();
  for (const r of rows) if (r.alias) takenByOthers.set(r.alias, r.name);

  const out: AliasWrite[] = [];
  for (const s of wanted) {
    const name = s.name.trim();
    if (/[\t\n\0]/.test(name)) continue;
    if (live.get(s.key)?.alias === name) continue;
    if (count.get(name)! > 1) continue;
    if (live.has(name) && name !== s.key) continue;
    const owner = takenByOthers.get(name);
    if (owner && owner !== s.key) continue;
    out.push({ id: s.id, key: s.key, name });
  }
  return out;
}
