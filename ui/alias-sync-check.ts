import { aliasesToPublish, type AliasCandidate } from "./src/lib/alias-sync.ts";
import type { AgentSession } from "./src/lib/api.ts";

/** Issue #20: which desktop names get written to the host's aliases.json. */
const row = (name: string, alias?: string): AgentSession => ({
  name, alias: alias ?? null, pid: 1, ageSeconds: 1, attached: false, command: "claude", memory: null, cpu: null,
});
const s = (id: string, key: string, name: string, renamed = true): AliasCandidate => ({ id, key, name, renamed });

export function run(log: (line: string) => void): boolean {
  let failures = 0;
  const check = (label: string, ok: boolean) => {
    log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok) failures++;
  };
  const keys = (w: { key: string }[]) => w.map((x) => x.key).join();

  check("a renamed live session is published",
    keys(aliasesToPublish([s("a", "claude-a", "Fix login")], [row("claude-a")])) === "claude-a");
  check("an unrenamed one is not",
    aliasesToPublish([s("a", "claude-a", "Claude 2", false)], [row("claude-a")]).length === 0);
  check("a session the host is not running is skipped",
    aliasesToPublish([s("a", "claude-a", "Fix login")], [row("term-x")]).length === 0);
  check("a name the host already shows is not rewritten",
    aliasesToPublish([s("a", "claude-a", "Fix login")], [row("claude-a", "Fix login")]).length === 0);
  check("a changed name is rewritten",
    keys(aliasesToPublish([s("a", "claude-a", "New")], [row("claude-a", "Old")])) === "claude-a");
  check("two local sessions wanting one name publish neither",
    aliasesToPublish([s("a", "k1", "api"), s("b", "k2", "api")], [row("k1"), row("k2")]).length === 0);
  check("a name that is another session's key is skipped",
    aliasesToPublish([s("a", "k1", "k2")], [row("k1"), row("k2")]).length === 0);
  check("a name another session is already called is skipped",
    aliasesToPublish([s("a", "k1", "api")], [row("k1"), row("k2", "api")]).length === 0);
  check("a name with a tab or newline is skipped",
    aliasesToPublish([s("a", "k1", "a\tb"), s("b", "k2", "c\nd")], [row("k1"), row("k2")]).length === 0);
  check("names are trimmed",
    aliasesToPublish([s("a", "k1", "  api  ")], [row("k1")])[0]?.name === "api");

  log("");
  log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  return failures === 0;
}

if (typeof window === "undefined") {
  const ok = run((line) => console.log(line));
  if (!ok) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
}
