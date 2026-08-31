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

/**
 * macOS ties keychain access to the code signature. An ad-hoc signature has no
 * stable identity - it is derived from the binary, which changes on every
 * build - so every rebuild looks like a different program and the keychain asks
 * for a password again. A Developer ID gives the same identity every time, and
 * the prompt stops after the first "Always Allow".
 */
function developerIdIdentity() {
  const found = spawnSync(
    "security",
    ["find-identity", "-v", "-p", "codesigning"],
    { encoding: "utf8" },
  );
  if (found.status !== 0) {
    return null;
  }
  const line = found.stdout
    .split("\n")
    .find((entry) => entry.includes("Developer ID Application"));
  return line ? (line.match(/"([^"]+)"/)?.[1] ?? null) : null;
}

function signBinary(binary) {
  const scriptDirectory = dirname(scriptPath);
  const entitlements = resolve(
    scriptDirectory,
    "../src-tauri/Entitlements.plist",
  );
  // Falls back to ad-hoc where no certificate is installed, so a machine
  // without one still builds - it just keeps the prompts.
  const identity = developerIdIdentity() ?? "-";
  const signing = spawnSync(
    "codesign",
    [
      "--force",
      "--sign",
      identity,
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
