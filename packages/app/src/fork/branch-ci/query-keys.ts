export const branchCiPipelineQueryKind = "branchCiPipeline";

export function branchCiPipelineQueryKey({
  serverId,
  cwd,
  branch,
}: {
  serverId: string;
  cwd: string;
  branch: string | null;
}) {
  return [branchCiPipelineQueryKind, serverId, cwd, branch] as const;
}
