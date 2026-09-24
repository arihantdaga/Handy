import { Input } from "@/components/ui/Input";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, type ScribeSettings as Config } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import {
  Dropdown,
  SettingContainer,
  SettingsGroup,
  Textarea,
  ToggleSwitch,
} from "@/components/ui";
import { ShortcutInput } from "../ShortcutInput";
import { ApiKeyField } from "../PostProcessingSettingsApi/ApiKeyField";
import { BaseUrlField } from "../PostProcessingSettingsApi/BaseUrlField";
import { ModelSelect } from "../PostProcessingSettingsApi/ModelSelect";

export default function ScribeSettings() {
  const { t } = useTranslation();
  const {
    settings,
    refreshSettings,
    updatePostProcessModel,
    updatePostProcessApiKey,
    updatePostProcessBaseUrl,
    fetchPostProcessModels,
    postProcessModelOptions,
  } = useSettings();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [model, setModel] = useState("");
  const [style, setStyle] = useState("");
  const config = settings?.scribe;
  useEffect(() => {
    setModel(config?.model ?? "");
    setStyle(config?.style ?? "");
  }, [config?.model, config?.style]);
  if (!settings || !config) return null;
  const providerId =
    config.provider_id ?? settings.post_process_provider_id ?? "openai";
  const provider = settings.post_process_providers?.find(
    (p) => p.id === providerId,
  );
  const save = async (patch: Partial<Config>) => {
    setPending(true);
    setError(null);
    try {
      const result = await commands.scribeUpdateSettings({
        ...config,
        ...patch,
      });
      if (result.status === "error") setError(result.error);
      else await refreshSettings();
    } catch {
      setError("request_failed");
    } finally {
      setPending(false);
    }
  };
  const sharedModel = settings.post_process_models?.[providerId] ?? "";
  return (
    <div className="space-y-6">
      <SettingsGroup
        title={t("scribe.title")}
        description={t("scribe.settings.description")}
      >
        <ToggleSwitch
          label={t("scribe.settings.enabled")}
          description={t("scribe.settings.enabledDescription")}
          checked={config.enabled}
          onChange={(enabled) => void save({ enabled })}
          disabled={pending}
          grouped
        />
        <ShortcutInput
          shortcutId="scribe"
          grouped
          disabled={pending || !config.enabled}
        />
        <ToggleSwitch
          label={t("scribe.settings.clipboard")}
          description={t("scribe.settings.clipboardDescription")}
          descriptionMode="inline"
          checked={config.use_clipboard}
          onChange={(use_clipboard) => void save({ use_clipboard })}
          disabled={pending}
          grouped
        />
      </SettingsGroup>
      <SettingsGroup title={t("scribe.settings.modelTitle")}>
        <ToggleSwitch
          label={t("scribe.settings.shared")}
          description={t("scribe.settings.sharedDescription")}
          checked={config.provider_id === null}
          onChange={(shared) =>
            void save({
              provider_id: shared ? null : providerId,
              model: sharedModel,
            })
          }
          disabled={pending}
          grouped
        />
        {config.provider_id === null ? (
          <SettingContainer
            description=""
            title={t("scribe.settings.currentModel")}
            grouped
          >
            <span className="text-sm text-mid-gray">
              {provider?.label} /{" "}
              {sharedModel || t("scribe.settings.notConfigured")}
            </span>
          </SettingContainer>
        ) : (
          <>
            <SettingContainer
              description=""
              title={t("settings.postProcessing.api.provider.title")}
              grouped
            >
              <Dropdown
                options={(settings.post_process_providers ?? []).map((p) => ({
                  value: p.id,
                  label: p.label,
                }))}
                selectedValue={providerId}
                disabled={pending}
                onSelect={(id) =>
                  void save({
                    provider_id: id,
                    model: settings.post_process_models?.[id] ?? "",
                  })
                }
              />
            </SettingContainer>
            <SettingContainer
              description=""
              title={t("settings.postProcessing.api.model.title")}
              grouped
            >
              <ModelSelect
                value={model}
                options={(postProcessModelOptions[providerId] ?? []).map(
                  (value) => ({ value, label: value }),
                )}
                disabled={pending}
                isLoading={false}
                onSelect={(value) => void save({ model: value })}
                onCreate={(value) => void save({ model: value })}
                onBlur={() => {}}
                placeholder={t("scribe.settings.modelPlaceholder")}
                className="min-w-[260px]"
              />
            </SettingContainer>
            <div className="px-4 py-2">
              <button
                className="text-sm text-logo-primary"
                disabled={pending}
                onClick={() =>
                  void fetchPostProcessModels(providerId).catch(() =>
                    setError("request_failed"),
                  )
                }
              >
                {t("settings.postProcessing.api.model.refreshModels")}
              </button>
            </div>
          </>
        )}
        {providerId !== "apple_intelligence" && (
          <SettingContainer
            title={t("settings.postProcessing.api.apiKey.title")}
            description={t("scribe.settings.keyDescription")}
            descriptionMode="inline"
            grouped
          >
            <ApiKeyField
              value={settings.post_process_api_keys?.[providerId] ?? ""}
              onBlur={(value) =>
                void updatePostProcessApiKey(providerId, value).catch(() =>
                  setError("request_failed"),
                )
              }
              disabled={pending}
            />
          </SettingContainer>
        )}
        {providerId === "custom" && (
          <SettingContainer
            description=""
            title={t("settings.postProcessing.api.baseUrl.title")}
            grouped
          >
            <BaseUrlField
              value={provider?.base_url ?? ""}
              onBlur={(value) =>
                void updatePostProcessBaseUrl(providerId, value).catch(() =>
                  setError("request_failed"),
                )
              }
              disabled={pending}
            />
          </SettingContainer>
        )}
        {config.provider_id === null && (
          <SettingContainer
            description=""
            title={t("scribe.settings.sharedModel")}
            grouped
          >
            <Input
              key={providerId + sharedModel}
              defaultValue={sharedModel}
              onBlur={(event) =>
                void updatePostProcessModel(
                  providerId,
                  event.target.value,
                ).catch(() => setError("request_failed"))
              }
            />
          </SettingContainer>
        )}
        <SettingContainer
          description=""
          title={t("scribe.settings.style")}
          layout="stacked"
          grouped
        >
          <Textarea
            value={style}
            maxLength={4000}
            disabled={pending}
            onChange={(event) => setStyle(event.target.value)}
            onBlur={() => {
              if (style !== config.style) void save({ style });
            }}
            placeholder={t("scribe.settings.stylePlaceholder")}
          />
        </SettingContainer>
      </SettingsGroup>
      {error && (
        <p role="alert" className="text-red-500 text-sm">
          {t(`scribe.errors.${error}`, { defaultValue: error })}
        </p>
      )}
    </div>
  );
}
