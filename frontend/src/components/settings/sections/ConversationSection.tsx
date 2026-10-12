import React, { useEffect, useImperativeHandle, useState } from 'react';
import { resolveMessage } from '../../../api/i18n';
import { BACKEND_URL } from '../../../api/base-url';
import { rebuildCharacterFilters } from '../../../api/files';
import {
    BASIC_SETTINGS_I18N_KEYS,
    BASIC_SETTINGS_TEXT_FALLBACK_JA,
    DEFAULT_UI_LANGUAGE,
    EMOTION_CATALOG_I18N_KEYS,
    EMOTION_CATALOG_TEXT_FALLBACK_JA,
    SETTINGS_I18N_KEYS,
    SETTINGS_TEXT_FALLBACK_JA,
    SETTINGS_VIEW_I18N_KEYS,
    SETTINGS_VIEW_TEXT_FALLBACK_JA,
} from '../../../constants/i18n';
import type { Settings } from '../../../types/Settings';
import { Button, SettingRow, TextField, Toggle } from '../../ui';
import { ParameterSchemaEditorModal } from '../ParameterSchemaEditorModal';
import { EmotionCatalogModal } from '../EmotionCatalogModal';
import { ReplacementConfigModal } from '../../SSRP/ReplacementConfigModal';
import { RangeControl, SettingsGroup } from './parts';
import { useSettingsDraft, type SectionCommonProps, type SectionHandle } from './sectionTypes';

interface ConversationSectionProps extends SectionCommonProps {
    settings: Settings;
    onSave: (settings: Settings) => Promise<void>;
}

const DRAFT_KEYS = ['defaultUserName', 'temperature', 'holidayCalendarEnabled'] as const satisfies readonly (keyof Settings)[];

type ManageWindow = 'schema' | 'emotion' | 'replacement' | null;

const fill = (template: string, values: Record<string, string | number>) =>
    Object.entries(values).reduce((text, [key, value]) => text.split(`{{${key}}}`).join(String(value)), template);

