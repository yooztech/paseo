import { branchCiPipelineQueryKind } from "@/fork/branch-ci/query-keys";
import { repositoryGraphQueryKind } from "@/fork/repository-graph/query-keys";

export const explorerTabContributionIds = ["repository_graph", "ci"] as const;

export type ExplorerTabContributionId = (typeof explorerTabContributionIds)[number];

export const explorerTabContributionQueryKinds = [
  repositoryGraphQueryKind,
  branchCiPipelineQueryKind,
] as const;

export function isExplorerTabContributionId(value: string): value is ExplorerTabContributionId {
  return explorerTabContributionIds.some((id) => id === value);
}
