import { expect, test, type Page } from "@playwright/test";
import type { ScribeSnapshot } from "../src/bindings";

const initial: ScribeSnapshot = {
  id: 7,
  revision: 3,
  phase: "review",
  context: "Can you send the design review by Friday?",
  context_blocked: false,
  instruction: "Reply and say I will send it tomorrow.",
  drafts: [
    {
      instruction: "Reply and say I will send it tomorrow.",
      text: "I will send the design review tomorrow.",
      previous_draft: null,
    },
  ],
  error: null,
  destination: "TextEdit",
};
type Call = { command: string; args: Record<string, unknown> };
type Fixture = {
  state: ScribeSnapshot;
  calls: Call[];
  emit: (state: ScribeSnapshot) => void;
};
declare global {
  interface Window {
    scribeTest: Fixture;
  }
}

async function boot(page: Page, overrides: Partial<ScribeSnapshot> = {}) {
  await page.addInitScript(
    (state) => {
      const callbacks = new Map<number, (event: unknown) => void>();
      const listeners = new Map<number, string>();
      let next = 0;
      const fixture: Fixture = {
        state,
        calls: [],
        emit(nextState) {
          fixture.state = nextState;
          for (const [id, event] of listeners)
            if (event === "scribe-state")
              callbacks.get(id)?.({ payload: nextState });
        },
      };
      window.scribeTest = fixture;
      Object.assign(window, {
        __TAURI_INTERNALS__: {
          transformCallback(callback: (event: unknown) => void) {
            callbacks.set(++next, callback);
            return next;
          },
          unregisterCallback(id: number) {
            callbacks.delete(id);
          },
          async invoke(command: string, args: Record<string, unknown> = {}) {
            if (command === "plugin:event|listen") {
              listeners.set(args.handler as number, args.event as string);
              return args.handler;
            }
            if (command === "plugin:event|unlisten") {
              listeners.delete(args.eventId as number);
              return;
            }
            if (command === "get_app_settings") return { app_language: "en" };
            if (command === "plugin:os|locale") return "en-US";
            if (command === "scribe_snapshot") return fixture.state;
            fixture.calls.push({ command, args });
            if (command === "scribe_remove_context")
              fixture.emit({
                ...fixture.state,
                context: null,
                context_blocked: false,
                revision: fixture.state.revision + 1,
              });
            if (command === "scribe_close" || command === "scribe_copy")
              fixture.emit({
                ...fixture.state,
                phase: "closed",
                context: null,
                drafts: [],
                revision: fixture.state.revision + 1,
              });
            if (command === "scribe_insert") {
              fixture.emit({
                ...fixture.state,
                phase: "insert",
                revision: fixture.state.revision + 1,
              });
              await new Promise((resolve) => setTimeout(resolve, 50));
              fixture.emit({
                ...fixture.state,
                phase: "closed",
                context: null,
                drafts: [],
                revision: fixture.state.revision + 1,
              });
            }
            if (command === "scribe_toggle_voice")
              fixture.emit({
                ...fixture.state,
                phase:
                  fixture.state.phase === "capture" ? "transcribe" : "capture",
                revision: fixture.state.revision + 1,
              });
            if (command === "scribe_generate") {
              fixture.emit({
                ...fixture.state,
                phase: "generate",
                revision: fixture.state.revision + 1,
              });
              await new Promise((resolve) => setTimeout(resolve, 80));
              if (fixture.state.phase !== "closed")
                fixture.emit({
                  ...fixture.state,
                  phase: "review",
                  revision: fixture.state.revision + 1,
                  drafts: [
                    ...fixture.state.drafts,
                    {
                      text: "I will send it tomorrow.",
                      instruction: String(args.instruction),
                      previous_draft:
                        fixture.state.drafts[Number(args.version)]?.text ??
                        null,
                    },
                  ],
                });
            }
            return null;
          },
        },
        __TAURI_EVENT_PLUGIN_INTERNALS__: {
          unregisterListener(_event: string, id: number) {
            listeners.delete(id);
          },
        },
      });
    },
    { ...initial, ...overrides },
  );
  await page.goto("/src/scribe/index.html");
  await expect(page.getByText("Scribe", { exact: true })).toBeVisible();
}

async function calls(page: Page, command: string) {
  return page.evaluate(
    (cmd) => window.scribeTest.calls.filter((c) => c.command === cmd),
    command,
  );
}

