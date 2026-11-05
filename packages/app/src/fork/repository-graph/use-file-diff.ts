import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useFetchQuery } from "@/data/query";
import { checkoutCommitFileDiffQueryKey, COMMIT_FILE_DIFF_STALE_TIME } from "@/git/query-keys";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export function useRepositoryGraphFileDiff(input: {
  serverId: string;
  cwd: string;
  sha: string;
  path: string;
}) {
  const retainedPanelActive = useRetainedPanelActive();
  const client = useHostRuntimeClient(input.serverId);
  const isConnected = useHostRuntimeIsConnected(input.serverId);
  const query = useFetchQuery<{ file: ParsedDiffFile | null }>({
    queryKey: checkoutCommitFileDiffQueryKey(input.serverId, input.cwd, input.sha, input.path),
    queryFn: async () => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      return client.getCommitFileDiff(input.cwd, input.sha, input.path);
    },
    enabled:
      retainedPanelActive &&
      Boolean(input.cwd) &&
      Boolean(input.sha) &&
      Boolean(input.path) &&
      Boolean(client) &&
      isConnected,
    staleTimeMs: COMMIT_FILE_DIFF_STALE_TIME,
    dataShape: "value",
  });
  return {
    files: query.data?.file ? [query.data.file] : [],
    isLoading: query.isLoading,
    error: query.error,
  };
}
