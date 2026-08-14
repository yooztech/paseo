import { describe, expect, it } from "vitest";
import { findContextMenuTrigger } from "./context-menu-target";

describe("findContextMenuTrigger", () => {
  it("finds the context-menu trigger behind an overlay element", () => {
    const overlay = document.createElement("div");
    const trigger = document.createElement("div");
    const badge = document.createElement("span");
    trigger.dataset.pcontextmenu = "trigger";
    trigger.append(badge);

    expect(findContextMenuTrigger([overlay, badge])).toBe(trigger);
  });

  it("returns null when the pointer is not over a context-menu trigger", () => {
    expect(findContextMenuTrigger([document.createElement("div")])).toBeNull();
  });
});
