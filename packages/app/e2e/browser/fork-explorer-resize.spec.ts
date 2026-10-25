import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  ensureExplorerSidebar,
  waitForWorkspaceTabsVisible,
} from "../support/helpers/workspace-tabs";

async function readPersistedPanelState(page: Page) {
  const persisted = await page.evaluate(() => localStorage.getItem("panel-state"));
  return persisted ? JSON.parse(persisted) : null;
}

function readTabIds(tabs: Locator): Promise<(string | null)[]> {
  return tabs.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-testid")),
  );
}

test("fork Explorer defaults remain accessible and closed tabs restore without resetting saved layout", async ({
  page,
}) => {
  const workspace = await seedWorkspace({ repoPrefix: "fork-explorer-resize-" });
  const explorer = page.getByTestId("workspace-explorer-sidebar").filter({ visible: true });
  const menu = page.getByTestId("workspace-new-tab-menu").filter({ visible: true });
  const menuButton = explorer.getByRole("button", { name: "New tab", exact: true });

  try {
    await gotoWorkspace(page, workspace.workspaceId);
    await waitForWorkspaceTabsVisible(page);
    await ensureExplorerSidebar(page);
    await expect(explorer.locator('[data-testid^="workspace-tab-"]')).toHaveCount(4);

    for (const kind of ["repository_graph", "branch_ci"] as const) {
      const tab = explorer.getByTestId(`workspace-tab-${kind}`);
      await expect(tab).toBeVisible();
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      const label = await tab.getAttribute("aria-label");
      expect(label).toBeTruthy();

      await menuButton.click();
      const item = menu.getByRole("menuitem", { name: label!, exact: true });
      await expect(item).toHaveAttribute("aria-checked", "true");
      await item.click();
      await expect(tab).toHaveCount(0);

      await page.reload();
      await waitForWorkspaceTabsVisible(page);
      await ensureExplorerSidebar(page);
      await expect(tab).toHaveCount(0);
      await expect(explorer.locator('[data-testid^="workspace-tab-"]')).toHaveCount(3);
      await menuButton.click();
      await expect(item).toHaveAttribute("aria-checked", "false");
      await item.click();
      await expect(tab).toBeVisible();
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");

      await page.reload();
      await waitForWorkspaceTabsVisible(page);
      await ensureExplorerSidebar(page);
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect(explorer.locator('[data-testid^="workspace-tab-"]')).toHaveCount(4);
    }
  } finally {
    await workspace.cleanup();
  }
});

for (const explorerTab of ["repository_graph", "branch_ci"] as const) {
  test(`legacy fork ${explorerTab} selection migrates without losing panel preferences`, async ({
    page,
  }) => {
    const workspace = await seedWorkspace({
      repoPrefix: `fork-explorer-migration-${explorerTab}-`,
    });
    const preferences = {
      sidebarWidth: 400,
      treeRailWidth: 300,
      expandedPathsByWorkspace: { workspace: ["src", "src/app"] },
      explorerSortOption: "modified",
      explorerShowHiddenFiles: false,
      fileTreeVisible: true,
    };

    try {
      await page.addInitScript(
        ({ explorerTab: legacyTab, preferences: savedPreferences }) => {
          const marker = "fork-explorer-migration-seeded";
          if (localStorage.getItem(marker)) {
            return;
          }
          localStorage.setItem(
            "panel-state",
            JSON.stringify({
              version: 16,
              state: {
                ...savedPreferences,
                explorerTab: legacyTab,
                explorerTabByCheckout: { checkout: legacyTab },
                explorerWidth: 450,
                desktop: {
                  agentListOpen: true,
                  focusModeEnabled: false,
                  fileExplorerOpen: true,
                },
              },
            }),
          );
          localStorage.setItem(marker, "1");
        },
        { explorerTab, preferences },
      );
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForWorkspaceTabsVisible(page);

      const main = page.getByTestId("workspace-pane-main");

      for (const phase of ["after migration", "after reload"] as const) {
        await test.step(phase, async () => {
          if (phase === "after reload") {
            await page.reload();
            await waitForWorkspaceTabsVisible(page);
          }
          const mainTabs = main.locator('[data-testid^="workspace-tab-"]');
          const mainTabIds = await readTabIds(mainTabs);
          const activeMainTab = main.locator(
            '[data-testid^="workspace-tab-"][aria-selected="true"]',
          );
          const activeMainId = await activeMainTab.getAttribute("data-testid");
          expect(mainTabIds.length).toBeGreaterThan(0);
          expect(activeMainId).toBeTruthy();

          await expect
            .poll(() => readPersistedPanelState(page))
            .toEqual({
              version: 17,
              state: expect.objectContaining({
                ...preferences,
                expandedPathsByWorkspace: expect.objectContaining(
                  preferences.expandedPathsByWorkspace,
                ),
              }),
            });
          const persisted = await readPersistedPanelState(page);
          expect(persisted.state).not.toHaveProperty("explorerTab");
          expect(persisted.state).not.toHaveProperty("explorerTabByCheckout");
          expect(persisted.state).not.toHaveProperty("explorerWidth");
          expect(persisted.state.desktop).not.toHaveProperty("fileExplorerOpen");

          const explorer = await ensureExplorerSidebar(page);
          const explorerTabs = explorer.locator('[data-testid^="workspace-tab-"]');
          await expect(explorerTabs).toHaveCount(4);
          for (const kind of ["files", "changes_tree", "repository_graph", "branch_ci"]) {
            const tab = explorer.getByTestId(`workspace-tab-${kind}`);
            await expect(tab).toBeVisible();
            await tab.click();
            await expect(tab).toHaveAttribute("aria-selected", "true");
            expect(await readTabIds(mainTabs)).toEqual(mainTabIds);
            await expect(activeMainTab).toHaveAttribute("data-testid", activeMainId!);
          }
        });
      }
    } finally {
      await workspace.cleanup();
    }
  });
}
