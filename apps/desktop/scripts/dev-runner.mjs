#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const [command, ...args] = process.argv.slice(2);
const signalExitCodes = { SIGINT: 130, SIGTERM: 143 };

if (!command) {
  console.error("Expected a Cargo command or Tauri application binary path.");
  process.exit(1);
}

if (command === "run" || command === "build") {
  // `tauri dev` registers the sessionecho-dev scheme with the OS, so the
  // redirect sent to Microsoft has to match it or the callback never
  // arrives. Stable builds fall back to the default in the calendar crate.
  if (command === "run" && !process.env.SESSIONECHO_DEEPLINK_SCHEME) {
    process.env.SESSIONECHO_DEEPLINK_SCHEME = "sessionecho-dev";
  }
  const cargoArgs = [];
  if (command === "run" && process.platform === "darwin") {
    cargoArgs.push(
      "--config",
      `target.'cfg(target_os = "macos")'.runner = [${JSON.stringify(scriptPath)}]`,
    );
  }
  cargoArgs.push(command, ...args);
  runChild("cargo", cargoArgs);
} else {
  if (process.platform === "darwin") {
    signBinary(command);
  }
  runChild(command, args);
}

function signBinary(binary) {
  const scriptDirectory = dirname(scriptPath);
  const entitlements = resolve(
    scriptDirectory,
    "../src-tauri/Entitlements.plist",
  );
  const signing = spawnSync(
    "codesign",
    [
      "--force",
      "--sign",
      "-",
      "--identifier",
      "de.flagbit.sessionecho.dev",
      "--requirements",
      '=designated => identifier "de.flagbit.sessionecho.dev"',
      "--entitlements",
      entitlements,
      binary,
    ],
    { stdio: "inherit" },
  );

  if (signing.status !== 0) {
    process.exit(signing.status ?? 1);
  }
}

function runChild(executable, childArgs) {
  const child = spawn(executable, childArgs, { stdio: "inherit" });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }

  child.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.exit(signalExitCodes[signal] ?? 1);
      return;
    }

    process.exit(code ?? 1);
  });
}
