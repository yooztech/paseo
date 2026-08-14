import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  checkoutDiffQueryKey,
  checkoutCommitsQueryKey,
  checkoutPrStatusQueryKey,
  checkoutStatusQueryKey,
  invalidateCheckoutGitQueriesForClient,
  invalidateCheckoutGitQueriesForServer,
} from "@/git/query-keys";
import { repositoryGraphQueryKey } from "@/fork/repository-graph/query-keys";
import {
  prPanePipelineQueryKey,
  prPaneTimelineQueryKey,
} from "@/git/pull-request-panel/query-keys";
import { branchCiPipelineQueryKey } from "@/git/branch-ci-panel/query-keys";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("checkout query keys", () => {
  const serverId = "server-1";
  const cwd = "/tmp/repo";

  it("invalidates every query for a checkout without touching other checkouts", async () => {
    const queryClient = new QueryClient();

    queryClient.setQueryData(checkoutStatusQueryKey(serverId, cwd), { isGit: true });
    queryClient.setQueryData(checkoutDiffQueryKey(serverId, cwd, "base", "main", true), {
      files: [],
    });
    queryClient.setQueryData(checkoutPrStatusQueryKey(serverId, cwd), { status: { number: 12 } });
    queryClient.setQueryData(checkoutCommitsQueryKey(serverId, cwd), { commits: [] });
    queryClient.setQueryData(checkoutCommitsQueryKey(serverId, "/tmp/other"), { commits: [] });
    queryClient.setQueryData(prPaneTimelineQueryKey({ serverId, cwd, prNumber: 12 }), {
      items: [],
    });
    queryClient.setQueryData(prPaneTimelineQueryKey({ serverId, cwd, prNumber: 13 }), {
      items: [],
    });
    queryClient.setQueryData(
      prPanePipelineQueryKey({ serverId, cwd, pipelineId: 9001, changeRequestNumber: 1 }),
      {
        stages: [],
      },
    );
    queryClient.setQueryData(
      prPaneTimelineQueryKey({ serverId, cwd: "/tmp/other", prNumber: 12 }),
      { items: [] },
    );
    queryClient.setQueryData(
      prPanePipelineQueryKey({
        serverId,
        cwd: "/tmp/other",
        pipelineId: 9001,
        changeRequestNumber: 1,
      }),
      { stages: [] },
    );

    await invalidateCheckoutGitQueriesForClient(queryClient, { serverId, cwd });

    expect(queryClient.getQueryState(checkoutStatusQueryKey(serverId, cwd))?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(checkoutDiffQueryKey(serverId, cwd, "base", "main", true))
        ?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(checkoutPrStatusQueryKey(serverId, cwd))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(checkoutCommitsQueryKey(serverId, cwd))?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(checkoutCommitsQueryKey(serverId, "/tmp/other"))?.isInvalidated,
    ).toBe(false);
    expect(
      queryClient.getQueryState(prPaneTimelineQueryKey({ serverId, cwd, prNumber: 12 }))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(prPaneTimelineQueryKey({ serverId, cwd, prNumber: 13 }))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(
        prPanePipelineQueryKey({ serverId, cwd, pipelineId: 9001, changeRequestNumber: 1 }),
      )?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(
        prPaneTimelineQueryKey({ serverId, cwd: "/tmp/other", prNumber: 12 }),
      )?.isInvalidated,
    ).toBe(false);
    expect(
      queryClient.getQueryState(
        prPanePipelineQueryKey({
          serverId,
          cwd: "/tmp/other",
          pipelineId: 9001,
          changeRequestNumber: 1,
        }),
      )?.isInvalidated,
    ).toBe(false);

    queryClient.clear();
  });

  it("does not wait for fork-only query refreshes", async () => {
    const queryClient = new QueryClient();
    const graphRefresh = createDeferred<{ commits: [] }>();
    const pipelineRefresh = createDeferred<{ pipeline: null }>();
    const graphKey = repositoryGraphQueryKey(serverId, cwd);
    const pipelineKey = branchCiPipelineQueryKey({ serverId, cwd, branch: "feature" });
    let graphFetches = 0;
    let pipelineFetches = 0;
    const graphObserver = new QueryObserver(queryClient, {
      queryKey: graphKey,
      initialData: { commits: [] },
      staleTime: Infinity,
      queryFn: () => {
        graphFetches += 1;
        return graphRefresh.promise;
      },
    });
    const pipelineObserver = new QueryObserver(queryClient, {
      queryKey: pipelineKey,
      initialData: { pipeline: null },
      staleTime: Infinity,
      queryFn: () => {
        pipelineFetches += 1;
        return pipelineRefresh.promise;
      },
    });
    const unsubscribeGraph = graphObserver.subscribe(() => undefined);
    const unsubscribePipeline = pipelineObserver.subscribe(() => undefined);

    await invalidateCheckoutGitQueriesForClient(queryClient, { serverId, cwd });

    expect(graphFetches).toBe(1);
    expect(pipelineFetches).toBe(1);
    expect(queryClient.getQueryState(graphKey)?.fetchStatus).toBe("fetching");
    expect(queryClient.getQueryState(pipelineKey)?.fetchStatus).toBe("fetching");

    graphRefresh.resolve({ commits: [] });
    pipelineRefresh.resolve({ pipeline: null });
    await Promise.all([graphRefresh.promise, pipelineRefresh.promise]);
    unsubscribeGraph();
    unsubscribePipeline();
    queryClient.clear();
  });

  it("invalidates fetch-based checkout queries server-wide without touching other servers", async () => {
    const queryClient = new QueryClient();
    const otherServerId = "server-2";
    const otherCwd = "/tmp/repo-2";

    queryClient.setQueryData(checkoutStatusQueryKey(serverId, cwd), { isGit: true });
    queryClient.setQueryData(checkoutStatusQueryKey(serverId, otherCwd), { isGit: true });
    queryClient.setQueryData(checkoutPrStatusQueryKey(serverId, cwd), { status: { number: 12 } });
    queryClient.setQueryData(checkoutCommitsQueryKey(serverId, cwd), { commits: [] });
    queryClient.setQueryData(checkoutCommitsQueryKey(otherServerId, cwd), { commits: [] });
    queryClient.setQueryData(repositoryGraphQueryKey(serverId, cwd), { commits: [] });
    queryClient.setQueryData(branchCiPipelineQueryKey({ serverId, cwd, branch: "feature" }), {
      pipeline: null,
    });
    queryClient.setQueryData(repositoryGraphQueryKey(otherServerId, cwd), { commits: [] });
    queryClient.setQueryData(
      branchCiPipelineQueryKey({ serverId: otherServerId, cwd, branch: "feature" }),
      { pipeline: null },
    );
    queryClient.setQueryData(prPaneTimelineQueryKey({ serverId, cwd, prNumber: 12 }), {
      items: [],
    });
    queryClient.setQueryData(
      prPanePipelineQueryKey({ serverId, cwd, pipelineId: 9001, changeRequestNumber: 1 }),
      {
        stages: [],
      },
    );
    // Subscription-fed diff queries are deliberately not part of the server-wide sweep.
    queryClient.setQueryData(checkoutDiffQueryKey(serverId, cwd, "base", "main", true), {
      files: [],
    });
    queryClient.setQueryData(checkoutStatusQueryKey(otherServerId, cwd), { isGit: true });

    await invalidateCheckoutGitQueriesForServer(queryClient, serverId);

    expect(queryClient.getQueryState(checkoutStatusQueryKey(serverId, cwd))?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(checkoutStatusQueryKey(serverId, otherCwd))?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(checkoutPrStatusQueryKey(serverId, cwd))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(checkoutCommitsQueryKey(serverId, cwd))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(repositoryGraphQueryKey(serverId, cwd))?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(branchCiPipelineQueryKey({ serverId, cwd, branch: "feature" }))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(checkoutCommitsQueryKey(otherServerId, cwd))?.isInvalidated,
    ).toBe(false);
    expect(
      queryClient.getQueryState(repositoryGraphQueryKey(otherServerId, cwd))?.isInvalidated,
    ).toBe(false);
    expect(
      queryClient.getQueryState(
        branchCiPipelineQueryKey({ serverId: otherServerId, cwd, branch: "feature" }),
      )?.isInvalidated,
    ).toBe(false);
    expect(
      queryClient.getQueryState(prPaneTimelineQueryKey({ serverId, cwd, prNumber: 12 }))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(
        prPanePipelineQueryKey({ serverId, cwd, pipelineId: 9001, changeRequestNumber: 1 }),
      )?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(checkoutDiffQueryKey(serverId, cwd, "base", "main", true))
        ?.isInvalidated,
    ).toBe(false);
    expect(
      queryClient.getQueryState(checkoutStatusQueryKey(otherServerId, cwd))?.isInvalidated,
    ).toBe(false);

    queryClient.clear();
  });
});
