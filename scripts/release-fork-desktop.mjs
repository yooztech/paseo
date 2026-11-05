import { launchInForkRuntime } from "./fork/release/launch.mjs";
import { releaseForkDesktop } from "./fork/release/release.mjs";

if (process.argv[2] !== "--fork-runtime")
  await launchInForkRuntime("scripts/release-fork-desktop.mjs");
else releaseForkDesktop();
