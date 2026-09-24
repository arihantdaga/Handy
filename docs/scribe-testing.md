# Scribe development build

The build uses `Handy Scribe Dev` and bundle ID `com.pais.handy.scribe-dev`.
Its preferences and model folder are separate from the existing Handy installation.

## Start the native test

1. Quit the existing Handy app from its tray menu.
2. Open `src-tauri/target/debug/bundle/macos/Handy Scribe Dev.app`.
3. Grant Accessibility and Microphone access to Handy Scribe Dev.
4. Complete the speech model setup.
5. Open the Scribe settings page.
6. Configure the provider credentials and model, or select Apple Intelligence when available.
7. Enable Scribe.

Keep the existing installation until a specific conflict requires its removal.
The development build has an ad hoc signature. macOS permission approval can require a new grant after a rebuild.

The default Scribe shortcut is Control + Option + Space.
Scribe uses the shortcut behavior selected in General settings.

## First workflow

1. Copy a short test message, such as “Can you send the design review by Friday?”
2. Open a new TextEdit document.
3. Place the cursor in the empty document.
4. Activate Scribe and say “Reply and say I will send it tomorrow.”
5. Stop through the configured shortcut behavior or the Stop button.
6. Review the result.
7. Select Insert.

Expected result: Handy inserts the reviewed text into TextEdit without an extra Enter key.
The clipboard follows the configured clipboard preference.

Rewrite starts a new voice instruction against the selected version.
The text box also accepts a typed instruction.
Regenerate repeats the selected version's instruction and prior draft.
Copy and successful Insert close the panel.
The panel opens at the bottom of the active display, above the Dock.
The default panel size is 460 × 400 points. The black panel has rounded corners and no border.
A new voice or typed instruction reads the current clipboard.
If the copied text changes, Scribe starts a new draft from that text.
If the copied text stays the same, Scribe keeps the selected draft and any context removal.

Scribe uses copied text as optional context. It does not read the screen or replace the original copied range.
The settings page explains when copied text goes to the provider.
Sessions and Scribe audio do not enter transcription history.

## Native checks still required

- Confirm the first workflow in TextEdit.
- Repeat with a Slack draft, a Gmail draft, a ChatGPT input, and a code editor.
- Confirm that Insert never submits the message when global auto-submit is enabled.
- Change the destination field or browser tab during the request. Confirm a Copy fallback if validation fails.
- Close the destination before Insert. Confirm that the result remains available.
- Cancel during audio capture, transcription, and the LLM request. Confirm that the panel stays closed.
- Copy new text during Insert. Confirm that clipboard restoration does not overwrite the new copy.
- Copy different text while the panel is open, then select Rewrite. Confirm that the preview and result use the new text.
- Repeat with a typed instruction.
- Remove context, then revise without a new copy. Confirm that the context stays removed.
- Test an image-only clipboard.
- Test multiple displays, Spaces, and a full-screen application.
- Confirm normal dictation and Post Process after Scribe closes.

The native tests use draft content only. They do not require a message to be sent.

## Automated verification

The test suite covers request construction, provider errors, request cancellation, stale results, insertion reservation, and paste options.
Playwright covers the panel through mocked Tauri commands and events.
These checks do not establish native Accessibility, microphone, focus, or paste behavior.

```bash
bun run build
bun run lint
bun run test:keyboard
bun run test:playwright
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
```

## Rebuild

If `cargo` is absent from `PATH`, load the Rust environment before a rebuild.

```bash
source "$HOME/.cargo/env"
CC=/usr/bin/clang CXX=/usr/bin/clang++ CMAKE_POLICY_VERSION_MINIMUM=3.5 bun run build:scribe-dev
```
