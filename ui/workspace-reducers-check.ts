import {
  EMPTY_CORE,
  addServer,
  addProject,
  addSession,
  removeSession,
  type Core,
} from "./src/lib/workspace-reducers.ts";
import { adoptedKind, isClaudeSession, isCodexSession, reattachName, serverId } from "./src/lib/workspace-model.ts";

/**
 * The invariants the workspace store's pure transitions must keep. The Zustand
 * store is thin glue over these, so proving them here is proving the store's
 * logic without booting it.
 */

/** Build a small workspace: one server, one project, two sessions (1 claude, 1 term). */
function seed(): { ws: Core; sid: string; pid: string } {
  let ws = EMPTY_CORE;
  const srv = addServer(ws, { host: "prod" });
  ws = srv.ws;
  const prj = addProject(ws, srv.id, "/home/me/api");
  ws = prj.ws;
  ws = addSession(ws, { id: "claude-1", projectId: prj.id, kind: "claude", name: "api" });
  ws = addSession(ws, { id: "term-1", projectId: prj.id, kind: "terminal", name: "sh 1" });
  return { ws, sid: srv.id, pid: prj.id };
}

export function run(log: (line: string) => void): boolean {
  let failures = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
  };

  // ── Create dedups by derived id ───────────────────────────────────────────
  {
    const { ws, sid, pid } = seed();
    check("one server, one project, two sessions", ws.servers.length === 1 && ws.projects.length === 1 && ws.sessions.length === 2);

    const again = addServer(ws, { host: "prod" });
    check("re-adding the same server is a no-op", again.ws.servers.length === 1 && again.id === sid);
    const reproj = addProject(again.ws, sid, "/home/me/api");
    check("re-adding the same project is a no-op", reproj.ws.projects.length === 1 && reproj.id === pid);

    // A different user is a different server.
    const root = addServer(ws, { host: "prod", user: "root" });
    check("different user forks a new server", root.ws.servers.length === 2 && root.id === serverId({ host: "prod", user: "root" }));

    check("adding a session makes it active", ws.activeSession === "term-1");
  }

  // ── Removing a session: structure survives, active hands off ─────────────
  //
  // Where it was *shown* is no longer this reducer's business: the layout tree
  // drops its leaf (`removeSessionLeaves`, pinned in `layout-tree-check.ts`).
  {
    let { ws } = seed();
    ws = removeSession(ws, "term-1");

    check("the session is gone", !ws.sessions.some((s) => s.id === "term-1"));
    check("its Project stays (empty projects persist)", ws.projects.length === 1);
    check("active hands off to the survivor", ws.activeSession === "claude-1");
    check("removing an unknown id is a no-op", removeSession(ws, "nope") === ws);
  }

  // ── Adopting a session that is already running on the host ────────────────
  //
  // The whole risk of this feature is naming. Attaching to a name the daemon
  // does not hold *creates* a session, so a mis-derived name does not fail — it
  // silently starts a second shell beside the one being adopted and leaves the
  // original running with nothing pointing at it. PR #9 needed three commits to
  // settle this; these are the two pure functions it turns on.
  {
    check(
      "an adopted session attaches by its host name, not a derived one",
      reattachName({ id: "anything", kind: "terminal", hostName: "term-from-another-mac" }) ===
        "term-from-another-mac",
    );
    check(
      "and that holds for Claude too, where the derived name would be prefixed",
      reattachName({ id: "s1", kind: "claude", hostName: "claude-elsewhere" }) ===
        "claude-elsewhere",
    );

    // The migration guarantee: without a host name, nothing about the old
    // scheme may change, or every existing session reattaches to a name the
    // daemon has never heard of.
    check("a Claude session with no host name is still claude-<id>",
      reattachName({ id: "s1", kind: "claude" }) === "claude-s1");
    check("a terminal with no host name is still its bare id",
      reattachName({ id: "term-1", kind: "terminal" }) === "term-1");

    // Kind comes from the daemon's `command`, because an adopted session's name
    // was chosen by whoever started it and carries no reliable prefix.
    check("a bare claude command is a conversation", isClaudeSession("claude"));
    check("so is one with arguments", isClaudeSession("claude --resume abc"));
    check("a shell is not", !isClaudeSession("bash"));
    check("and neither is a shell that merely mentions it",
      !isClaudeSession('git commit -m "claude"'));
    check("an unknown command is not a conversation", !isClaudeSession(undefined) && !isClaudeSession(null));

    // rmux's own launch lines put a preamble before the program (issue #16).
    check("the inline launch line is a conversation", isClaudeSession(
      "CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1 CLAUDE_CODE_DISABLE_MOUSE=1 claude --resume abc --dangerously-skip-permissions"));
    check("the fullscreen launch line is a conversation",
      isClaudeSession("CLAUDE_CODE_NO_FLICKER=1 claude --resume abc"));
    check("unset + assignments + exec is a conversation", isClaudeSession(
      "unset ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN; CLAUDE_CONFIG_DIR=/home/me/.rmux/c1 exec claude --resume abc"));
    check("quoted values are skipped", isClaudeSession(
      `A="x y" B='p q' C="esc \\" quote" claude`));
    check("shell-escaped single quotes are one value",
      isClaudeSession(`K='it'\\''s' claude --resume abc`));
    check("a leading preamble before a shell stays a shell",
      adoptedKind("FOO=1 bash -c claude") === "terminal");
    check("an assignment after a command is not a preamble",
      !isClaudeSession("echo FOO=1 claude"));
    check("codex behind the preamble is codex",
      isCodexSession("CODEX_HOME=/x exec codex resume abc") && adoptedKind("CODEX_HOME=/x codex") === "codex");
    check("a preamble with no program is nothing", adoptedKind("FOO=1 ") === "terminal");
    check("claude-like names are not claude", !isClaudeSession("claudex --help"));
  }

  log("");
  log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  return failures === 0;
}

if (typeof window === "undefined") {
  const ok = run((line) => console.log(line));
  if (!ok) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
}
