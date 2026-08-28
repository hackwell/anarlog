//! Cargo does not rebuild a crate when a value read through `option_env!`
//! changes, so a new `MICROSOFT_CLIENT_ID` would silently not reach the
//! binary. Declaring the variables here makes the change trigger a rebuild.

fn main() {
    for variable in ["MICROSOFT_CLIENT_ID", "SESSIONECHO_DEEPLINK_SCHEME"] {
        println!("cargo:rerun-if-env-changed={variable}");
    }
}
