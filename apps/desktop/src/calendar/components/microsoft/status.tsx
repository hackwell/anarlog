import { Trans, useLingui } from "@lingui/react/macro";
import { CircleNotch, Info, WarningCircle } from "@phosphor-icons/react";
import { useForm } from "@tanstack/react-form";
import { useState, type ReactNode } from "react";

import { Button } from "@anlg/ui/components/ui/button";
import { Input } from "@anlg/ui/components/ui/input";
import { cn } from "@anlg/utils";

import { type MicrosoftConnection } from "./connection";
import { isMicrosoftFailureRetryable } from "./errors";

function StatusBlock({
  icon,
  children,
  className,
}: {
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn([
        "text-muted-foreground flex gap-2 py-2 text-xs leading-relaxed",
        className,
      ])}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </div>
  );
}

function RetryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 w-fit rounded-full px-3 text-xs"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

/**
 * Everything the Microsoft row has to say that is not a calendar checkbox.
 *
 * A network sign-in fails in ways a local EventKit read never does, so each
 * outcome gets its own sentence: a spinner that never resolves would be the
 * one dishonest option.
 */
export function MicrosoftConnectionStatus({
  connection,
  className,
}: {
  connection: MicrosoftConnection;
  className?: string;
}) {
  const { failure } = connection;

  if (failure) {
    return (
      <StatusBlock
        icon={<WarningCircle className="size-4 text-red-500" />}
        className={className}
      >
        <MicrosoftFailureMessage connection={connection} />
        {isMicrosoftFailureRetryable(failure.kind) && (
          <RetryButton
            onClick={connection.connect}
            disabled={connection.isBusy}
          >
            {failure.kind === "reauth-required" ? (
              <Trans>Sign in again</Trans>
            ) : (
              <Trans>Try again</Trans>
            )}
          </RetryButton>
        )}
      </StatusBlock>
    );
  }

  if (connection.isSigningIn) {
    return (
      <StatusBlock
        icon={
          connection.browserDidNotReturn ? (
            <WarningCircle className="size-4" />
          ) : (
            <CircleNotch className="size-4 animate-spin" />
          )
        }
        className={className}
      >
        {connection.browserDidNotReturn ? (
          <p>
            <Trans>
              Your browser has not come back yet. Finish the sign-in there, or
              start over.
            </Trans>
          </p>
        ) : (
          <p>
            <Trans>
              Waiting for the sign-in in your browser. Session Echo continues on
              its own once you are done.
            </Trans>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <RetryButton onClick={connection.cancelSignIn}>
            <Trans>Cancel</Trans>
          </RetryButton>
          {connection.browserDidNotReturn && (
            <RetryButton
              onClick={connection.connect}
              disabled={connection.isBusy}
            >
              <Trans>Start over</Trans>
            </RetryButton>
          )}
        </div>
        {connection.browserDidNotReturn && (
          <ManualCallback connection={connection} />
        )}
      </StatusBlock>
    );
  }

  if (connection.isConnected && connection.remoteCalendarCount === 0) {
    return (
      <StatusBlock icon={<Info className="size-4" />} className={className}>
        <p>
          <Trans>
            Connected. Microsoft reports no calendars for this account yet.
          </Trans>
        </p>
      </StatusBlock>
    );
  }

  return null;
}

function MicrosoftFailureMessage({
  connection,
}: {
  connection: MicrosoftConnection;
}) {
  const failure = connection.failure;
  if (!failure) return null;

  switch (failure.kind) {
    case "not-configured":
      return (
        <div className="flex flex-col gap-1">
          <p className="text-foreground font-medium">
            <Trans>Microsoft 365 is not set up in this build</Trans>
          </p>
          <p>
            <Trans>
              This copy of Session Echo was built without the
              MICROSOFT_CLIENT_ID variable, so it carries no Microsoft app
              credentials. A build with that variable set can connect; nothing
              you do here will change it.
            </Trans>
          </p>
        </div>
      );
    case "cancelled":
      return (
        <p>
          <Trans>
            The sign-in was cancelled. No Microsoft account was connected.
          </Trans>
        </p>
      );
    case "reauth-required":
      return (
        <p>
          <Trans>
            Your Microsoft session has expired. Sign in again to keep reading
            this calendar.
          </Trans>
        </p>
      );
    case "offline":
      return (
        <p>
          <Trans>
            Microsoft could not be reached. Check your internet connection and
            try again.
          </Trans>
        </p>
      );
    default:
      return (
        <div className="flex flex-col gap-1">
          <p>
            <Trans>The Microsoft sign-in failed.</Trans>
          </p>
          {failure.message && (
            <p className="text-muted-foreground/80 break-words">
              {failure.message}
            </p>
          )}
        </div>
      );
  }
}

/**
 * The escape hatch for a build whose custom scheme the OS does not route:
 * paste the URL the browser was left on. Kept behind a disclosure and only
 * offered once the normal path has visibly failed, so it never becomes the
 * expected way to sign in.
 */
function ManualCallback({ connection }: { connection: MicrosoftConnection }) {
  const { t } = useLingui();
  const [isOpen, setIsOpen] = useState(false);
  const form = useForm({
    defaultValues: { callbackUrl: "" },
    onSubmit: ({ value }) => {
      const callbackUrl = value.callbackUrl.trim();
      if (!callbackUrl) return;
      connection.completeWithCallbackUrl(callbackUrl);
      form.setFieldValue("callbackUrl", "");
    },
  });

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="hover:text-foreground w-fit underline transition-colors"
      >
        <Trans>Paste the callback address instead</Trans>
      </button>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <p>
        <Trans>
          Copy the address your browser ended up on and paste it here. It starts
          with sessionecho:// and carries the sign-in code.
        </Trans>
      </p>
      <form.Field name="callbackUrl">
        {(field) => (
          <Input
            className="h-8 text-xs"
            placeholder="sessionecho://ms-calendar/callback?code=..."
            aria-label={t`Microsoft callback address`}
            value={field.state.value}
            onChange={(event) => field.handleChange(event.target.value)}
          />
        )}
      </form.Field>
      <Button
        type="submit"
        variant="outline"
        size="sm"
        className="h-7 w-fit rounded-full px-3 text-xs"
        disabled={connection.isCompletingManually}
      >
        <Trans>Complete sign-in</Trans>
      </Button>
    </form>
  );
}