export const ConversationSection = React.forwardRef<SectionHandle, ConversationSectionProps>(
    ({ settings, onSave, onDirtyChange, uiCatalog }, ref) => {
        const t = (key: string) => resolveMessage(
            uiCatalog,
            key,
            SETTINGS_VIEW_TEXT_FALLBACK_JA[key]
                || SETTINGS_TEXT_FALLBACK_JA[key]
                || BASIC_SETTINGS_TEXT_FALLBACK_JA[key]
                || EMOTION_CATALOG_TEXT_FALLBACK_JA[key]
                || key,
        );
        const { draft, update, revert, isDirty, merged } = useSettingsDraft(settings, DRAFT_KEYS);
        const [openWindow, setOpenWindow] = useState<ManageWindow>(null);
        const [rebuilding, setRebuilding] = useState(false);
        const isJapaneseUI = settings.uiLanguage === DEFAULT_UI_LANGUAGE;

        useEffect(() => { onDirtyChange(isDirty); }, [isDirty, onDirtyChange]);

        useImperativeHandle(ref, () => ({
            save: async () => {
                try {
                    const next = merged();
                    // 祝日カレンダーは日本語 UI 専用
                    await onSave(isJapaneseUI ? next : { ...next, holidayCalendarEnabled: false });
                    return [];
                } catch {
                    return [t(SETTINGS_VIEW_I18N_KEYS.categoryConversation)];
                }
            },
            revert,
        }));

        // キャラのタグの更新は押した時点で実行する
        const handleRebuildTags = async () => {
            setRebuilding(true);
            try {
                const result = await rebuildCharacterFilters();
                window.alert(fill(t(SETTINGS_I18N_KEYS.tagMasterSuccess), {
                    totalCharacters: result.stats.totalCharacters,
                    withTags: result.stats.withTags,
                    withoutTags: result.stats.withoutTags,
                    works: result.works.length,
                    tags: result.tags.length,
                }));
            } catch (error) {
                window.alert(t(SETTINGS_I18N_KEYS.tagMasterFailure));
                console.error(error);
            }
            setRebuilding(false);
        };

        return (
            <>
                <SettingsGroup title={t(SETTINGS_VIEW_I18N_KEYS.categoryConversation)}>
                    <SettingRow title={t(SETTINGS_I18N_KEYS.defaultUserNameLabel)} description={t(SETTINGS_I18N_KEYS.defaultUserNameDescription)}>
                        <TextField
                            value={draft.defaultUserName || ''}
                            onChange={(e) => update({ defaultUserName: e.target.value })}
                            placeholder={t(SETTINGS_I18N_KEYS.defaultUserNamePlaceholder)}
                        />
                    </SettingRow>
                    <SettingRow title={t(BASIC_SETTINGS_I18N_KEYS.temperature)} description={t(BASIC_SETTINGS_I18N_KEYS.temperatureDescription)}>
                        <RangeControl
                            label={t(BASIC_SETTINGS_I18N_KEYS.temperature)}
                            value={draft.temperature ?? 1}
                            min={0}
                            max={2}
                            step={0.1}
                            onChange={(value) => update({ temperature: value })}
                            display={(draft.temperature ?? 1).toFixed(1)}
                        />
                    </SettingRow>
                    {isJapaneseUI && (
                        <SettingRow
                            title={t(SETTINGS_I18N_KEYS.holidayCalendarLabel)}
                            description={t(SETTINGS_I18N_KEYS.holidayCalendarDescription)}
                            compactControl
                        >
                            <Toggle checked={draft.holidayCalendarEnabled ?? false} onChange={(on) => update({ holidayCalendarEnabled: on })} />
                        </SettingRow>
                    )}
                </SettingsGroup>

                <SettingsGroup title={t(SETTINGS_VIEW_I18N_KEYS.groupManage)}>
                    <SettingRow title={t(EMOTION_CATALOG_I18N_KEYS.manageButton)} description={t(EMOTION_CATALOG_I18N_KEYS.manageDescription)} compactControl>
                        <Button size="sm" onClick={() => setOpenWindow('emotion')}>{t(SETTINGS_VIEW_I18N_KEYS.manage)}</Button>
                    </SettingRow>
                    <SettingRow title={t(SETTINGS_I18N_KEYS.schemaManagerLabel)} description={t(SETTINGS_I18N_KEYS.schemaManagerDescription)} compactControl>
                        <Button size="sm" onClick={() => setOpenWindow('schema')}>{t(SETTINGS_VIEW_I18N_KEYS.manage)}</Button>
                    </SettingRow>
                    <SettingRow title={t(SETTINGS_I18N_KEYS.replacementConfigLabel)} description={t(SETTINGS_I18N_KEYS.replacementConfigDescription)} compactControl>
                        <Button size="sm" onClick={() => setOpenWindow('replacement')}>{t(SETTINGS_VIEW_I18N_KEYS.manage)}</Button>
                    </SettingRow>
                    <SettingRow title={t(SETTINGS_I18N_KEYS.tagMasterButton)} description={t(SETTINGS_I18N_KEYS.tagMasterDescription)} compactControl>
                        <Button size="sm" disabled={rebuilding} onClick={() => void handleRebuildTags()}>{t(SETTINGS_VIEW_I18N_KEYS.run)}</Button>
                    </SettingRow>
                </SettingsGroup>

                <ParameterSchemaEditorModal isOpen={openWindow === 'schema'} onClose={() => setOpenWindow(null)} uiCatalog={uiCatalog} />
                <EmotionCatalogModal isOpen={openWindow === 'emotion'} onClose={() => setOpenWindow(null)} backendUrl={BACKEND_URL} uiCatalog={uiCatalog} />
                <ReplacementConfigModal isOpen={openWindow === 'replacement'} onClose={() => setOpenWindow(null)} backendUrl={BACKEND_URL} uiCatalog={uiCatalog} />
            </>
        );
    },
);
ConversationSection.displayName = 'ConversationSection';
