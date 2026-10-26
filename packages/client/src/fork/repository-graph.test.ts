import { expect, test, vi } from "vitest";
import { DaemonClient, type DaemonTransport } from "../daemon-client.js";
import { checkoutRepositoryGraph } from "./repository-graph.js";

test("rejects unsuccessful repository graph checkouts without a server error", async () => {
  await expect(
    checkoutRepositoryGraph(
      { cwd: "/tmp/project", target: { kind: "branch", name: "main" } },
      async () => ({
        cwd: "/tmp/project",
        requestId: "checkout-test",
        success: false,
        error: null,
      }),
    ),
  ).rejects.toBeInstanceOf(Error);
});

test("routes out-of-order checkout responses to the correct concurrent request", async () => {
  const sent: string[] = [];
  let receive: Parameters<DaemonTransport["onMessage"]>[0] = () => {};
  let open: Parameters<DaemonTransport["onOpen"]>[0] = () => {};
  const transport: DaemonTransport = {
    send(data) {
      if (typeof data === "string") sent.push(data);
    },
    close() {},
    onMessage(handler) {
      receive = handler;
      return () => {};
    },
    onOpen(handler) {
      open = handler;
      return () => {};
    },
    onClose: () => () => {},
    onError: () => () => {},
  };
  const client = new DaemonClient({
    url: "ws://test",
    clientId: "clsk_graph_test",
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reconnect: { enabled: false },
    transportFactory: () => transport,
  });
  try {
    const connected = client.connect();
    open();
    receive(
      JSON.stringify({
        type: "session",
        message: {
          type: "status",
          payload: {
            status: "server_info",
            serverId: "srv_graph_test",
            hostname: null,
            version: null,
            features: { ownedSubscriptions: true },
          },
        },
      }),
      false,
    );
    await connected;
    sent.length = 0;

    const detached = client.checkoutRepositoryGraph({
      cwd: "/tmp/project",
      target: { kind: "commit", sha: "abc123" },
    });
    const attached = client.checkoutRepositoryGraph({
      cwd: "/tmp/project",
      target: { kind: "branch", name: "main" },
    });
    const results = Promise.allSettled([detached, attached]);
    const [detachRequest, attachRequest] = sent.map((data) => JSON.parse(data).message);
    for (const [request, success] of [
      [attachRequest, false],
      [detachRequest, true],
    ] as const) {
      receive(
        JSON.stringify({
          type: "session",
          message: {
            type: "checkout.repository_graph.checkout.response",
            payload: {
              cwd: "/tmp/project",
              success,
              error: success
                ? null
                : { code: "UNKNOWN", message: "Branch is checked out elsewhere" },
              requestId: request.requestId,
            },
          },
        }),
        false,
      );
    }
    expect(await results).toEqual([
      { status: "fulfilled", value: undefined },
      {
        status: "rejected",
        reason: new Error("Branch is checked out elsewhere"),
      },
    ]);
  } finally {
    await client.close();
  }
});
