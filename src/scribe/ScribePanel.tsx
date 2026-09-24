import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Mic,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { commands, type ScribeSnapshot } from "@/bindings";

export default function ScribePanel() {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<ScribeSnapshot | null>(null);
  const [version, setVersion] = useState(0);
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [levels, setLevels] = useState<number[]>([]);
  const input = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLElement>(null);
  const operation = useRef(false);

  useEffect(() => {
    const subscription = listen<number[]>("mic-level", ({ payload }) =>
      setLevels(payload),
    );
    return () => {
      void subscription.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const apply = (next: ScribeSnapshot | null) => {
      if (disposed || !next) return;
      setSnapshot((current) =>
        !current ||
        next.id > current.id ||
        (next.id === current.id && next.revision >= current.revision)
          ? next
          : current,
      );
    };
    void (async () => {
      unlisten = await listen<ScribeSnapshot>("scribe-state", ({ payload }) =>
        apply(payload),
      );
      if (disposed) {
        unlisten();
        return;
      }
      const result = await commands.scribeSnapshot();
      if (result.status === "ok") apply(result.data);
    })().catch(() => {
      if (!disposed) setError("session_unavailable");
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    setVersion(Math.max(0, (snapshot?.drafts.length ?? 0) - 1));
    setInstruction("");
    input.current?.blur();
    setError(null);
  }, [
    snapshot?.id,
    snapshot?.drafts.length,
    snapshot?.drafts[(snapshot?.drafts.length ?? 1) - 1]?.text,
  ]);

  useEffect(() => {
    if (snapshot?.phase === "review" || snapshot?.phase === "generate")
      panel.current?.focus();
  }, [snapshot?.id, snapshot?.phase]);

  const busy =
    pending ||
    (snapshot != null && !["review", "closed"].includes(snapshot.phase));
  const draft = snapshot?.drafts[version];
  const visibleError = error ?? snapshot?.error;
  const perform = async (
    action: () => Promise<{ status: string; error?: string }>,
  ) => {
    if (operation.current) return;
    operation.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await action();
      if (result.status === "error") setError(result.error ?? "request_failed");
      return result.status === "ok";
    } catch {
      setError("request_failed");
      return false;
    } finally {
      operation.current = false;
      setPending(false);
    }
  };
  const close = () => {
    if (snapshot)
      void commands
        .scribeClose(snapshot.id)
        .catch(() => setError("session_unavailable"));
  };
  const insert = () => {
    if (snapshot && draft && !busy)
      void perform(() =>
        commands.scribeInsert(snapshot.id, version, snapshot.revision),
      );
  };
  const generate = (regenerate = false) => {
    if (!snapshot) return;
    void perform(() =>
      commands.scribeGenerate(
        snapshot.id,
        instruction,
        draft ? version : null,
        regenerate,
      ),
    ).then((ok) => {
      if (ok) setInstruction("");
    });
  };

  return (
    <main
      ref={panel}
      className="scribe-panel"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        if (
          event.key === "Enter" &&
          !(event.target instanceof HTMLTextAreaElement) &&
          !(event.target instanceof HTMLButtonElement) &&
          !event.shiftKey
        ) {
          event.preventDefault();
          insert();
        }
      }}
      tabIndex={-1}
    >
      <header data-tauri-drag-region className="scribe-header">
        <nav className="scribe-versions" aria-label={t("scribe.versions")}>
          <button
            className="icon-button"
            aria-label={t("scribe.previous")}
            disabled={busy || version === 0}
            onClick={() => setVersion((v) => v - 1)}
          >
            <ArrowLeft size={15} />
          </button>
          <span>
            {t("scribe.versionCount", {
              current: draft ? version + 1 : 0,
              total: snapshot?.drafts.length ?? 0,
            })}
          </span>
          <button
            className="icon-button"
            aria-label={t("scribe.next")}
            disabled={busy || version >= (snapshot?.drafts.length ?? 0) - 1}
            onClick={() => setVersion((v) => v + 1)}
          >
            <ArrowRight size={15} />
          </button>
        </nav>
        <div className="scribe-brand">
          <Sparkles size={15} />
          <span>{t("scribe.title")}</span>
        </div>
        {snapshot?.destination && (
          <span className="scribe-destination">
            {t("scribe.destination", { app: snapshot.destination })}
          </span>
        )}
        <button
          className="icon-button scribe-close"
          aria-label={t("scribe.close")}
          onClick={close}
        >
          <X size={19} />
        </button>
      </header>
      {!snapshot || snapshot.phase === "closed" ? (
        <p className="scribe-placeholder">{t("scribe.ready")}</p>
      ) : (
        <>
          {(snapshot.instruction ||
            snapshot.context ||
            snapshot.context_blocked) && (
            <section className="scribe-prompt">
              {snapshot.instruction && (
                <blockquote>{snapshot.instruction}</blockquote>
              )}
              {(snapshot.context || snapshot.context_blocked) && (
                <section className="scribe-context">
                  <div className="scribe-row">
                    <span>{t("scribe.clipboard")}</span>
                    <button
                      disabled={!["capture", "review"].includes(snapshot.phase)}
                      onClick={() =>
                        void commands
                          .scribeRemoveContext(snapshot.id)
                          .then((r) => {
                            if (r.status === "error") setError(r.error);
                          })
                          .catch(() => setError("request_failed"))
                      }
                    >
                      {t("scribe.remove")}
                    </button>
                  </div>
                  {snapshot.context_blocked ? (
                    <p>{t("scribe.errors.context_too_large")}</p>
                  ) : (
                    <details>
                      <summary>{snapshot.context?.slice(0, 160)}</summary>
                      <p>{snapshot.context}</p>
                    </details>
                  )}
                </section>
              )}
            </section>
          )}
          <section
            className="scribe-result"
            aria-live="polite"
            aria-busy={busy}
          >
            {snapshot.phase === "capture" ? (
              <div className="scribe-progress">
                <div className="scribe-wave" aria-hidden="true">
                  {Array.from({ length: 16 }, (_, i) => (
                    <span
                      key={i}
                      style={{
                        height: `${Math.max(4, Math.min(40, (levels[i % Math.max(1, levels.length)] ?? 0) * 80))}px`,
                      }}
                    />
                  ))}
                </div>
                <strong>{t("scribe.phases.capture")}</strong>
                <p>{t("scribe.speakHint")}</p>
                <button
                  onClick={() =>
                    void commands.scribeToggleVoice(snapshot.id, null)
                  }
                >
                  {t("scribe.stop")}
                </button>
              </div>
            ) : ["transcribe", "generate", "insert"].includes(
                snapshot.phase,
              ) ? (
              <div className="scribe-progress">
                <Sparkles className="pulse" size={28} />
                <strong>{t(`scribe.phases.${snapshot.phase}`)}</strong>
              </div>
            ) : draft ? (
              <div className="scribe-text">{draft.text}</div>
            ) : (
              <p className="scribe-placeholder">{t("scribe.emptyDraft")}</p>
            )}
          </section>
          {visibleError && (
            <div role="alert" className="scribe-error">
              {t(`scribe.errors.${visibleError}`, {
                defaultValue: t("scribe.errors.request_failed"),
              })}
            </div>
          )}
          {!snapshot.destination && snapshot.phase === "review" && (
            <p className="scribe-hint">{t("scribe.copyFallback")}</p>
          )}
          {snapshot.phase === "review" && (
            <form
              className="scribe-followup"
              onSubmit={(event) => {
                event.preventDefault();
                generate();
              }}
            >
              <textarea
                ref={input}
                aria-label={t("scribe.instruction")}
                placeholder={t("scribe.followupPlaceholder")}
                value={instruction}
                maxLength={4000}
                rows={1}
                onChange={(event) => setInstruction(event.target.value)}
                disabled={busy}
              />
              <button
                type="submit"
                disabled={
                  busy || !instruction.trim() || snapshot.context_blocked
                }
              >
                {t("scribe.generate")}
              </button>
            </form>
          )}
          <footer className="scribe-footer">
            <button
              className="scribe-rewrite"
              disabled={busy}
              onClick={() =>
                void perform(() =>
                  commands.scribeToggleVoice(
                    snapshot.id,
                    draft ? version : null,
                  ),
                )
              }
            >
              <Mic size={16} />
              {t("scribe.rewrite")}
            </button>

            <button
              className="icon-button"
              aria-label={t("scribe.regenerate")}
              disabled={busy || !draft}
              onClick={() => generate(true)}
            >
              <RefreshCw size={17} />
            </button>
            <button
              className="icon-button"
              aria-label={t("scribe.copy")}
              disabled={busy || !draft}
              onClick={() =>
                void perform(() =>
                  commands.scribeCopy(snapshot.id, version, snapshot.revision),
                )
              }
            >
              <Copy size={17} />
            </button>
            <button
              className="scribe-primary"
              disabled={busy || !draft || !snapshot.destination}
              onClick={insert}
            >
              {t("scribe.insert")}
            </button>
          </footer>
        </>
      )}
    </main>
  );
}
