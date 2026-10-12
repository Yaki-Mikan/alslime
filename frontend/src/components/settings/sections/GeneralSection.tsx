import React, { useEffect, useImperativeHandle, useState } from 'react';
import { fetchI18NLanguages, resolveMessage } from '../../../api/i18n';
import { BACKEND_URL } from '../../../api/base-url';
import {
    BASIC_SETTINGS_I18N_KEYS,
    BASIC_SETTINGS_TEXT_FALLBACK_JA,
    DEFAULT_UI_LANGUAGE,
    SETTINGS_I18N_KEYS,
    SETTINGS_TEXT_FALLBACK_JA,
    SETTINGS_VIEW_I18N_KEYS,
    SETTINGS_VIEW_TEXT_FALLBACK_JA,
    UI_LANGUAGE_LABELS,
    UI_LANGUAGE_OPTIONS,
} from '../../../constants/i18n';
import {
    CHAT_SEND_KEYS,
    DEFAULT_CHAT_SEND_KEY,
    FONT_FAMILY_DESIGN,
    FONT_FAMILY_SYSTEM,
    type ChatSendKey,
    type Settings,
    type UIDesign,
    type UITheme,
} from '../../../types/Settings';
import { Segmented, Select, SettingRow, Toggle } from '../../ui';
import { RangeControl, SettingsGroup } from './parts';
import { useSettingsDraft, type SectionCommonProps, type SectionHandle } from './sectionTypes';

interface GeneralSectionProps extends SectionCommonProps {
    settings: Settings;
    onSave: (settings: Settings) => Promise<void>;
    /** 背景画像は会話で生成した画像を使うため、画像生成が使えるときだけ出す */
    imageGenAvailable: boolean;
}

// この分類が下書きで受け持つ項目（見た目の3つは選んだ時点で保存するので含めない）
const DRAFT_KEYS = [
    'fontFamily',
    'fontSize',
    'lineHeight',
    'emptyLineHeight',
    'collapseEmptyLines',
    'characterIconSize',
    'characterIconOnBubbleLeft',
    'chatSendKey',
    'enableBackgroundImage',
    'backgroundImageOpacity',
    'messageBubbleOpacity',
    'backgroundPanelOpacity',
    'backgroundImageFit',
    'backgroundImageScope',
    'backgroundChatInputAreaOpacity',
    'backgroundChatInputAreaMatchImageOpacity',
] as const satisfies readonly (keyof Settings)[];

const FONT_OPTIONS: Array<{ value: string; labelKey: string }> = [
    { value: FONT_FAMILY_DESIGN, labelKey: BASIC_SETTINGS_I18N_KEYS.fontDesign },
    { value: FONT_FAMILY_SYSTEM, labelKey: BASIC_SETTINGS_I18N_KEYS.fontSystem },
    { value: '"Noto Sans JP", sans-serif', labelKey: BASIC_SETTINGS_I18N_KEYS.fontNotoSansJP },
    { value: '"Hiragino Sans", sans-serif', labelKey: BASIC_SETTINGS_I18N_KEYS.fontHiragino },
    { value: '"Yu Gothic", sans-serif', labelKey: BASIC_SETTINGS_I18N_KEYS.fontYuGothic },
    { value: '"Meiryo", sans-serif', labelKey: BASIC_SETTINGS_I18N_KEYS.fontMeiryo },
    { value: '"Shippori Mincho", serif', labelKey: BASIC_SETTINGS_I18N_KEYS.fontShipporiMincho },
    { value: 'monospace', labelKey: BASIC_SETTINGS_I18N_KEYS.fontMonospace },
];

const ICON_SIZE_OPTIONS = [40, 100, 150, 200, 250, 300, 350, 400, 450, 500];

const percent = (value: number) => `${Math.round(value * 100)}%`;

