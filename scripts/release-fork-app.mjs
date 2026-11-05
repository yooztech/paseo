import { launchInForkRuntime } from "./fork/release/launch.mjs";
import { releaseForkApp } from "./fork/release/release.mjs";

if (process.argv[2] !== "--fork-runtime") await launchInForkRuntime("scripts/release-fork-app.mjs");
else releaseForkApp();
