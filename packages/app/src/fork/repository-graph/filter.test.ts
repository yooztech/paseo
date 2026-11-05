import { describe, expect, it } from "vitest";
import type { RepositoryGraphCommit } from "@getpaseo/protocol/messages";
import { matchesRepositoryGraphSearch } from "./filter";

const commit: RepositoryGraphCommit = {
  sha: "abc123def456",
  shortSha: "abc123d",
  parents: [],
  subject: "Fix repository graph search",
  authorName: "Ada Lovelace",
  authorDate: "2026-09-04T00:00:00Z",
  refs: [{ name: "release/v1", kind: "tag", current: false }],
};

describe("matchesRepositoryGraphSearch", () => {
  it("matches commit text, author, sha, and refs case-insensitively", () => {
    expect(matchesRepositoryGraphSearch(commit, "GRAPH ada")).toBe(true);
    expect(matchesRepositoryGraphSearch(commit, "def456")).toBe(true);
    expect(matchesRepositoryGraphSearch(commit, "release/v1")).toBe(true);
  });

  it("requires every search term and treats blank search as unfiltered", () => {
    expect(matchesRepositoryGraphSearch(commit, "graph missing")).toBe(false);
    expect(matchesRepositoryGraphSearch(commit, "   ")).toBe(true);
  });
});
