import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@getpaseo/client";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { invalidateCheckoutGitQueriesForClient } from "@/git/query-keys";

type RefMutationInput = Omit<Parameters<DaemonClient["mutateRepositoryGraphRef"]>[0], "cwd">;

export function useRepositoryGraphRefMutation(serverId: string, cwd: string) {
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RefMutationInput) => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      try {
        await client.mutateRepositoryGraphRef({ cwd, ...input });
      } finally {
        await invalidateCheckoutGitQueriesForClient(queryClient, { serverId, cwd });
      }
    },
  });
}
