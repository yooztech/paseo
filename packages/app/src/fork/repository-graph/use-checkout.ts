import { useCallback, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { invalidateCheckoutGitQueriesForClient } from "@/git/query-keys";

export type GraphCheckoutTarget = Parameters<DaemonClient["checkoutRepositoryGraph"]>[0]["target"];

export function useRepositoryGraphCheckout(serverId: string, cwd: string) {
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const locked = useRef(false);
  const mutation = useMutation({
    mutationFn: async (target: GraphCheckoutTarget) => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      try {
        await client.checkoutRepositoryGraph({ cwd, target });
        await queryClient.invalidateQueries({
          queryKey: ["fileExplorerRefresh", serverId, cwd.trim()],
        });
      } finally {
        await invalidateCheckoutGitQueriesForClient(queryClient, { serverId, cwd });
      }
    },
  });
  const { mutate } = mutation;

  const checkout = useCallback(
    (target: GraphCheckoutTarget) => {
      if (locked.current) {
        return;
      }
      locked.current = true;
      mutate(target, {
        onSettled: () => {
          locked.current = false;
        },
      });
    },
    [mutate],
  );

  return { ...mutation, checkout };
}
