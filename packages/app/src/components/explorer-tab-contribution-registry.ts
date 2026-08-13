export const explorerTabContributionIds = ["repository_graph", "ci"] as const;

export type ExplorerTabContributionId = (typeof explorerTabContributionIds)[number];

export const explorerTabContributionQueryKinds = ["repositoryGraph", "branchCiPipeline"] as const;

export function isExplorerTabContributionId(value: string): value is ExplorerTabContributionId {
  return explorerTabContributionIds.some((id) => id === value);
}
