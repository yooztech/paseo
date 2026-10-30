import { useEffect, useState } from "react";
import { getDesktopRuntimeInfo } from "@/desktop/updates/desktop-updates";

export function useForkAppVersion(
  isDesktopApp: boolean,
  fallbackVersion: string | null,
): string | null {
  const [desktopAppVersion, setDesktopAppVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!isDesktopApp) return;

    let cancelled = false;
    void getDesktopRuntimeInfo()
      .then((runtimeInfo) => {
        if (!cancelled) setDesktopAppVersion(runtimeInfo.appVersion);
        return runtimeInfo;
      })
      .catch((error) => {
        console.warn("[Settings] Failed to load desktop app version", error);
      });

    return () => {
      cancelled = true;
    };
  }, [isDesktopApp]);

  return desktopAppVersion ?? fallbackVersion;
}
