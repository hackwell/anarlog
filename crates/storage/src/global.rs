use std::path::{Path, PathBuf};

pub const VAULT_CONFIG_FILENAME: &str = "global.json";
const STAGING_BUNDLE_ID: &str = "de.flagbit.sessionecho.staging";
const RELEASE_APP_FOLDER: &str = "sessionecho";

pub fn compute_vault_config_path(base: &Path) -> PathBuf {
    base.join(VAULT_CONFIG_FILENAME)
}

pub fn compute_default_base(bundle_id: &str) -> Option<PathBuf> {
    let data_dir = dirs::data_dir()?;
    let app_folder = resolve_app_folder(&data_dir, bundle_id, cfg!(debug_assertions));
    Some(data_dir.join(app_folder))
}

fn resolve_app_folder<'a>(_data_dir: &Path, bundle_id: &'a str, is_debug: bool) -> &'a str {
    if is_debug || bundle_id == STAGING_BUNDLE_ID {
        bundle_id
    } else {
        RELEASE_APP_FOLDER
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn resolve_app_folder_uses_sessionecho_for_stable_installs() {
        let temp = tempdir().unwrap();

        assert_eq!(
            resolve_app_folder(temp.path(), "de.flagbit.sessionecho", false),
            RELEASE_APP_FOLDER
        );
    }

    #[test]
    fn resolve_app_folder_ignores_a_populated_anarlog_folder() {
        let temp = tempdir().unwrap();
        let legacy = temp.path().join("anarlog");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("app.db"), "").unwrap();

        assert_eq!(
            resolve_app_folder(temp.path(), "de.flagbit.sessionecho", false),
            RELEASE_APP_FOLDER
        );
    }

    #[test]
    fn resolve_app_folder_uses_bundle_id_for_staging() {
        let temp = tempdir().unwrap();

        assert_eq!(
            resolve_app_folder(temp.path(), STAGING_BUNDLE_ID, false),
            STAGING_BUNDLE_ID
        );
    }

    #[test]
    fn resolve_app_folder_uses_bundle_id_in_debug() {
        let temp = tempdir().unwrap();

        assert_eq!(
            resolve_app_folder(temp.path(), "de.flagbit.sessionecho.dev", true),
            "de.flagbit.sessionecho.dev"
        );
    }
}
