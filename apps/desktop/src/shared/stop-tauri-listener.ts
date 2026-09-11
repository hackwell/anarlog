// Tearing down a Tauri event listener that is already gone answers with "The
// resource id N is invalid". It happens: React runs an effect's cleanup twice
// under StrictMode, and a window can be closed while a subscription is still in
// flight. There is nothing left to unlisten and nothing to be done about it —
// but the unlisten function is raw Tauri rather than a generated binding, so it
// rejects with a bare string, and an unhandled rejection is reported as a crash.
export function stopTauriListener(subscription: Promise<() => void>): void {
  void subscription.then((stop) => stop()).catch(() => {});
}
