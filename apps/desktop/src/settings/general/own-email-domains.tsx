import { t } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";

import { Input } from "@anlg/ui/components/ui/input";

import { parseOwnDomains, serializeOwnDomains } from "~/customers/own-domains";
import { useSetSettingValue, useStoredSettingValue } from "~/settings/queries";
import { SETTING_CONTROL_CLASS, SettingRow } from "~/settings/setting-row";

export function OwnEmailDomainsRow() {
  const { value } = useStoredSettingValue("own_email_domains");
  const setOwnEmailDomains = useSetSettingValue("own_email_domains");
  const [draft, setDraft] = useState(() =>
    parseOwnDomains(value ?? "[]").join(", "),
  );
  const isEditingRef = useRef(false);

  // The first-run seed writes this setting after mount, so a field left open
  // from before the seed ran must pick up that value instead of blurring its
  // stale empty draft back over it.
  useEffect(() => {
    if (isEditingRef.current) return;
    setDraft(parseOwnDomains(value ?? "[]").join(", "));
  }, [value]);

  const commit = () => {
    isEditingRef.current = false;
    const domains = parseOwnDomains(JSON.stringify(draft.split(",")));
    setDraft(domains.join(", "));
    setOwnEmailDomains(serializeOwnDomains(domains));
  };

  return (
    <SettingRow
      title={t`Our own email domains`}
      description={t`Meetings that involve only these domains count as internal and don't get a customer.`}
    >
      {(labelProps) => (
        <Input
          {...labelProps}
          className={SETTING_CONTROL_CLASS}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => {
            isEditingRef.current = true;
          }}
          onBlur={commit}
        />
      )}
    </SettingRow>
  );
}