export const GeneralSection = React.forwardRef<SectionHandle, GeneralSectionProps>(
    ({ settings, onSave, imageGenAvailable, onDirtyChange, uiCatalog }, ref) => {
        const t = (key: string) => resolveMessage(
            uiCatalog,
            key,
            SETTINGS_VIEW_TEXT_FALLBACK_JA[key] || SETTINGS_TEXT_FALLBACK_JA[key] || BASIC_SETTINGS_TEXT_FALLBACK_JA[key] || key,
        );
        const { draft, update, revert, isDirty, merged } = useSettingsDraft(settings, DRAFT_KEYS);
        const [languageOptions, setLanguageOptions] = useState(UI_LANGUAGE_OPTIONS);
        const [savingAppearance, setSavingAppearance] = useState(false);

        useEffect(() => { onDirtyChange(isDirty); }, [isDirty, onDirtyChange]);

        useEffect(() => {
            fetchI18NLanguages(BACKEND_URL)
                .then(res => setLanguageOptions(res.languages.map(lang => ({ value: lang, label: UI_LANGUAGE_LABELS[lang] || lang }))))
                .catch(() => setLanguageOptions(UI_LANGUAGE_OPTIONS));
        }, []);

        useImperativeHandle(ref, () => ({
            save: async () => {
                try {
                    await onSave(merged());
                    return [];
                } catch {
                    return [t(SETTINGS_VIEW_I18N_KEYS.categoryGeneral)];
                }
            },
            revert,
        }));

        // 見た目は選んだ時点で保存する。保存済みの設定に重ねるので、下書き中の項目には触れない
        const saveAppearance = async (patch: Partial<Settings>) => {
            setSavingAppearance(true);
            try {
                await onSave({ ...settings, ...patch });
            } catch (error) {
                console.error('Failed to save appearance:', error);
            }
            setSavingAppearance(false);
        };

        const fontOptions = FONT_OPTIONS.some(font => font.value === draft.fontFamily)
            ? FONT_OPTIONS
            : [...FONT_OPTIONS, { value: draft.fontFamily, labelKey: draft.fontFamily }];
        const bgFit = draft.backgroundImageFit ?? 'cover';
        const bgScope = draft.backgroundImageScope ?? 'history';

        return (
            <>
                <SettingsGroup title={t(SETTINGS_VIEW_I18N_KEYS.groupAppearance)} note={t(SETTINGS_VIEW_I18N_KEYS.groupAppearanceNote)}>
                    <SettingRow title={t(SETTINGS_I18N_KEYS.uiLanguageTitle)} description={t(SETTINGS_I18N_KEYS.uiLanguageDescription)}>
                        <Select
                            value={settings.uiLanguage}
                            disabled={savingAppearance}
                            onChange={(lang) => void saveAppearance({
                                uiLanguage: lang,
                                // 祝日カレンダーは日本語 UI 専用のため、ほかの言語では切る
                                holidayCalendarEnabled: lang === DEFAULT_UI_LANGUAGE ? settings.holidayCalendarEnabled : false,
                            })}
                            options={languageOptions}
                        />
                    </SettingRow>
                    <SettingRow title={t(BASIC_SETTINGS_I18N_KEYS.design)}>
                        <Segmented<UIDesign>
                            label={t(BASIC_SETTINGS_I18N_KEYS.design)}
                            value={settings.uiDesign}
                            onChange={(value) => void saveAppearance({ uiDesign: value })}
                            options={[
                                { value: 'minimal', label: t(BASIC_SETTINGS_I18N_KEYS.designMinimal) },
                                { value: 'wa', label: t(BASIC_SETTINGS_I18N_KEYS.designWa) },
                                { value: 'glass', label: t(BASIC_SETTINGS_I18N_KEYS.designGlass) },
                            ]}
                            block
                        />
                    </SettingRow>
                    <SettingRow title={t(BASIC_SETTINGS_I18N_KEYS.theme)}>
                        <Segmented<UITheme>
                            label={t(BASIC_SETTINGS_I18N_KEYS.theme)}
                            value={settings.theme}
                            onChange={(value) => void saveAppearance({ theme: value })}
                            options={[
                                { value: 'dark', label: t(BASIC_SETTINGS_I18N_KEYS.themeDark) },
                                { value: 'light', label: t(BASIC_SETTINGS_I18N_KEYS.themeLight) },
                                { value: 'system', label: t(BASIC_SETTINGS_I18N_KEYS.themeSystem) },
                            ]}
                            block
                        />
                    </SettingRow>
                </SettingsGroup>

                <SettingsGroup title={t(SETTINGS_VIEW_I18N_KEYS.groupReading)}>
                    <SettingRow title={t(BASIC_SETTINGS_I18N_KEYS.font)}>
                        <Select
                            value={draft.fontFamily}
                            onChange={(value) => update({ fontFamily: value })}
                            options={fontOptions.map(font => ({ value: font.value, label: t(font.labelKey) }))}
                        />
                    </SettingRow>
                    <SettingRow title={t(BASIC_SETTINGS_I18N_KEYS.fontSize)}>
                        <RangeControl
                            label={t(BASIC_SETTINGS_I18N_KEYS.fontSize)}
                            value={draft.fontSize || 14}
                            min={10}
                            max={24}
                            step={1}
                            onChange={(value) => update({ fontSize: value })}
                            display={`${draft.fontSize || 14}px`}
                        />
                    </SettingRow>
                    <SettingRow title={t(BASIC_SETTINGS_I18N_KEYS.lineHeight)}>
                        <RangeControl
                            label={t(BASIC_SETTINGS_I18N_KEYS.lineHeight)}
                            value={draft.lineHeight || 1.625}
                            min={1}
                            max={2.5}
                            step={0.05}
                            onChange={(value) => update({ lineHeight: value })}
                            display={`${(draft.lineHeight || 1.625).toFixed(2)} em`}
                        />
                    </SettingRow>
                    <SettingRow title={t(BASIC_SETTINGS_I18N_KEYS.emptyLineHeight)}>
                        <RangeControl
                            label={t(BASIC_SETTINGS_I18N_KEYS.emptyLineHeight)}
                            value={draft.emptyLineHeight}
                            min={0.2}
                            max={2}
                            step={0.1}
                            onChange={(value) => update({ emptyLineHeight: value })}
                            display={`${draft.emptyLineHeight.toFixed(1)} em`}
                        />
                    </SettingRow>
                    <SettingRow
                        title={t(BASIC_SETTINGS_I18N_KEYS.collapseEmptyLines)}
                        description={t(BASIC_SETTINGS_I18N_KEYS.collapseEmptyLinesDescription)}
                        compactControl
                    >
                        <Toggle checked={draft.collapseEmptyLines ?? true} onChange={(on) => update({ collapseEmptyLines: on })} />
                    </SettingRow>
                </SettingsGroup>

                <SettingsGroup title={t(SETTINGS_I18N_KEYS.characterDisplayTitle)}>
                    <SettingRow title={t(SETTINGS_I18N_KEYS.characterIconSizeLabel)} description={t(SETTINGS_I18N_KEYS.characterDisplayDescription)}>
                        <Select
                            value={String(draft.characterIconSize || 40)}
                            onChange={(value) => update({ characterIconSize: Number(value) })}
                            options={ICON_SIZE_OPTIONS.map(size => ({
                                value: String(size),
                                label: size === 40
                                    ? t(SETTINGS_I18N_KEYS.characterIconSmall)
                                    : size === 500 ? t(SETTINGS_I18N_KEYS.characterIconMax) : `${size}px`,
                            }))}
                        />
                    </SettingRow>
                    <SettingRow
                        title={t(SETTINGS_I18N_KEYS.characterIconOnBubbleLeftLabel)}
                        description={t(SETTINGS_I18N_KEYS.characterIconOnBubbleLeftDescription)}
                        compactControl
                    >
                        <Toggle checked={draft.characterIconOnBubbleLeft ?? false} onChange={(on) => update({ characterIconOnBubbleLeft: on })} />
                    </SettingRow>
                </SettingsGroup>

                <SettingsGroup title={t(SETTINGS_VIEW_I18N_KEYS.groupInput)}>
                    <SettingRow title={t(SETTINGS_I18N_KEYS.chatSendKeyLabel)} description={t(SETTINGS_I18N_KEYS.chatSendKeyDescription)}>
                        <Select
                            value={draft.chatSendKey ?? DEFAULT_CHAT_SEND_KEY}
                            onChange={(value) => update({ chatSendKey: value as ChatSendKey })}
                            options={[
                                { value: CHAT_SEND_KEYS.enter, label: t(SETTINGS_I18N_KEYS.chatSendKeyEnter) },
                                { value: CHAT_SEND_KEYS.shiftEnter, label: t(SETTINGS_I18N_KEYS.chatSendKeyShiftEnter) },
                                { value: CHAT_SEND_KEYS.ctrlEnter, label: t(SETTINGS_I18N_KEYS.chatSendKeyCtrlEnter) },
                            ]}
                        />
                    </SettingRow>
                </SettingsGroup>

                {imageGenAvailable && (
                    <SettingsGroup title={t(SETTINGS_VIEW_I18N_KEYS.groupBackground)}>
                        <SettingRow
                            title={t(BASIC_SETTINGS_I18N_KEYS.backgroundImage)}
                            description={t(BASIC_SETTINGS_I18N_KEYS.backgroundImageDescription)}
                            compactControl
                        >
                            <Toggle checked={draft.enableBackgroundImage ?? false} onChange={(on) => update({ enableBackgroundImage: on })} />
                        </SettingRow>
                        {(draft.enableBackgroundImage ?? false) && (
                            <>
                                <SettingRow title={t(BASIC_SETTINGS_I18N_KEYS.backgroundOpacity)}>
                                    <RangeControl
                                        label={t(BASIC_SETTINGS_I18N_KEYS.backgroundOpacity)}
                                        value={draft.backgroundImageOpacity ?? 1}
                                        min={0.1}
                                        max={1}
                                        step={0.05}
                                        onChange={(value) => update({ backgroundImageOpacity: value })}
                                        display={percent(draft.backgroundImageOpacity ?? 1)}
                                    />
                                </SettingRow>
                                <SettingRow title={t(BASIC_SETTINGS_I18N_KEYS.messageBubbleOpacity)}>
                                    <RangeControl
                                        label={t(BASIC_SETTINGS_I18N_KEYS.messageBubbleOpacity)}
                                        value={draft.messageBubbleOpacity ?? 0.8}
                                        min={0.3}
                                        max={1}
                                        step={0.05}
                                        onChange={(value) => update({ messageBubbleOpacity: value })}
                                        display={percent(draft.messageBubbleOpacity ?? 0.8)}
                                    />
                                </SettingRow>
                                <SettingRow
                                    title={t(BASIC_SETTINGS_I18N_KEYS.imageFit)}
                                    description={bgFit === 'cover'
                                        ? t(BASIC_SETTINGS_I18N_KEYS.imageFitCoverDescription)
                                        : t(BASIC_SETTINGS_I18N_KEYS.imageFitContainDescription)}
                                >
                                    <Segmented<'cover' | 'contain'>
                                        label={t(BASIC_SETTINGS_I18N_KEYS.imageFit)}
                                        value={bgFit}
                                        onChange={(value) => update({ backgroundImageFit: value })}
                                        options={[
                                            { value: 'cover', label: t(BASIC_SETTINGS_I18N_KEYS.imageFitCover) },
                                            { value: 'contain', label: t(BASIC_SETTINGS_I18N_KEYS.imageFitContain) },
                                        ]}
                                        block
                                    />
                                </SettingRow>
                                {bgFit === 'cover' && (
                                    <SettingRow
                                        title={t(BASIC_SETTINGS_I18N_KEYS.imageScope)}
                                        description={bgScope === 'chat'
                                            ? t(BASIC_SETTINGS_I18N_KEYS.imageScopeChatDescription)
                                            : t(BASIC_SETTINGS_I18N_KEYS.imageScopeHistoryDescription)}
                                    >
                                        <Segmented<'history' | 'chat'>
                                            label={t(BASIC_SETTINGS_I18N_KEYS.imageScope)}
                                            value={bgScope}
                                            onChange={(value) => update({ backgroundImageScope: value })}
                                            options={[
                                                { value: 'history', label: t(BASIC_SETTINGS_I18N_KEYS.imageScopeHistory) },
                                                { value: 'chat', label: t(BASIC_SETTINGS_I18N_KEYS.imageScopeChat) },
                                            ]}
                                            block
                                        />
                                    </SettingRow>
                                )}
                                {bgFit === 'cover' && bgScope === 'chat' && (
                                    <>
                                        <SettingRow title={t(BASIC_SETTINGS_I18N_KEYS.matchImageOpacity)} compactControl>
                                            <Toggle
                                                checked={draft.backgroundChatInputAreaMatchImageOpacity ?? false}
                                                onChange={(on) => update({ backgroundChatInputAreaMatchImageOpacity: on })}
                                            />
                                        </SettingRow>
                                        <SettingRow title={t(BASIC_SETTINGS_I18N_KEYS.chatInputAreaOpacity)}>
                                            <RangeControl
                                                label={t(BASIC_SETTINGS_I18N_KEYS.chatInputAreaOpacity)}
                                                value={draft.backgroundChatInputAreaOpacity ?? 0.45}
                                                min={0}
                                                max={1}
                                                step={0.05}
                                                disabled={draft.backgroundChatInputAreaMatchImageOpacity ?? false}
                                                onChange={(value) => update({ backgroundChatInputAreaOpacity: value })}
                                                display={(draft.backgroundChatInputAreaMatchImageOpacity ?? false)
                                                    ? t(BASIC_SETTINGS_I18N_KEYS.opacitySameAsBackground)
                                                    : percent(draft.backgroundChatInputAreaOpacity ?? 0.45)}
                                            />
                                        </SettingRow>
                                    </>
                                )}
                            </>
                        )}
                    </SettingsGroup>
                )}
            </>
        );
    },
);
GeneralSection.displayName = 'GeneralSection';
