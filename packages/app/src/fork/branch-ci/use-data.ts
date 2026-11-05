import { useMemo } from "react";
import type { CheckoutPipeline } from "@getpaseo/protocol/messages";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { isPipelineActiveStatus } from "@/git/forges/gitlab";
import { branchCiPipelineQueryKey } from "./query-keys";

const LIVE_PIPELINE_REFETCH_MS = 15_000;

export interface UseBranchCiPipelineOptions {
  serverId: string;
  cwd: string;
  branch: string | null;
  enabled: boolean;
}

export interface UseBranchCiPipelineResult {
  pipeline: CheckoutPipeline | null;
  branch: string | null;
  supported: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
}

export function useBranchCiPipeline({
  serverId,
  cwd,
  branch,
  enabled,
}: UseBranchCiPipelineOptions): UseBranchCiPipelineResult {
  const daemonClient = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const shouldFetch = enabled && !!daemonClient && isConnected && !!cwd && !!branch;

  const query = useFetchQuery<{
    pipeline: CheckoutPipeline | null;
    branch: string | null;
    supported: boolean;
  }>({
    queryKey: useMemo(
      () => branchCiPipelineQueryKey({ serverId, cwd, branch }),
      [serverId, cwd, branch],
    ),
    queryFn: async () => {
      if (!daemonClient || !branch) {
        return { pipeline: null, branch, supported: false };
      }
      const payload = await daemonClient.checkoutForgeGetBranchPipeline({
        cwd,
        branch,
      });
      if (!payload.success) {
        throw new Error(payload.error?.message ?? "Could not load branch pipeline");
      }
      return {
        pipeline: payload.pipeline ?? null,
        branch: payload.branch,
        supported: payload.supported,
      };
    },
    enabled: shouldFetch,
    dataShape: "list",
    staleTimeMs: 0,
    refetchInterval: (queryState) => {
      const raw = queryState.state.data?.pipeline?.rawStatus;
      if (!shouldFetch || !raw || !isPipelineActiveStatus(raw)) {
        return false;
      }
      return LIVE_PIPELINE_REFETCH_MS;
    },
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  return {
    pipeline: query.data?.pipeline ?? null,
    branch: query.data?.branch ?? branch,
    supported: query.data?.supported ?? true,
    isLoading: shouldFetch && query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  };
}
