import { expect, test } from "../support/fixtures";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  ensureExplorerSidebar,
  openFilesPanel,
  waitForWorkspaceTabsVisible,
} from "../support/helpers/workspace-tabs";

function explorerSidebar(page: Parameters<typeof ensureExplorerSidebar>[0]) {
  return page.getByTestId("workspace-explorer-sidebar").filter({ visible: true });
}

test.describe("Explorer sidebar", () => {
  test("starts with Files and Changes, switches views, and toggles without changing main", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "explorer-sidebar-defaults-" });

    try {
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForWorkspaceTabsVisible(page);
      const mainTabsBefore = await page
        .getByTestId("workspace-pane-main")
        .locator('[data-testid^="workspace-tab-"]')
        .count();

      const explorer = await ensureExplorerSidebar(page);
      await expect(explorer.getByTestId("explorer-sidebar-tab-files")).toBeVisible();
      await expect(explorer.getByTestId("explorer-sidebar-tab-changes_tree")).toBeVisible();
      await expect(explorer.getByTestId("workspace-new-tab-button")).toHaveCount(0);

      await openFilesPanel(page);
      await expect(explorer.getByTestId("file-explorer-tree-scroll")).toBeVisible();

      await explorer.getByTestId("explorer-sidebar-tab-changes_tree").click();
      await expect(explorer.getByTestId("changes-tree-panel")).toBeVisible();

      await page.getByTestId("workspace-explorer-toggle").first().click();
      await expect(explorerSidebar(page)).toHaveCount(0);
      await expect(
        page.getByTestId("workspace-pane-main").locator('[data-testid^="workspace-tab-"]'),
      ).toHaveCount(mainTabsBefore);
    } finally {
      await workspace.cleanup();
    }
  });
  test("restores Files from the visible Explorer menu after the tab is closed", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "explorer-sidebar-restore-files-" });

    try {
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForWorkspaceTabsVisible(page);
      const explorer = await ensureExplorerSidebar(page);
      const menuButton = explorer.getByTestId("explorer-sidebar-configuration-menu-trigger");
      const menu = page.getByTestId("explorer-sidebar-configuration-dropdown");

      await expect(menuButton).toBeVisible();
      await menuButton.click();
      await menu.getByText("Files", { exact: true }).click();
      await expect(explorer.getByTestId("explorer-sidebar-tab-files")).toHaveCount(0);

      await page.getByTestId("workspace-explorer-toggle").first().click();
      await expect(explorerSidebar(page)).toHaveCount(0);
      await ensureExplorerSidebar(page);
      await expect(explorer.getByTestId("explorer-sidebar-tab-files")).toHaveCount(0);

      await menuButton.click();
      await menu.getByText("Files", { exact: true }).click();
      await expect(
        explorer.getByTestId("explorer-sidebar-tab-rail").getByText("Files", { exact: true }),
      ).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });
});
