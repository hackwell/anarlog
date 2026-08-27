use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use crate::{Args, Error, Result};

pub async fn open(args: &Args) -> Result<anlg_db_core::Db> {
    let path = resolve_path(args)?;
    if !path.is_file() {
        return Err(Error::DatabaseNotFound(path));
    }

    anlg_db_core::Db::connect_local_read_only(&path)
        .await
        .map_err(|error| Error::operation("open database", error.to_string()))
}

pub async fn open_write(args: &Args) -> Result<anlg_db_core::Db> {
    let path = resolve_path(args)?;
    if !path.is_file() {
        return Err(Error::DatabaseNotFound(path));
    }

    anlg_db_core::Db::connect_local_read_write(&path)
        .await
        .map_err(|error| Error::operation("open database for writes", error.to_string()))
}

pub(crate) fn resolve_path(args: &Args) -> Result<PathBuf> {
    if let Some(path) = &args.db_path {
        return Ok(path.clone());
    }
    if let Some(base) = &args.base {
        return Ok(base.join("app.db"));
    }

    let data_dir = dirs::data_dir().ok_or_else(|| {
        Error::operation("resolve database path", "data directory is unavailable")
    })?;
    Ok(resolve_default_path(&data_dir))
}

fn resolve_default_path(data_dir: &Path) -> PathBuf {
    let command_name = std::env::args_os()
        .next()
        .and_then(|path| Path::new(&path).file_name().map(|name| name.to_owned()));
    resolve_default_path_for_command(data_dir, command_name.as_deref())
}

fn resolve_default_path_for_command(data_dir: &Path, command_name: Option<&OsStr>) -> PathBuf {
    let command_name = command_name
        .and_then(OsStr::to_str)
        .and_then(|name| Path::new(name).file_stem())
        .and_then(OsStr::to_str);
    let channel_identifier = match command_name {
        Some("anarlog-dev") => Some("com.hyprnote.dev"),
        Some("anarlog-staging") => Some("com.hyprnote.staging"),
        _ => None,
    };
    if let Some(identifier) = channel_identifier {
        return data_dir.join(identifier).join("app.db");
    }

    data_dir.join("sessionecho").join("app.db")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_path_uses_sessionecho_for_new_installs() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            resolve_default_path_for_command(dir.path(), Some(OsStr::new("anarlog"))),
            dir.path().join("sessionecho/app.db")
        );
    }

    #[test]
    fn default_path_finds_sessionecho_database() {
        let dir = tempfile::tempdir().unwrap();
        let sessionecho = dir.path().join("sessionecho/app.db");
        std::fs::create_dir_all(sessionecho.parent().unwrap()).unwrap();
        std::fs::write(&sessionecho, "").unwrap();

        assert_eq!(
            resolve_default_path_for_command(dir.path(), Some(OsStr::new("anarlog"))),
            dir.path().join("sessionecho/app.db")
        );
    }

    #[test]
    fn default_path_ignores_populated_anarlog_folder() {
        let dir = tempfile::tempdir().unwrap();
        let anarlog = dir.path().join("anarlog/app.db");
        std::fs::create_dir_all(anarlog.parent().unwrap()).unwrap();
        std::fs::write(&anarlog, "").unwrap();

        assert_eq!(
            resolve_default_path_for_command(dir.path(), Some(OsStr::new("anarlog"))),
            dir.path().join("sessionecho/app.db")
        );
    }

    #[test]
    fn channel_commands_target_their_channel_database() {
        let dir = tempfile::tempdir().unwrap();

        assert_eq!(
            resolve_default_path_for_command(dir.path(), Some(OsStr::new("anarlog-dev"))),
            dir.path().join("com.hyprnote.dev/app.db")
        );
        assert_eq!(
            resolve_default_path_for_command(dir.path(), Some(OsStr::new("anarlog-staging"))),
            dir.path().join("com.hyprnote.staging/app.db")
        );
        assert_eq!(
            resolve_default_path_for_command(dir.path(), Some(OsStr::new("anarlog-dev.exe"))),
            dir.path().join("com.hyprnote.dev/app.db")
        );
        assert_eq!(
            resolve_default_path_for_command(dir.path(), Some(OsStr::new("anarlog-staging.exe"))),
            dir.path().join("com.hyprnote.staging/app.db")
        );
    }
}
