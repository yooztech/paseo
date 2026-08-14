import type { RepositoryGraphCommitDetails } from "@getpaseo/protocol/messages";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { repositoryGraphCommitDetailsQueryKey } from "./query-keys";

export function useRepositoryGraphCommitDetails(input: {
  serverId: string;
  cwd: string;
  sha: string;
  enabled: boolean;
}) {
  const client = useHostRuntimeClient(input.serverId);
  const isConnected = useHostRuntimeIsConnected(input.serverId);
  // FORK(repository-graph): gate details when the connected host predates this fork feature.
  const supported = useSessionStore(
    (state) =>
      state.sessions[input.serverId]?.serverInfo?.features?.repositoryGraphCommitDetails === true,
  );
  const enabled =
    input.enabled && supported && isConnected && Boolean(client) && Boolean(input.cwd);
  const query = useFetchQuery<RepositoryGraphCommitDetails>({
    queryKey: repositoryGraphCommitDetailsQueryKey(input.serverId, input.cwd, input.sha),
    queryFn: async () => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      return client.getRepositoryGraphCommitDetails(input.cwd, input.sha);
    },
    enabled,
    staleTimeMs: 5 * 60_000,
    dataShape: "value",
  });
  return { ...query, supported };
}
