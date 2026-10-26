interface GitHubPollRepositoryAddress {
  owner: string;
  name: string;
  headRepositoryOwner?: string;
}

interface GitHubPollRepository {
  owner?: { login?: string } | null;
  isFork?: boolean;
  parent?: { owner: { login: string }; name: string } | null;
}

/** A parent is a fallback for this lookup only, never the next poll's origin. */
export function getGitHubPollParentFallback(
  address: GitHubPollRepositoryAddress,
  repository: GitHubPollRepository,
): GitHubPollRepositoryAddress | null {
  // An owner filter marks a parent lookup. Never follow another parent from it.
  if (address.headRepositoryOwner || !repository.isFork || !repository.parent) {
    return null;
  }
  return {
    owner: repository.parent.owner.login,
    name: repository.parent.name,
    headRepositoryOwner: repository.owner?.login ?? address.owner,
  };
}
