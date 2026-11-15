import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { planLiveSync } from "../lib/mobile-live";
import { useWorkspace } from "../lib/workspace";
import { reattachName } from "../lib/workspace-model";

/** How often the list is re-read while the page is visible. */
const POLL_MS = 10_000;
/** The longest the first read holds the list back. */
const FIRST_READ_HOLD_MS = 2000;

export type LiveState = {
  /** True until the first answer (or failure) from every server. */
  loading: boolean;
  /** Per server: the daemon names it is running, from the last good listing. */
  live: Record<string, Set<string>>;
  /** The last listing failure, if the most recent attempt failed. */
  error: string | null;
};

/**
 * Keep the phone's list to what the hosts are running (issue #17).
 *
 * Reads `host_sessions` for rmux-web's own machine (always) and for every
 * server already in this browser's workspace, on mount and every 10s while the
 * page is visible. New sessions are adopted quietly; ended ones are hidden by
 * the list (`liveFilter`), never closed. Mobile only — the desktop does not poll.
 */
export function useLiveSessions(): LiveState {
  const [state, setState] = useState<LiveState>({ loading: true, live: {}, error: null });

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const read = async () => {
      const ws = useWorkspace.getState();
      // rmux-web's own host is the local target; make sure it has a server row.
      if (!ws.servers.some((sv) => sv.id === "local")) ws.connectServer({});
      const servers = useWorkspace.getState().servers;
      const live: Record<string, Set<string>> = {};
      let error: string | null = null;
      for (const server of servers) {
        try {
          const rows = await api.hostSessions(server.target);
          if (!Array.isArray(rows)) throw new Error("the host did not list its sessions");
          const now = useWorkspace.getState();
          const local = now.sessions.map((s) => ({ id: s.id, key: reattachName(s), serverId: now.serverOf(s.id)?.id ?? "" }));
          const plan = planLiveSync(server.id, local, rows);
          if (plan.adopt.length) now.adoptServerSessionsQuietly(server.id, plan.adopt);
          live[server.id] = plan.live;
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
        if (stopped) return;
      }
      setState((prev) => ({
        loading: false,
        // A server whose listing failed keeps its last good answer.
        live: { ...prev.live, ...live },
        error,
      }));
    };

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!document.hidden) await read();
        if (!stopped) schedule();
      }, POLL_MS);
    };
    const onVisible = () => {
      if (!document.hidden) void read();
    };

    // The first read is waited for at most this long before the list shows
    // what it has — long enough that rows adopted from the answer arrive
    // before the list paints (no rows jumping mid-list), short enough that a
    // slow host does not hold the seeded rows back.
    const hold = setTimeout(() => setState((prev) => (prev.loading ? { ...prev, loading: false } : prev)), FIRST_READ_HOLD_MS);
    void read().then(() => !stopped && schedule());
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(hold);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return state;
}
