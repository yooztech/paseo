import { launchInForkRuntime } from "./fork/release/launch.mjs";
import { releaseForkDaemon } from "./fork/release/release.mjs";

if (process.argv[2] !== "--fork-runtime")
  await launchInForkRuntime("scripts/release-fork-daemon.mjs");
else releaseForkDaemon();