test("review never inserts automatically and Copy closes the session", async ({
  page,
}) => {
  await boot(page);
  await expect(
    page.getByText(initial.drafts[0].text, { exact: true }),
  ).toBeVisible();
  expect(await calls(page, "scribe_insert")).toHaveLength(0);
  await page.getByRole("button", { name: "Copy result", exact: true }).click();
  await expect(
    page.getByText("Use your Scribe shortcut to start."),
  ).toBeVisible();
  expect((await calls(page, "scribe_copy"))[0].args).toEqual({
    id: 7,
    version: 0,
    revision: 3,
  });
  await expect(
    page.getByText(initial.drafts[0].text, { exact: true }),
  ).not.toBeVisible();
});

test("remove context and revise the selected version", async ({ page }) => {
  await boot(page);
  await page.getByRole("button", { name: "Remove context" }).click();
  await expect(
    page.getByText("Copied text", { exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("textbox", { name: "Instruction", exact: true })
    .fill("Make it shorter");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(
    page.getByText("I will send it tomorrow.", { exact: true }),
  ).toBeVisible();
  expect((await calls(page, "scribe_generate"))[0].args).toEqual({
    id: 7,
    instruction: "Make it shorter",
    version: 0,
    regenerate: false,
  });
  await page.getByRole("button", { name: "Previous version" }).click();
  await expect(
    page.getByText(initial.drafts[0].text, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Regenerate", exact: true }).click();
  expect((await calls(page, "scribe_generate"))[1].args.version).toBe(0);
});

test("rewrite starts voice capture and Stop ends it", async ({ page }) => {
  await boot(page);
  await page.getByRole("button", { name: "Rewrite", exact: true }).click();
  await expect(
    page.getByText("Speak your instruction", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByText("Convert speech to text…")).toBeVisible();
  expect(await calls(page, "scribe_toggle_voice")).toHaveLength(2);
});

test("Insert sends one command and blocks repeat activation", async ({
  page,
}) => {
  await boot(page);
  const button = page.getByRole("button", { name: "Insert", exact: true });
  await button.click();
  await expect(
    page.getByText("Use your Scribe shortcut to start."),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  expect(await calls(page, "scribe_insert")).toHaveLength(1);
});

test("missing destination offers Copy and prevents Insert", async ({
  page,
}) => {
  await boot(page, { destination: null });
  await expect(
    page.getByRole("button", { name: "Insert", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Copy result", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText(/could not identify an editable destination/),
  ).toBeVisible();
});

test("Escape dismisses generation and stale events cannot reopen it", async ({
  page,
}) => {
  await boot(page, { phase: "generate" });
  await page.locator("main").focus();
  await page.keyboard.press("Escape");
  await expect(
    page.getByText("Use your Scribe shortcut to start."),
  ).toBeVisible();
  await page.evaluate((state) => window.scribeTest.emit(state), initial);
  await expect(
    page.getByText("Use your Scribe shortcut to start."),
  ).toBeVisible();
  expect(await calls(page, "scribe_close")).toHaveLength(1);
});

test("provider errors retain the previous draft", async ({ page }) => {
  await boot(page, { error: "request_timeout" });
  await expect(page.getByRole("alert")).toContainText("90 seconds");
  await expect(
    page.getByText(initial.drafts[0].text, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy result", exact: true }),
  ).toBeEnabled();
});

test("Rewrite can retry a failed transcription without a draft", async ({
  page,
}) => {
  await boot(page, {
    error: "transcription_failed",
    instruction: "",
    drafts: [],
  });
  await expect(page.getByRole("alert")).toContainText("could not transcribe");
  await page.getByRole("button", { name: "Rewrite", exact: true }).click();
  await expect(
    page.getByText("Speak your instruction", { exact: true }),
  ).toBeVisible();
  expect((await calls(page, "scribe_toggle_voice"))[0].args).toEqual({
    id: 7,
    version: null,
  });
});

test("long content fits the panel", async ({ page }, info) => {
  await page.setViewportSize({ width: 460, height: 400 });
  await boot(page, {
    drafts: [
      {
        ...initial.drafts[0],
        text: "A longer explanation with several paragraphs.\n\n".repeat(25),
      },
    ],
  });
  await expect(
    page.getByRole("button", { name: "Insert", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("scribe-panel.png") });
});

test("Enter confirms the visible result without a pointer action", async ({
  page,
}) => {
  await boot(page);
  await expect(page.locator("main")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await calls(page, "scribe_insert")).length)
    .toBe(1);
});
