# Session Echo brand assets

Source of truth for the app icon and wordmark. The per-channel icon sets under
`apps/desktop/src-tauri/icons/{dev,staging,stable}/` are generated from
`app-icon-1024.png` and must not be hand-edited.

Regenerate:

    pnpm -F desktop exec tauri icon ../../brand/app-icon-1024.png -o src-tauri/icons/stable

Palette:

| Role | Hex |
|---|---|
| Primary Blue | #1462FF |
| Primary Violet | #5A43FF |
| Dark Navy | #08153D |
| Support Blue | #2B79FF |
| Support Indigo | #433DFF |
