import { api, isTauri } from "./api";
import { aliasesToPublish } from "./alias-sync";
import { useWorkspace } from "./workspace";
import { reattachName } from "./workspace-model";

/** Long enough that startup's own SSH work (agents, status streams) goes first. */
const DELAY_MS = 8000;

/**
 * Once per app run, write the names given on this desktop to each host that
 * does not know them yet — see `aliasesToPublish`.
 *
 * Only servers with at least one renamed session are asked, one listing each.
 * Every failure is silent: the names are cosmetic, an offline host is normal,
 * and a rename made from here on writes its own alias anyway.
 */
export function startAliasSync(): () => void {
  // `server_alias` is a desktop command; rmux-web has no route for it.
  if (!isTauri()) return () => {};
  let stopped = false;
  const timer = setTimeout(async () => {
    const ws = useWorkspace.getState();
    for (const server of ws.servers) {
      if (stopped) return;
      const local = ws.sessions
        .filter((s) => s.renamed && ws.serverOf(s.id)?.id === server.id)
        .map((s) => ({ id: s.id, name: s.name, renamed: s.renamed, key: reattachName(s) }));
      if (local.length === 0) continue;
      try {
        const rows = await api.hostSessions(server.target);
        for (const w of aliasesToPublish(local, rows)) {
          if (stopped) return;
          await api.serverAlias(server.target, w.key, w.name).catch(() => {});
        }
      } catch {
        // Host offline or agent unavailable: nothing to do until next run.
      }
    }
  }, DELAY_MS);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
