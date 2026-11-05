/**
 * @vitest-environment jsdom
 */
import React, { type ReactNode } from "react";
import { act } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { WorkspaceTabPresentation } from "@/screens/workspace/workspace-tab-presentation";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { MobileWorkspaceTabSwitcher } from "./tab-switcher";

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => vi.unstubAllGlobals());

vi.mock("react-native", () => ({
  Keyboard: { dismiss: vi.fn() },
  Pressable: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("lucide-react-native", () => ({ SquarePen: () => null, SquareTerminal: () => null }));
vi.mock("@/components/ui/button", () => ({ Button: () => null }));
vi.mock("@/components/ui/icon-button-chrome", () => ({ useIconButtonChromeStyle: () => ({}) }));
vi.mock("@/file-panels", () => ({
  useFilePanelOpenWithMenu: () => ({ trigger: null, pages: [] }),
}));
vi.mock("@/screens/workspace/workspace-tab-menu", () => ({
  buildWorkspaceTabMenuEntries: () => [],
}));
vi.mock("@/screens/workspace/workspace-tab-trailing-accessory", () => ({
  MobileTabTrailingAccessory: ({ presentationLabel }: { presentationLabel: string }) => (
    <span data-testid="accessory-label">{presentationLabel}</span>
  ),
}));
vi.mock("@/screens/workspace/workspace-tab-presentation", () => ({
  WorkspaceTabPresentationResolver: ({
    children,
  }: {
    children: (presentation: WorkspaceTabPresentation) => ReactNode;
  }) => children({ label: "Resolved descriptor" } as WorkspaceTabPresentation),
  WorkspaceTabOptionRow: ({ trailingAccessory }: { trailingAccessory: ReactNode }) => (
    <div>{trailingAccessory}</div>
  ),
}));
vi.mock("@/components/ui/combobox", () => ({
  Combobox: ({
    options,
    renderOption,
  }: {
    options: ComboboxOption[];
    renderOption: (input: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => ReactNode;
  }) => (
    <div>
      {options.map((option) => (
        <div key={option.id} data-testid={`option-${option.id}`}>
          <span data-testid="option-label">{option.label}</span>
          <span data-testid="option-description">{option.description}</span>
          {renderOption({ option, selected: false, active: false, onPress: vi.fn() })}
        </div>
      ))}
    </div>
  ),
}));

describe("compact workspace fork tab fallbacks", () => {
  it("keeps fork labels, descriptions and menu labels in the extracted switcher", () => {
    const cases: {
      target: WorkspaceTabDescriptor["target"];
      label: string;
      description: string;
    }[] = [
      {
        target: { kind: "repository_graph" },
        label: "workspace.tabs.explorerSidebar.repositoryGraph",
        description: "workspace.tabs.explorerSidebar.repositoryGraph",
      },
      {
        target: { kind: "branch_ci" },
        label: "workspace.tabs.explorerSidebar.ci",
        description: "workspace.tabs.explorerSidebar.ci",
      },
      {
        target: { kind: "repository_graph_file_diff", sha: "abc123", path: "src/nested/file.ts" },
        label: "file.ts",
        description: "src/nested/file.ts",
      },
      {
        target: { kind: "repository_graph_file_diff", sha: "def456", path: "src/nested/" },
        label: "nested",
        description: "src/nested/",
      },
      {
        target: { kind: "plugin", pluginId: "plugin-a", panelId: "metrics", context: "workspace" },
        label: "metrics",
        description: "metrics",
      },
    ];
    const tabs = cases.map(({ target }, index) => ({
      key: `tab-${index}`,
      tabId: `tab-${index}`,
      kind: target.kind,
      target,
    }));
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      act(() => {
        root.render(
          <MobileWorkspaceTabSwitcher
            tabs={tabs}
            activeTabKey={tabs[0]!.key}
            normalizedServerId="server-a"
            normalizedWorkspaceId="workspace-a"
            createTerminalDisabled={false}
            onCreateDraftTab={vi.fn()}
            onCreateTerminal={vi.fn()}
            onSelectSwitcherTab={vi.fn()}
            onCopyResumeCommand={vi.fn()}
            onCopyAgentId={vi.fn()}
            onCopyTerminalId={vi.fn()}
            onCopyFilePath={vi.fn()}
            onReloadAgent={vi.fn()}
            onRenameTab={vi.fn()}
            onCloseTab={vi.fn()}
            onCloseTabsAbove={vi.fn()}
            onCloseTabsBelow={vi.fn()}
            onCloseOtherTabs={vi.fn()}
          />,
        );
      });
      cases.forEach(({ label, description }, index) => {
        const option = container.querySelector(`[data-testid="option-tab-${index}"]`)!;
        expect(option.querySelector('[data-testid="option-label"]')?.textContent).toBe(label);
        expect(option.querySelector('[data-testid="option-description"]')?.textContent).toBe(
          description,
        );
        expect(option.querySelector('[data-testid="accessory-label"]')?.textContent).toBe(label);
      });
    } finally {
      act(() => root.unmount());
    }
  });
});
