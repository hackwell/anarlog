const COMMANDS: &[&str] = &["github_issue_state", "github_issue_detail"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
