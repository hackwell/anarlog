import { useLingui } from "@lingui/react/macro";
import {
  Buildings,
  Check,
  Plus,
  Sparkle,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@anlg/ui/components/ui/command";
import {
  AppFloatingPanel,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@anlg/ui/components/ui/popover";
import { cn } from "@anlg/utils";

import { createOrganization, useOrganizations } from "~/contacts/queries";
import type { CustomerResolution } from "~/customers/resolve";
import { useSessionCustomer } from "~/customers/use-session-customer";

const filterOrganizations = (value: string, search: string) => {
  const haystack = value.toLocaleLowerCase();
  const needle = search.toLocaleLowerCase();
  return haystack.includes(needle) ? 1 : 0;
};

export function CustomerPicker({
  sessionId,
  align = "start",
}: {
  sessionId: string;
  align?: "start" | "end";
}) {
  const { t } = useLingui();
  const { organizationId, suggestion, assign, dismissSuggestion } =
    useSessionCustomer(sessionId);
  const organizations = useOrganizations();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const currentOrganization = useMemo(
    () => organizations.find((org) => org.id === organizationId),
    [organizations, organizationId],
  );
  const currentName = currentOrganization?.name ?? "";
  // useOrganizations() filters out soft-deleted rows, so a stored
  // organization_id that no longer resolves means the customer behind it was
  // deleted, not that the meeting is unassigned. Those must look different:
  // an invisible assignment is exactly the risk this control exists to avoid.
  const assignedOrganizationMissing =
    organizationId !== "" && !currentOrganization;

  // A `suggest` resolution can point at a deleted organization (the known
  // contact's organization_id still references it). Never show a raw id to a
  // person: if it cannot be resolved to a name, the suggestion is dropped
  // rather than offered.
  const suggestionOrganizationName = useMemo(() => {
    if (!suggestion || suggestion.kind !== "suggest") return undefined;
    return organizations.find((org) => org.id === suggestion.organizationId)
      ?.name;
  }, [suggestion, organizations]);
  const showSuggestion =
    organizationId === "" &&
    suggestion !== null &&
    (suggestion.kind !== "suggest" || suggestionOrganizationName !== undefined);

  const trimmedQuery = query.trim();
  // Named to match the suggestion chip's create label below: both read from
  // the same catalog entry, whether the text came from typing or a domain
  // suggestion.
  const domain = trimmedQuery;
  const canCreate =
    trimmedQuery !== "" &&
    !organizations.some(
      (org) => org.name.toLowerCase() === trimmedQuery.toLowerCase(),
    );

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery("");
    }
  }, []);

  const handleSelect = useCallback(
    (nextOrganizationId: string) => {
      setOpen(false);
      setQuery("");
      assign(nextOrganizationId);
    },
    [assign],
  );

  const handleCreate = useCallback(
    (name: string) => {
      setOpen(false);
      setQuery("");
      void createOrganization({ name })
        .then((newOrganizationId) => {
          assign(newOrganizationId);
        })
        .catch((error) => {
          console.error("[customer-picker] failed to create customer", error);
        });
    },
    [assign],
  );

  const handleConfirmSuggestion = useCallback(() => {
    if (!suggestion) return;
    if (suggestion.kind === "suggest") {
      assign(suggestion.organizationId);
      return;
    }
    if (suggestion.kind === "suggest_create") {
      // Same duplicate guard the list's create entry applies: the resolver
      // only matches on contact email domains, so it can still offer
      // "create" for a domain that already has an organization of that name
      // (no known contact at that domain yet). Assign the existing one
      // instead of creating a second organization with the same name.
      const existing = organizations.find(
        (org) => org.name.toLowerCase() === suggestion.domain.toLowerCase(),
      );
      if (existing) {
        assign(existing.id);
        return;
      }

      void createOrganization({ name: suggestion.domain })
        .then((newOrganizationId) => {
          assign(newOrganizationId);
        })
        .catch((error) => {
          console.error("[customer-picker] failed to create customer", error);
        });
    }
  }, [suggestion, assign, organizations]);

  // A suggestion is never silently applied: only a confirm click writes it.
  // Dismissing it drops back to the quiet placeholder below, from where the
  // full list is still reachable.
  if (showSuggestion && suggestion) {
    return (
      <CustomerSuggestionChip
        suggestion={suggestion}
        organizationName={suggestionOrganizationName ?? ""}
        onConfirm={handleConfirmSuggestion}
        onDismiss={dismissSuggestion}
      />
    );
  }

  const triggerLabel = assignedOrganizationMissing
    ? t`Customer no longer exists`
    : currentName || t`Customer`;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-tauri-drag-region="false"
          role="combobox"
          aria-expanded={open}
          aria-label={t`Assign customer`}
          title={triggerLabel}
          className={cn([
            "flex h-7 items-center gap-1 rounded-full px-1.5",
            "max-w-full min-w-0 transition-colors",
            "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden",
            assignedOrganizationMissing
              ? ["text-destructive", "hover:bg-destructive/10"]
              : [
                  "text-muted-foreground",
                  "hover:bg-accent hover:text-foreground",
                  open && "bg-accent text-foreground",
                ],
          ])}
        >
          {assignedOrganizationMissing ? (
            <Warning className="size-4 shrink-0" aria-hidden="true" />
          ) : (
            <Buildings className="size-4 shrink-0" aria-hidden="true" />
          )}
          <span
            className={cn([
              "min-w-0 truncate text-xs",
              assignedOrganizationMissing
                ? "text-destructive"
                : "text-neutral-600 dark:text-neutral-300",
            ])}
          >
            {triggerLabel}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        variant="app"
        align={align}
        className="w-85 overflow-hidden"
      >
        <AppFloatingPanel className="overflow-hidden">
          <Command
            filter={filterOrganizations}
            className="rounded-[inherit] border-0 bg-transparent **:[[cmdk-input-wrapper]]:h-7 **:[[cmdk-input-wrapper]]:border-0 **:[[cmdk-input-wrapper]]:px-0"
          >
            <div className="flex flex-col gap-4 p-4">
              <CommandInput
                placeholder={t`Search or create customer`}
                value={query}
                onValueChange={setQuery}
                className="h-7 py-0"
              />
              <div className="bg-accent h-px" />
              <CommandList>
                <CommandEmpty className="text-muted-foreground py-0 text-left text-sm">
                  {trimmedQuery ? t`No customers found.` : t`No customers yet.`}
                </CommandEmpty>
                {organizations.length > 0 ? (
                  <CommandGroup>
                    {organizations.map((org) => (
                      <CommandItem
                        key={org.id}
                        value={org.name}
                        onSelect={() => handleSelect(org.id)}
                        className="cursor-pointer"
                      >
                        <Buildings className="size-4 shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1 truncate">
                          {org.name}
                        </span>
                        {org.id === organizationId ? (
                          <Check className="size-4 shrink-0" />
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null}
                {canCreate ? (
                  <CommandGroup>
                    <CommandItem
                      value={`create-customer ${trimmedQuery}`}
                      onSelect={() => handleCreate(trimmedQuery)}
                      className="cursor-pointer"
                    >
                      <Plus className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {t`Create "${domain}" as customer`}
                      </span>
                    </CommandItem>
                  </CommandGroup>
                ) : null}
              </CommandList>
            </div>
          </Command>
        </AppFloatingPanel>
      </PopoverContent>
    </Popover>
  );
}

// Same chip shape as the tag row's suggestions (Sparkle confirm + X dismiss):
// a suggestion is proposed, never applied, until this button is clicked.
function CustomerSuggestionChip({
  suggestion,
  organizationName,
  onConfirm,
  onDismiss,
}: {
  suggestion: CustomerResolution;
  organizationName: string;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const { t } = useLingui();
  const domain = suggestion.kind === "suggest_create" ? suggestion.domain : "";
  const label =
    suggestion.kind === "suggest_create"
      ? t`Create "${domain}" as customer`
      : organizationName;

  return (
    <span
      className={cn([
        "flex items-center gap-0.5 rounded-full border border-dashed py-0.5 pr-1 pl-2.5 text-xs",
        "border-muted-foreground/40 text-muted-foreground",
      ])}
    >
      <button
        type="button"
        onClick={onConfirm}
        className="flex items-center gap-1 hover:underline"
      >
        <Sparkle className="size-3 opacity-70" />
        {label}
      </button>
      <button
        type="button"
        aria-label={t`Dismiss suggestion`}
        onClick={onDismiss}
        className="hover:bg-background/60 rounded-full p-0.5"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
