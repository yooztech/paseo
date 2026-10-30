import { describe, expect, test } from "vitest";
import {
  createElectronSpawnOptions,
  registerDevRunnerShutdownSignals,
  resolveChildKillTarget,
} from "./dev-runner-config.mjs";

describe("desktop dev process ownership", () => {
  test("keeps Electron in the runner process group", () => {
    const options = createElectronSpawnOptions({
      env: { PATH: "/usr/bin" },
      colorEnv: { FORCE_COLOR: "1" },
      expoDevUrl: "http://localhost:8082",
    });

    expect(options).toMatchObject({
      detached: false,
      env: {
        PATH: "/usr/bin",
        FORCE_COLOR: "1",
        EXPO_DEV_URL: "http://localhost:8082",
      },
    });
  });

  test("targets the whole process group for detached child trees", () => {
    expect(resolveChildKillTarget(42, true)).toBe(-42);
    expect(resolveChildKillTarget(42, false)).toBe(42);
  });

  test("stops children when the owning terminal hangs up", () => {
    const listeners = new Map();
    const receivedSignals = [];

    registerDevRunnerShutdownSignals({
      signalSource: {
        on(signal, listener) {
          listeners.set(signal, listener);
        },
      },
      stop(signal) {
        receivedSignals.push(signal);
      },
    });

    expect(Array.from(listeners.keys())).toEqual(["SIGHUP", "SIGINT", "SIGTERM"]);
    listeners.get("SIGHUP")();
    expect(receivedSignals).toEqual(["SIGTERM"]);
  });
});
