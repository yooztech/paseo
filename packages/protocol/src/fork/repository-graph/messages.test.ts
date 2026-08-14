import { describe, expect, test } from "vitest";
import {
  CheckoutRepositoryGraphGetHistoryRequestSchema,
  CheckoutRepositoryGraphGetHistoryResponseSchema,
  CheckoutRepositoryGraphGetCommitDetailsRequestSchema,
  CheckoutRepositoryGraphGetCommitDetailsResponseSchema,
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "../../messages.js";

describe("checkout.repository_graph.get_history schemas", () => {
  const request = {
    type: "checkout.repository_graph.get_history.request" as const,
    cwd: "/tmp/repo",
    limit: 200,
    requestId: "graph-request",
  };
  const response = {
    type: "checkout.repository_graph.get_history.response" as const,
    payload: {
      cwd: "/tmp/repo",
      commits: [
        {
          sha: "abc",
          shortSha: "abc",
          parents: ["def"],
          subject: "subject",
          authorName: "Test User",
          authorDate: "2026-01-01T00:00:00Z",
          refs: [{ name: "main", kind: "head" as const, current: true }],
        },
      ],
      hasMore: false,
      error: null,
      requestId: "graph-request",
    },
  };

  test("parses requests through the inbound union", () => {
    expect(CheckoutRepositoryGraphGetHistoryRequestSchema.parse(request)).toEqual(request);
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  test("parses responses through the outbound union", () => {
    expect(CheckoutRepositoryGraphGetHistoryResponseSchema.parse(response)).toEqual(response);
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  test("keeps the capability optional", () => {
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "srv_test",
        features: { repositoryGraph: true },
      }).features,
    ).toEqual({ repositoryGraph: true });
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "srv_test",
        features: {},
      }).features,
    ).toEqual({});
  });
});

test("accepts repository graph commit details messages", () => {
  expect(
    CheckoutRepositoryGraphGetCommitDetailsRequestSchema.parse({
      type: "checkout.repository_graph.get_commit_details.request",
      cwd: "/repo",
      sha: "abc123",
      requestId: "request-2",
    }),
  ).toMatchObject({ sha: "abc123" });

  expect(
    CheckoutRepositoryGraphGetCommitDetailsResponseSchema.parse({
      type: "checkout.repository_graph.get_commit_details.response",
      payload: {
        cwd: "/repo",
        sha: "abc123",
        details: {
          sha: "abc123",
          parents: ["parent1"],
          authorName: "Author",
          authorEmail: "author@example.com",
          authorDate: "2026-08-14T10:00:00Z",
          committerName: "Committer",
          committerEmail: "committer@example.com",
          committerDate: "2026-08-14T11:00:00Z",
          subject: "Subject",
          body: "Body",
          files: [{ path: "src/file.ts", additions: 2, deletions: 1, status: "modified" }],
        },
        error: null,
        requestId: "request-2",
      },
    }).payload.details,
  ).toMatchObject({ sha: "abc123", files: [{ path: "src/file.ts" }] });
});
