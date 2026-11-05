import type {
  RepositoryGraphCheckoutTarget,
  SessionInboundMessage,
  SessionOutboundMessage,
} from "@getpaseo/protocol/messages";

export interface RepositoryGraphCheckoutInput {
  cwd: string;
  target: RepositoryGraphCheckoutTarget;
}

type CheckoutRequest = Omit<
  Extract<SessionInboundMessage, { type: "checkout.repository_graph.checkout.request" }>,
  "requestId"
>;
type CheckoutResponse = Extract<
  SessionOutboundMessage,
  { type: "checkout.repository_graph.checkout.response" }
>["payload"];

type SendCheckoutRequest = (params: {
  message: CheckoutRequest;
  timeout: number;
}) => Promise<CheckoutResponse>;

export async function checkoutRepositoryGraph(
  input: RepositoryGraphCheckoutInput,
  sendRequest: SendCheckoutRequest,
): Promise<void> {
  const payload = await sendRequest({
    message: {
      type: "checkout.repository_graph.checkout.request",
      cwd: input.cwd,
      target: input.target,
    },
    timeout: 60000,
  });
  if (payload.error) {
    throw new Error(payload.error.message);
  }
  if (!payload.success) {
    throw new Error("Repository graph checkout failed");
  }
}
