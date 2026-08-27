import { Trans } from "@lingui/react/macro";

import { MeetingImportScreen } from "~/imports/screen";
import { SettingsPageTitle } from "~/settings/page-title";

export function SettingsImports() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4">
        <SettingsPageTitle title={<Trans>Imports</Trans>} />
      </div>
      <MeetingImportScreen />
    </div>
  );
}
