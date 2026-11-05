import type { RepositoryGraphCommit } from "@getpaseo/protocol/messages";

export function matchesRepositoryGraphSearch(
  commit: RepositoryGraphCommit,
  search: string,
): boolean {
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return true;
  }

  const searchableText = [
    commit.subject,
    commit.authorName,
    commit.sha,
    commit.shortSha,
    ...commit.refs.map((ref) => ref.name),
  ]
    .join("\n")
    .toLocaleLowerCase();
  return terms.every((term) => searchableText.includes(term));
}
