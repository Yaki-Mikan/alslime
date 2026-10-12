/**
 * SettingsView.tsx - 設定画面
 *
 * 左に分類、右に中身。中身は分類ごとの部品（settings/sections）。
 * 見た目と操作は押した時点で反映し、それ以外は分類ごとの下書きを下の帯の「保存」でまとめて保存する。
 * 保存していない変更があるまま別の分類・画面へ移るときは「保存する／破棄する／戻る」を確かめる。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, ChevronLeft, ChevronRight, CircleHelp, MessageSquare, Palette, Server, SlidersHorizontal, Sparkles, UserRound } from 'lucide-react';
import { formatLabelValue, joinList, resolveMessage, type I18NCatalog } from '../../api/i18n';
import type { ModuleStatusEntry } from '../../api/sponsor';
import type { ApiProviderInstructionTarget } from '../../api/api-providers';
import { SETTINGS_VIEW_I18N_KEYS, SETTINGS_VIEW_TEXT_FALLBACK_JA } from '../../constants/i18n';
import type { Settings } from '../../types/Settings';
import { Button, Modal, cn } from '../ui';
import { GeneralSection } from './sections/GeneralSection';
import { AiSection } from './sections/AiSection';
import { ConversationSection } from './sections/ConversationSection';
import { SystemSection } from './sections/SystemSection';
import { AccountSection, HelpSection, SamplesSection } from './sections/SimpleSections';
import { MediaSection, type MediaMaterialTab } from './sections/media/MediaSection';
import type { SectionHandle } from './sections/sectionTypes';

export type SettingsCategory = 'general' | 'ai' | 'conversation' | 'media' | 'system' | 'samples' | 'account' | 'help';

/** 別の画面へ移る前に呼ぶ関所。保存していない変更があれば確かめてから proceed を呼ぶ */
export type LeaveGuard = (proceed: () => void) => void;

interface SettingsViewProps {
    settings: Settings;
    onSave: (settings: Settings) => Promise<void>;
    uiCatalog: I18NCatalog | null;
    onLogout?: () => void;
    onModelsChanged?: () => void;
    onModulesChanged?: (modules: ModuleStatusEntry[]) => void;
    onOpenApiProviderInstruction?: (target: ApiProviderInstructionTarget) => void;
    imageGenAvailable: boolean;
    ttsAvailable: boolean;
    /** 素材づくりの指定のタブを開く（画像生成・読み上げの分類から） */
    onOpenMaterial: (tab: MediaMaterialTab) => void;
    /** 開いたときに見せる分類 */
    initialCategory?: SettingsCategory;
    registerLeaveGuard: (guard: LeaveGuard | null) => void;
}

const CATEGORY_ICONS: Record<SettingsCategory, React.ReactNode> = {
    general: <SlidersHorizontal size={17} />,
    ai: <Bot size={17} />,
    conversation: <MessageSquare size={17} />,
    media: <Palette size={17} />,
    system: <Server size={17} />,
    samples: <Sparkles size={17} />,
    account: <UserRound size={17} />,
    help: <CircleHelp size={17} />,
};

const CATEGORY_KEYS: Record<SettingsCategory, string> = {
    general: SETTINGS_VIEW_I18N_KEYS.categoryGeneral,
    ai: SETTINGS_VIEW_I18N_KEYS.categoryAi,
    conversation: SETTINGS_VIEW_I18N_KEYS.categoryConversation,
    media: SETTINGS_VIEW_I18N_KEYS.categoryMedia,
    system: SETTINGS_VIEW_I18N_KEYS.categorySystem,
    samples: SETTINGS_VIEW_I18N_KEYS.categorySamples,
    account: SETTINGS_VIEW_I18N_KEYS.categoryAccount,
    help: SETTINGS_VIEW_I18N_KEYS.categoryHelp,
};

