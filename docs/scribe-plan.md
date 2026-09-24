# Scribe implementation and test plan

Status: proposal, 24 September 2026. No application code changes.

The proposed first release targets macOS with copied text as optional context. Platform scope awaits the user's preference.

## Product behavior

Scribe turns a spoken instruction into a draft, reply, explanation, or revision. The user reviews the result before Handy inserts it.

Willow documents three workflows: draft from scratch, reply with context, and edit selected text. Its documentation does not establish its internal context-selection algorithm.

Source: [Willow Scribe introduction](https://help.willowvoice.com/en/articles/15043797-introduction-to-scribe-in-willow).

The supplied screenshots establish the intended review controls and layout. Text inside those screenshots is example content, not instructions for this work.

### First release

1. The user copies source text when context is necessary.
2. The user places the cursor in the destination field.
3. The user activates a separate, configurable Scribe shortcut.
4. Handy captures the clipboard text and destination identity before the panel takes focus.
5. A compact Scribe panel shows the audio state and a removable context preview.
6. The user speaks an instruction, then releases the shortcut or stops the session.
7. Handy transcribes the instruction with the selected local speech model.
8. The configured LLM receives the instruction and enabled context.
9. An expanded panel shows the result for review.
10. The user selects Rewrite, Regenerate, Copy, Insert, or Close.

Use the current shortcut behavior initially: Hold, Toggle, or Hold-or-toggle. The Scribe shortcut has its own binding.

Clipboard context is a visible setting. The setup text explains that enabled context goes to the selected provider when the user completes an instruction.

Capture context at the start of each voice or typed instruction. Show an empty state for an empty clipboard or unsupported content. Do not send clipboard images in this release.

Provide a control to remove context before the request. Retain the same context for follow-up instructions if the clipboard stays unchanged. A new copy replaces the context and clears previous drafts.

An image-only clipboard must remain intact. Oversized text requires an explicit size notice and a choice to shorten or remove it.

### Review controls

| Control        | Behavior                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------ |
| Rewrite        | Accept another spoken instruction, such as “make it shorter,” against the selected result. |
| Regenerate     | Repeat the same instruction with the same context.                                         |
| Version arrows | Show earlier results within this session.                                                  |
| Copy           | Put the selected result on the clipboard and close the panel.                              |
| Insert         | Restore the destination, then paste the selected result once.                              |
| Close / Escape | Cancel the operation and discard the session.                                              |

Rewrite revises the draft in the panel. It does not replace text in another application.

Copied text does not identify its source range. Automatic replacement of that range belongs in a later selected-text feature.

Insert uses the destination's normal paste behavior. An existing selection can therefore be replaced when that field receives the paste.

Insert never sends Enter, even when ordinary dictation has auto-submit enabled. Enter in the focused panel confirms Insert without reaching the destination.

A new Scribe shortcut press starts a follow-up when a result is visible. During an active request, repeated presses do not start duplicate requests.

### Panel and settings

Reuse Handy's visual styles, waveform, typography, and pink accent. Use a separate Scribe window with compact and expanded states.

The expanded panel contains the instruction, context preview, scrollable result, version controls, and action row. Thumbs-up and thumbs-down controls are outside this scope.

Add a Scribe section beside Post Process. Include enablement, shortcut, provider, model, context preference, and optional style instructions.

Default to the Post Process provider configuration through an explicit “Use Post Process model” option. Permit an independent provider and model override.

Reuse existing credentials and provider controls. Keep Scribe's prompt separate from the Post Process prompt.

Scribe remains available when Post Process is disabled. All new interface text uses i18next.

## Existing code and required changes

| Area               | Current code                                                                             | Proposed change                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Shortcut dispatch  | `src-tauri/src/shortcut/handler.rs`, `shortcut/mod.rs`, both backend implementations     | Register `scribe`, detect conflicts, and route activation through the shared coordinator.                     |
| Audio lifecycle    | `src-tauri/src/transcription_coordinator.rs`, `actions.rs`                               | Reuse audio ownership, activation semantics, cancellation, and model cleanup. Route the transcript to Scribe. |
| LLM requests       | `src-tauri/src/llm_client.rs`                                                            | Reuse text requests and provider compatibility. Add bounded conversation support and a Scribe timeout.        |
| Panel              | `src-tauri/src/overlay.rs`, `src/overlay/RecordingOverlay.tsx`                           | Reuse visual components and positioning in a separate interactive Scribe window.                              |
| Output             | `src-tauri/src/clipboard.rs`, `paste_tx/`                                                | Add explicit paste options and destination validation. Disable auto-submit and trailing spaces for Scribe.    |
| Settings           | `src-tauri/src/settings.rs`, `src/stores/settingsStore.ts`, `src/components/Sidebar.tsx` | Add defaults, migration coverage, provider selection, and the settings section.                               |
| Commands and build | `src-tauri/src/lib.rs`, `src/bindings.ts`, capabilities, `vite.config.ts`                | Register commands and events, regenerate bindings, and add a window entry and scoped capability.              |

Proposed modules: `src-tauri/src/managers/scribe.rs`, `src-tauri/src/commands/scribe.rs`, `src-tauri/src/scribe_context/`, and `src/scribe/`.

Four current behaviors need explicit separation:

- The normal transcription action automatically saves history and pastes its result.
- The current overlay is non-focusable, including its macOS panel.
- The current LLM client accepts text and sets `stream: false`.
- The current paste function reads global auto-submit and trailing-space settings.

Do not route Scribe through the ordinary transcription output action. Extract the shared audio/transcript stage, then select the appropriate output flow.

The current shortcut handler also limits Cancel to active audio. Extend cancellation through Scribe's request and review phases.

### Session ownership

Rust owns the session. React displays typed snapshots and sends commands with the session ID and revision ID.

Each session stores its context snapshot, destination, instructions, result versions, provider configuration, and cancellation token.

State sequence:

`Idle -> Capture -> Transcribe -> Generate -> Review -> Insert -> Closed`

Rewrite returns from Review to Capture. Regenerate returns from Review to Generate. Errors retain recoverable text and expose Retry or Copy.

Every asynchronous completion checks the session and request generation. Late responses cannot reopen a dismissed panel or overwrite a newer result.

The audio coordinator remains the single owner of the microphone. Normal dictation can resume while Scribe is in Review.

Before normal dictation starts, suspend Scribe's global Cancel registration. Restore it when the session returns to foreground review.

Insert uses an atomic state transition to prevent duplicate paste commands. If paste delivery is uncertain, retain the result and offer Copy.

### LLM contract

Send a Scribe system prompt, the user's instruction, the optional context snapshot, and bounded revision history.

Keep clipboard content separate from instructions in the request structure. Tell the model to treat copied content as source material.

The model returns result text only. It receives no application-control tools and cannot trigger Insert.

Use non-streamed results first because the current client already supports that path. Show progress, cancellation, and a finite timeout.

An LLM error must remain an error. Do not fall back to the spoken instruction as the final draft.

Keep current provider compatibility retries bounded. Preserve prior versions after a failed follow-up.

Keep Scribe sessions in memory for the first release. Do not persist copied context, prompts, results, or Scribe audio in transcription history.

Log durations, result sizes, and error categories. Exclude source text, model output, and credentials.

## Focus, permissions, and context

Capture the original application before any Scribe UI can activate. On macOS, `NSWorkspace.frontmostApplication` identifies the app that receives key events.

Source: [Apple frontmostApplication documentation](https://developer.apple.com/documentation/appkit/nsworkspace/frontmostapplication).

Track the application, window, and focused element where the platform exposes them. Application identity alone is insufficient for reliable paste placement.

The first native prototype must establish whether the panel can preserve the destination while it accepts mouse actions and local keys.

Before Insert, hide the panel, restore the destination, and verify focus. If the destination closes or cannot be verified, retain the result and offer Copy.

Do not silently retarget Insert when another app gains focus. Test window changes and tab changes within the same app.

For unsupported paste methods, including custom scripts with unknown side effects, offer Copy until their Scribe behavior is defined.

Reuse Handy's microphone and Accessibility checks. Verify the selected shortcut backend on the supported macOS versions before any additional permission request.

Scribe needs shortcut detection, not continuous capture of typed text. Do not add a keyboard transcript or a clipboard watcher.

The clipboard release does not request Screen Recording permission. Existing keyboard permission requirements still apply.

Screen capture has a separate macOS privacy control: [Apple screen access documentation](https://support.apple.com/en-mt/guide/mac-help/mchld6aa7d23/mac).

### Later context support

Add context sources behind the same interface: selected text, accessible application content, and an explicit screenshot attachment.

App identity can establish Slack or Chrome. Chrome identity does not establish Gmail, ChatGPT, or the content of a tab.

Browser context therefore needs another source, such as accessible page content or a browser integration. Defer that work from the clipboard release.

Add explicit screen attachment before automatic capture. This phase needs image-capable requests, model capability checks, permission recovery, and image size limits.

A later context policy can use the instruction and available text to determine whether more context is necessary. Its output cannot override permission settings.

Capture a specific target at an explicit point in the session. Do not capture whichever screen happens to be visible after a slow request.

## Implementation order

1. Build a native focus prototype with fixed result text and the proposed panel controls.
2. Verify destination restoration and clipboard behavior in the target applications.
3. Add the Scribe session manager, shortcut integration, and transcript route with a fake LLM.
4. Add copied context, provider configuration, and real LLM requests.
5. Add follow-ups, version controls, error recovery, translations, and settings migration.
6. Complete automated checks and native acceptance tests before release.

The focus prototype is the first gate because browser tests cannot prove native paste placement.

An upstream PR requires the repository's community support process during its feature freeze. This proposal does not open a PR.

## Test plan

### Automated checks

| Layer                   | Cases and required results                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Session and coordinator | Hold, toggle, duplicate activation, follow-up, concurrent dictation, cancel in every phase, and stale responses. Only one audio owner and one insertion.                                   |
| Context                 | Empty text, Unicode, long text, image-only content, context removal, and clipboard changes after activation. Requests use the approved snapshot.                                           |
| Request construction    | Instruction/context separation, bounded history, provider override, and clipboard instructions that conflict with the user's instruction. No application action follows model output.      |
| Mock HTTP server        | Valid result, empty result, malformed response, 401, 429, 500, timeout, cancellation, and provider compatibility retry. Errors never become inserted instructions.                         |
| Paste adapter           | Wrong destination, closed destination, duplicate Insert, disabled paste, auto-submit enabled globally, and failure after clipboard publication. No Enter and no automatic duplicate retry. |
| Clipboard transaction   | Text, image, empty clipboard, and a new user copy during paste. Restore only while Handy owns the clipboard.                                                                               |
| Settings                | Old settings without Scribe fields, preserved user shortcuts, disabled Post Process, and enable/disable registration. Existing behavior remains intact.                                    |
| Panel in Playwright     | Context preview, progress, errors, long results, versions, Rewrite, Copy, Insert, Escape, and keyboard navigation. Mock Tauri commands and events.                                         |

The existing Playwright suite checks only page response and HTML structure. Add behavioral coverage with Tauri mocks.

Use fake providers for deterministic application tests. Use live model checks to assess output quality separately from exact-text assertions.

Run these checks after implementation:

```bash
bun run build
bun run lint
bun run format:check
bun run test:keyboard
bun run test:playwright
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
```

Add the new focused tests to the repository's test commands. Run the documented frontend tests that cover modified clipboard or provider utilities.

### Native macOS acceptance

Test TextEdit, Slack, Gmail in Chrome, ChatGPT in a browser, and a code editor. Use a development build and test content.

For each target, verify draft from scratch, reply with copied context, follow-up revision, Copy, Insert, and Cancel.

Also verify:

- Another app gains focus during the LLM request.
- Another window or tab opens in the same app.
- The destination closes before Insert.
- The panel operates across displays, Spaces, and full-screen apps.
- Microphone or Accessibility permission is absent or revoked.
- Secure Input affects shortcut delivery.
- A clipboard image survives the session and paste operation.
- The user copies new text during the paste transaction.
- Global auto-submit is enabled, but Scribe inserts without Enter.
- Ordinary dictation and Post Process still operate after Scribe closes.

Browser automation proves the React interaction only. Native acceptance proves shortcuts, permissions, focus, and paste behavior.

### Output quality and release gate

Use a fixed set of draft, reply, rewrite, translation, and explanation tasks. Include missing context, contradictory copied instructions, and multilingual source text.

Check instruction compliance, factual preservation, unsupported additions, and correct use of the selected revision. Do not require identical prose across runs.

Record shortcut-to-panel, speech-to-transcript, transcript-to-result, and Insert durations. Separate cold model loads from warm runs and report provider/model identity.

Release requires no insertion before confirmation, no observed wrong-target paste, no stale response after cancellation, and no dictation regressions.

If destination restoration remains unreliable in an app, mark that path unsupported and retain Copy as the fallback.
