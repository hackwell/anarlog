import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  flushAutomaticRelaunch: vi.fn(),
  setOnboardingNeeded: vi.fn(),
  setPendingOnboardingSession: vi.fn(),
}));

vi.mock("@anlg/plugin-opener2", () => ({
  commands: { openUrl: vi.fn() },
}));

vi.mock("./pending-session", () => ({
  setPendingOnboardingSession: mocks.setPendingOnboardingSession,
}));

vi.mock("~/session/queries", () => ({
  createSession: mocks.createSession,
}));

vi.mock("~/shared/relaunch", () => ({
  flushAutomaticRelaunch: mocks.flushAutomaticRelaunch,
}));

vi.mock("~/types/tauri.gen", () => ({
  commands: { setOnboardingNeeded: mocks.setOnboardingNeeded },
}));

import { FinalSection, finishOnboarding } from "./final";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.flushAutomaticRelaunch.mockResolvedValue(false);
  mocks.createSession.mockResolvedValue("new-session");
  mocks.setOnboardingNeeded.mockResolvedValue({ status: "ok", data: null });
});

afterEach(cleanup);

it("opens the blank note it created for the finished onboarding", async () => {
  const onContinue = vi.fn();
  mocks.createSession.mockResolvedValueOnce("blank-session");

  await finishOnboarding(onContinue);

  expect(mocks.createSession).toHaveBeenCalledTimes(1);
  expect(onContinue).toHaveBeenCalledWith("blank-session");
});

it("shows a retryable error when onboarding cannot be persisted", async () => {
  const onContinue = vi.fn();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.setOnboardingNeeded.mockResolvedValueOnce({
    status: "error",
    error: "settings unavailable",
  });

  render(<FinalSection onContinue={onContinue} />);
  fireEvent.click(screen.getByRole("button", { name: "Open Session Echo" }));

  expect(
    (
      screen.getByRole("button", {
        name: "Open Session Echo",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await waitFor(() => {
    expect(screen.getByRole("alert").textContent).toBe(
      "Couldn't open Session Echo. Please try again.",
    );
  });
  expect(
    (
      screen.getByRole("button", {
        name: "Open Session Echo",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  expect(onContinue).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

it("reuses the created session when persistence is retried", async () => {
  const onContinue = vi.fn();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.createSession.mockResolvedValue("blank-session");
  mocks.setOnboardingNeeded
    .mockResolvedValueOnce({ status: "error", error: "settings unavailable" })
    .mockResolvedValueOnce({ status: "ok", data: null });

  render(<FinalSection onContinue={onContinue} />);
  fireEvent.click(screen.getByRole("button", { name: "Open Session Echo" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Open Session Echo" }));

  await waitFor(() => {
    expect(onContinue).toHaveBeenCalledWith("blank-session");
  });
  expect(mocks.createSession).toHaveBeenCalledTimes(1);
  consoleError.mockRestore();
});

it("ignores concurrent finish attempts", async () => {
  const onContinue = vi.fn();
  let resolveSession: (sessionId: string) => void = () => {};
  mocks.createSession.mockReturnValue(
    new Promise((resolve) => {
      resolveSession = resolve;
    }),
  );

  render(<FinalSection onContinue={onContinue} />);
  const button = screen.getByRole("button", { name: "Open Session Echo" });
  fireEvent.click(button);
  fireEvent.click(button);
  resolveSession("new-session");

  await waitFor(() => {
    expect(onContinue).toHaveBeenCalledWith("new-session");
  });
  expect(mocks.createSession).toHaveBeenCalledTimes(1);
  expect(onContinue).toHaveBeenCalledTimes(1);
});
