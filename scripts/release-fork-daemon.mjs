import { runRelease } from "./fork/release/failure.mjs";
import { launchInForkRuntime } from "./fork/release/launch.mjs";
import { releaseForkDaemon } from "./fork/release/release.mjs";

await runRelease(() =>
  process.argv[2] !== "--fork-runtime"
    ? launchInForkRuntime("scripts/release-fork-daemon.mjs")
    : releaseForkDaemon(),
);
