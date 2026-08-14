import { z } from "zod";

const CheckoutErrorSchema = z.object({
  code: z.enum(["NOT_GIT_REPO", "NOT_ALLOWED", "MERGE_CONFLICT", "UNKNOWN"]),
  message: z.string(),
});

const CheckoutCommitFileSchema = z.object({
  path: z.string(),
  additions: z.number(),
  deletions: z.number(),
  status: z.enum(["added", "modified", "deleted", "renamed"]).optional(),
});

const RepositoryGraphCommitSchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  parents: z.array(z.string()),
  subject: z.string(),
  authorName: z.string(),
  authorDate: z.string(),
  refs: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["head", "remote", "tag"]),
      current: z.boolean(),
      upstream: z.string().nullable().optional(),
    }),
  ),
});

const RepositoryGraphCommitDetailsSchema = z.object({
  sha: z.string(),
  parents: z.array(z.string()),
  authorName: z.string(),
  authorEmail: z.string(),
  authorDate: z.string(),
  committerName: z.string(),
  committerEmail: z.string(),
  committerDate: z.string(),
  subject: z.string(),
  body: z.string(),
  files: z.array(CheckoutCommitFileSchema),
});

const ParsedDiffFileSchema = z.object({
  path: z.string(),
  isNew: z.boolean(),
  isDeleted: z.boolean(),
  additions: z.number(),
  deletions: z.number(),
  hunks: z.array(
    z.object({
      oldStart: z.number(),
      oldCount: z.number(),
      newStart: z.number(),
      newCount: z.number(),
      lines: z.array(
        z.object({
          type: z.enum(["add", "remove", "context", "header"]),
          content: z.string(),
          tokens: z.array(z.object({ text: z.string(), style: z.string().nullable() })).optional(),
        }),
      ),
    }),
  ),
  status: z.enum(["ok", "too_large", "binary"]).optional(),
});

export const CheckoutRepositoryGraphGetHistoryRequestSchema = z.object({
  type: z.literal("checkout.repository_graph.get_history.request"),
  cwd: z.string(),
  limit: z.number().int().min(1).max(500).optional(),
  requestId: z.string(),
});

export const CheckoutRepositoryGraphGetCommitDetailsRequestSchema = z.object({
  type: z.literal("checkout.repository_graph.get_commit_details.request"),
  cwd: z.string(),
  sha: z.string(),
  requestId: z.string(),
});

export const CheckoutRepositoryGraphMutateRefRequestSchema = z.object({
  type: z.literal("checkout.repository_graph.mutate_ref.request"),
  cwd: z.string(),
  action: z.enum(["rename", "delete"]),
  refKind: z.enum(["head", "remote", "tag"]),
  name: z.string(),
  newName: z.string().optional(),
  force: z.boolean().optional(),
  deleteOnRemote: z.boolean().optional(),
  requestId: z.string(),
});

export const CheckoutCommitFileDiffRequestSchema = z.object({
  type: z.literal("checkout.commits.file_diff.request"),
  cwd: z.string(),
  sha: z.string(),
  path: z.string(),
  requestId: z.string(),
});

export const CheckoutRepositoryGraphGetHistoryResponseSchema = z.object({
  type: z.literal("checkout.repository_graph.get_history.response"),
  payload: z.object({
    cwd: z.string(),
    commits: z.array(RepositoryGraphCommitSchema),
    hasMore: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutRepositoryGraphGetCommitDetailsResponseSchema = z.object({
  type: z.literal("checkout.repository_graph.get_commit_details.response"),
  payload: z.object({
    cwd: z.string(),
    sha: z.string(),
    details: RepositoryGraphCommitDetailsSchema.nullable(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutRepositoryGraphMutateRefResponseSchema = z.object({
  type: z.literal("checkout.repository_graph.mutate_ref.response"),
  payload: z.object({
    cwd: z.string(),
    action: z.enum(["rename", "delete"]),
    refKind: z.enum(["head", "remote", "tag"]),
    name: z.string(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutCommitFileDiffResponseSchema = z.object({
  type: z.literal("checkout.commits.file_diff.response"),
  payload: z.object({
    cwd: z.string(),
    sha: z.string(),
    path: z.string(),
    file: ParsedDiffFileSchema.nullable(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export type RepositoryGraphCommit = z.infer<typeof RepositoryGraphCommitSchema>;
export type RepositoryGraphCommitDetails = z.infer<typeof RepositoryGraphCommitDetailsSchema>;