export const SettingsView: React.FC<SettingsViewProps> = ({
    settings,
    onSave,
    uiCatalog,
    onLogout,
    onModelsChanged,
    onModulesChanged,
    onOpenApiProviderInstruction,
    imageGenAvailable,
    ttsAvailable,
    onOpenMaterial,
    initialCategory = 'general',
    registerLeaveGuard,
}) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, SETTINGS_VIEW_TEXT_FALLBACK_JA[key] || key);
    const hasMedia = imageGenAvailable || ttsAvailable;
    const categories: SettingsCategory[] = [
        'general',
        'ai',
        'conversation',
        ...(hasMedia ? ['media' as const] : []),
        'system',
        'samples',
        'account',
        'help',
    ];

    // 開いたときの分類。設定画面は開くたびに作り直されるので、最初の値だけを使う
    const [selectedCategory, setCategory] = useState<SettingsCategory>(initialCategory);
    // 表示中の分類が使えなくなったとき（支援者の権利が切れたなど）は一般として見せる
    const category: SettingsCategory = selectedCategory === 'media' && !hasMedia ? 'general' : selectedCategory;
    // 狭い画面では、分類の一覧と中身を切り替えて見せる
    const [showContentOnNarrow, setShowContentOnNarrow] = useState(initialCategory !== 'general');
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [failedItems, setFailedItems] = useState<string[]>([]);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const sectionRef = useRef<SectionHandle>(null);
    const pendingRef = useRef<(() => void) | null>(null);
    const dirtyRef = useRef(false);

    useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

    const handleDirtyChange = useCallback((value: boolean) => {
        setDirty(value);
        if (!value) setFailedItems([]);
    }, []);

    const guard = useCallback<LeaveGuard>((proceed) => {
        if (!dirtyRef.current) {
            proceed();
            return;
        }
        pendingRef.current = proceed;
        setConfirmOpen(true);
    }, []);

    useEffect(() => {
        registerLeaveGuard(guard);
        return () => registerLeaveGuard(null);
    }, [guard, registerLeaveGuard]);

    const save = async (): Promise<boolean> => {
        if (!sectionRef.current) return true;
        setSaving(true);
        const failed = await sectionRef.current.save();
        setSaving(false);
        setFailedItems(failed);
        return failed.length === 0;
    };

    const runPending = () => {
        const proceed = pendingRef.current;
        pendingRef.current = null;
        proceed?.();
    };

    const selectCategory = (next: SettingsCategory) => {
        guard(() => {
            setCategory(next);
            setDirty(false);
            setFailedItems([]);
            setShowContentOnNarrow(true);
        });
    };

    const common = { onDirtyChange: handleDirtyChange, uiCatalog };
    const section = (() => {
        switch (category) {
            case 'general':
                return <GeneralSection ref={sectionRef} {...common} settings={settings} onSave={onSave} imageGenAvailable={imageGenAvailable} />;
            case 'ai':
                return <AiSection ref={sectionRef} {...common} onModelsChanged={onModelsChanged} onOpenApiProviderInstruction={onOpenApiProviderInstruction} />;
            case 'conversation':
                return <ConversationSection ref={sectionRef} {...common} settings={settings} onSave={onSave} />;
            case 'media':
                return (
                    <MediaSection
                        ref={sectionRef}
                        {...common}
                        imageGenAvailable={imageGenAvailable}
                        ttsAvailable={ttsAvailable}
                        onOpenMaterial={onOpenMaterial}
                    />
                );
            case 'system':
                return <SystemSection ref={sectionRef} {...common} settings={settings} onSave={onSave} onModulesChanged={onModulesChanged} />;
            case 'samples':
                return <SamplesSection uiCatalog={uiCatalog} />;
            case 'account':
                return <AccountSection uiCatalog={uiCatalog} uiLanguage={settings.uiLanguage} onLogout={onLogout} onModulesChanged={onModulesChanged} />;
            case 'help':
                return <HelpSection uiCatalog={uiCatalog} uiLanguage={settings.uiLanguage} />;
        }
    })();

    return (
        <div className="flex-1 min-h-0 flex">
            {/* 分類の一覧 */}
            <nav
                className={cn(
                    'w-full md:w-60 shrink-0 md:border-r border-line overflow-auto px-3 py-6',
                    showContentOnNarrow ? 'hidden md:block' : 'block',
                )}
            >
                <h1 className="px-3 mb-4 font-head text-lg font-bold tracking-wide">{resolveMessage(uiCatalog, 'settings.title', '設定')}</h1>
                <ul className="flex flex-col gap-0.5">
                    {categories.map(id => (
                        <li key={id}>
                            <button
                                type="button"
                                onClick={() => selectCategory(id)}
                                aria-current={id === category ? 'page' : undefined}
                                className={cn(
                                    'w-full flex items-center gap-3 px-3 h-10 rounded-ui text-sm text-left transition-colors',
                                    id === category ? 'md:bg-accent-soft text-fg md:font-semibold' : 'text-fg-muted hover:text-fg hover:bg-surface',
                                )}
                            >
                                {CATEGORY_ICONS[id]}
                                <span className="flex-1">{t(CATEGORY_KEYS[id])}</span>
                                <ChevronRight size={16} className="md:hidden text-fg-muted" />
                            </button>
                        </li>
                    ))}
                </ul>
            </nav>

            {/* 中身 */}
            <div className={cn('flex-1 min-w-0 flex-col', showContentOnNarrow ? 'flex' : 'hidden md:flex')}>
                <div className="flex-1 min-h-0 overflow-auto">
                    <div className="max-w-3xl mx-auto px-4 sm:px-8 py-6 sm:py-8">
                        <div className="flex items-center gap-1 mb-6">
                            <button
                                type="button"
                                onClick={() => guard(() => setShowContentOnNarrow(false))}
                                className="md:hidden -ml-2 p-1.5 rounded-ui text-fg-muted hover:text-fg hover:bg-surface"
                                aria-label={t(SETTINGS_VIEW_I18N_KEYS.backToList)}
                                title={t(SETTINGS_VIEW_I18N_KEYS.backToList)}
                            >
                                <ChevronLeft size={20} />
                            </button>
                            <h2 className="font-head text-lg font-bold tracking-wide">{t(CATEGORY_KEYS[category])}</h2>
                        </div>
                        {/* 分類を変えたら部品を作り直し、下書きを持ち越さない */}
                        <div key={category}>{section}</div>
                    </div>
                </div>

                {dirty && (
                    <div className="shrink-0 border-t border-line bg-panel px-4 sm:px-8 py-3">
                        <div className="max-w-3xl mx-auto flex flex-wrap items-center gap-x-4 gap-y-2">
                            <div className="flex-1 min-w-0 text-sm">
                                <p className="text-fg">{t(SETTINGS_VIEW_I18N_KEYS.unsavedTitle)}</p>
                                {failedItems.length > 0 && (
                                    <p className="text-xs text-danger">
                                        {formatLabelValue(uiCatalog, t(SETTINGS_VIEW_I18N_KEYS.saveFailed), joinList(uiCatalog, failedItems))}
                                    </p>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <Button variant="ghost" disabled={saving} onClick={() => sectionRef.current?.revert()}>
                                    {t(SETTINGS_VIEW_I18N_KEYS.revert)}
                                </Button>
                                <Button variant="primary" disabled={saving} onClick={() => void save()}>
                                    {t(SETTINGS_VIEW_I18N_KEYS.save)}
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <Modal
                open={confirmOpen}
                onClose={() => { pendingRef.current = null; setConfirmOpen(false); }}
                title={t(SETTINGS_VIEW_I18N_KEYS.unsavedTitle)}
                size="sm"
                closeLabel={t(SETTINGS_VIEW_I18N_KEYS.unsavedBack)}
                footer={(
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="ghost" onClick={() => { pendingRef.current = null; setConfirmOpen(false); }}>
                            {t(SETTINGS_VIEW_I18N_KEYS.unsavedBack)}
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => {
                                sectionRef.current?.revert();
                                setDirty(false);
                                setConfirmOpen(false);
                                runPending();
                            }}
                        >
                            {t(SETTINGS_VIEW_I18N_KEYS.unsavedDiscard)}
                        </Button>
                        <Button
                            variant="primary"
                            disabled={saving}
                            onClick={async () => {
                                const ok = await save();
                                setConfirmOpen(false);
                                if (ok) {
                                    setDirty(false);
                                    runPending();
                                } else {
                                    // 保存できなかった項目は帯に出し、この分類に留まる
                                    pendingRef.current = null;
                                }
                            }}
                        >
                            {t(SETTINGS_VIEW_I18N_KEYS.unsavedSave)}
                        </Button>
                    </div>
                )}
            >
                <p className="p-5 text-sm text-fg-muted">{t(SETTINGS_VIEW_I18N_KEYS.unsavedMessage)}</p>
            </Modal>
        </div>
    );
};

export default SettingsView;
