import { useSessionStore } from "@/stores/session-store";
import { useBranchCiPipeline } from "./use-data";

interface ForkBranchCiVisibilityInput {
  serverId: string;
  cwd: string | null;
  branch: string | null;
  isRouteFocused: boolean;
  isGitCheckout: boolean;
  hasPullRequest: boolean;
}

export function useShouldShowForkBranchCi({
  serverId,
  cwd,
  branch,
  isRouteFocused,
  isGitCheckout,
  hasPullRequest,
}: ForkBranchCiVisibilityInput): boolean {
  const featureEnabled = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.forgeBranchPipeline === true,
  );
  const branchCi = useBranchCiPipeline({
    serverId,
    cwd: cwd ?? "",
    branch,
    enabled: isRouteFocused && isGitCheckout && !hasPullRequest && featureEnabled,
  });
  return featureEnabled && !hasPullRequest && (branchCi.isLoading || branchCi.pipeline !== null);
}
