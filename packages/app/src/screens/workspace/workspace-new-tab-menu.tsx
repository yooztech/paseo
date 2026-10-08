import { useCallback, useMemo, type ComponentType, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { TerminalProfileIcon } from "@/components/terminal-profile-icon";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import type { Theme } from "@/styles/theme";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { workspaceTabTargetsEqual } from "@/workspace-tabs/identity";
import {
  useWorkspaceTabLaunchCatalog,
  type WorkspaceTabLaunchItem,
  type WorkspaceTabLaunchPurpose,
} from "@/workspace-tabs/launcher";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import type { PaneHost } from "@/panels/panel-manifest";
import type { PanelIconProps } from "@/panels/panel-registry";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function LaunchItemIconGlyph({
  Icon,
  color = "",
}: {
  Icon: ComponentType<PanelIconProps>;
  color?: string;
}) {
  return <Icon size={14} color={color} />;
}

const ThemedLaunchItemIconGlyph = withUnistyles(LaunchItemIconGlyph);

function LaunchItemIcon({ item }: { item: WorkspaceTabLaunchItem }): ReactElement | null {
  if (item.Icon) {
    return <ThemedLaunchItemIconGlyph Icon={item.Icon} uniProps={mutedColorMapping} />;
  }
  if (item.terminalIconKey) {
    return (
      <View>
        <TerminalProfileIcon iconKey={item.terminalIconKey} size={14} />
      </View>
    );
  }
  return null;
}

function WorkspaceNewTabMenuItem({
  item,
  paneId,
  openTab,
  onCloseTab,
}: {
  item: WorkspaceTabLaunchItem;
  paneId?: string;
  openTab?: WorkspaceTabDescriptor;
  onCloseTab?: (tabId: string) => Promise<void> | void;
}) {
  const leading = useMemo(() => <LaunchItemIcon item={item} />, [item]);
  const trailing = useMemo(
    () =>
      onCloseTab || !item.shortcutActionId ? undefined : (
        <LaunchItemShortcut actionId={item.shortcutActionId} />
      ),
    [item.shortcutActionId, onCloseTab],
  );
  const handleSelect = useCallback(() => {
    if (openTab && onCloseTab) {
      void onCloseTab(openTab.tabId);
    } else {
      item.launch({ kind: "open", paneId });
    }
  }, [item, onCloseTab, openTab, paneId]);

  return (
    <DropdownMenuItem
      testID={`workspace-new-tab-menu-${item.id}`}
      leading={leading}
      trailing={trailing}
      selected={onCloseTab ? Boolean(openTab) : undefined}
      showSelectedCheck={Boolean(onCloseTab)}
      disabled={item.disabled}
      onSelect={handleSelect}
    >
      {item.label}
    </DropdownMenuItem>
  );
}

function LaunchItemShortcut({ actionId }: { actionId: string }) {
  const keys = useShortcutKeys(actionId);
  return keys ? <Shortcut chord={keys} /> : null;
}

export function WorkspaceNewTabMenuContent({
  serverId,
  purpose,
  host,
  panePanelKinds,
  paneId,
  explorerTabs,
  onCloseExplorerTab,
  onCreateNewTab,
}: {
  serverId: string;
  purpose: WorkspaceTabLaunchPurpose;
  host: PaneHost;
  panePanelKinds: readonly WorkspaceTabTarget["kind"][];
  paneId?: string;
  explorerTabs?: readonly WorkspaceTabDescriptor[];
  onCloseExplorerTab?: (tabId: string) => Promise<void> | void;
  onCreateNewTab?: () => void;
}) {
  const { t } = useTranslation();
  const groups = useWorkspaceTabLaunchCatalog({
    serverId,
    purpose,
    host,
    surface: "menu",
    panePanelKinds,
  });

  return (
    <DropdownMenuContent
      side="bottom"
      align="start"
      offset={4}
      minWidth={200}
      testID="workspace-new-tab-menu"
    >
      {onCreateNewTab ? (
        <>
          <DropdownMenuItem onSelect={onCreateNewTab}>
            {t("workspace.tabs.actions.newTab")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      ) : null}
      {groups.map((group, index) => (
        <View key={group.id}>
          {index > 0 ? <DropdownMenuSeparator /> : null}
          {group.label ? <DropdownMenuLabel>{group.label}</DropdownMenuLabel> : null}
          {group.items.map((item) => (
            <WorkspaceNewTabMenuItem
              key={item.id}
              item={item}
              paneId={paneId}
              openTab={explorerTabs?.find(
                (tab) =>
                  item.toggleTarget && workspaceTabTargetsEqual(item.toggleTarget, tab.target),
              )}
              onCloseTab={onCloseExplorerTab}
            />
          ))}
          {group.accessory ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                testID={`workspace-new-tab-menu-${group.accessory.id}`}
                onSelect={group.accessory.run}
              >
                {group.accessory.label}
              </DropdownMenuItem>
            </>
          ) : null}
        </View>
      ))}
    </DropdownMenuContent>
  );
}
