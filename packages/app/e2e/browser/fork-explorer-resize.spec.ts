import { expect, test } from "../support/fixtures";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  ensureExplorerSidebar,
  waitForWorkspaceTabsVisible,
} from "../support/helpers/workspace-tabs";

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
