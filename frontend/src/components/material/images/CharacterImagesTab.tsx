/**
 * CharacterImagesTab.tsx - 素材づくりの「キャラ」
 *
 * 左にキャラ一覧、右に選んだキャラの「画像の設定」「声の紐づけ」「表情ごとの画像」「試しに生成」。
 * キャラごとの画像と声は、ここで一覧から選んだキャラについてまとめて設定する。
 * 画像生成が使えないときは画像の区画を、読み上げが使えないときは声の紐づけを出さない。
 * 「試しに生成」は、保存した画像設定で作る（保存前の編集は使わない）。
 * 一覧で複数を選ぶと、LoRA をまとめて設定できる。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, FileText, Layers } from 'lucide-react';
import { resolveMessage, type I18NCatalog } from '../../../api/i18n';
import type { CharacterTagInfo } from '../../../api/files';
import { getComfyUIConfig, listComfyUITemplates, type TemplateInfo } from '../../../api/comfyui';
import {
    CONFIG_EDITOR_I18N_KEYS,
    CONFIG_EDITOR_TEXT_FALLBACK_JA,
    MATERIAL_I18N_KEYS,
    MATERIAL_TEXT_FALLBACK_JA,
} from '../../../constants/i18n';
import { useMaterialStatus } from '../../../hooks/useMaterialStatus';
import type { AppearancePromptHandle } from '../../../hooks/useAppearancePromptGen';
import { CharacterSaveBar } from '../../comfyui/integrated/CharacterSaveBar';
import { IntegratedCharacterSection } from '../../comfyui/integrated/IntegratedCharacterSection';
import { IntegratedDanbooruSearch } from '../../comfyui/integrated/IntegratedDanbooruSearch';
import { useDanbooruTagFormat } from '../../comfyui/useDanbooruTagFormat';
import { IntegratedGenerateTestSection } from '../../comfyui/integrated/IntegratedGenerateTestSection';
import { useCharacterImageGenEditor } from '../../comfyui/useCharacterImageGenEditor';
import { useComfyLoras } from '../../comfyui/useComfyLoras';
import { EmotionImageTab } from '../../settings/character/EmotionImageTab';
import { TTSCharacterAssignForm } from '../../tts/TTSCharacterAssignForm';
import { Button, IconButton, Modal, Segmented, Select, cn } from '../../ui';
import { CharacterListPane } from '../CharacterListPane';
import { BulkLoraModal } from './BulkLoraModal';

export type CharacterSection = 'settings' | 'voice' | 'faces' | 'test';
type Section = CharacterSection;

interface CharacterImagesTabProps {
    backendUrl: string;
    uiCatalog: I18NCatalog | null;
    active: boolean;
    /** 画像の設定・表情ごとの画像・試しに生成を出すか（画像生成が使えるとき） */
    imageGenEnabled: boolean;
    /** 声の紐づけと、一覧の声の点・絞り込みを出すか（読み上げが使えるとき） */
    ttsEnabled: boolean;
    sessionCharacterPaths: string[];
    /** 外から選ぶキャラ（キャラ名かディレクトリ名） */
    initialCharacter?: string;
    /** 外から選ぶキャラと一緒に開く区画（準備・調整欄の声のアイコンからは声の紐づけ） */
    initialSection?: Section;
    appearancePrompt?: AppearancePromptHandle;
    /** 選んだキャラの設定ファイルを開く */
    onOpenFile: (character: CharacterTagInfo) => void;
}

export const CharacterImagesTab: React.FC<CharacterImagesTabProps> = ({
    backendUrl,
    uiCatalog,
    active,
    imageGenEnabled,
    ttsEnabled,
    sessionCharacterPaths,
    initialCharacter,
    initialSection,
    appearancePrompt,
    onOpenFile,
}) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, MATERIAL_TEXT_FALLBACK_JA[key] || CONFIG_EDITOR_TEXT_FALLBACK_JA[key] || key);

    const status = useMaterialStatus(backendUrl, { imageGenEnabled, ttsEnabled });
    const [selected, setSelected] = useState<CharacterTagInfo | null>(null);
    const [section, setSection] = useState<Section>('settings');
    // 保存していない変更があるまま別のキャラを選んだときの、移り先
    const [pendingSelect, setPendingSelect] = useState<CharacterTagInfo | null>(null);
    const [bulkTargets, setBulkTargets] = useState<CharacterTagInfo[] | null>(null);
    // 狭い画面では一覧と詳細を切り替えて出す。一覧へ戻っても選んだキャラと編集中の内容は残す
    const [narrowShowList, setNarrowShowList] = useState(true);

    const editor = useCharacterImageGenEditor(backendUrl, imageGenEnabled ? selected?.dirName ?? null : null, active && imageGenEnabled);
    // タグ検索の結果をコピーするときの書き方（設定画面の画像生成で選んだもの）
    const danbooruTagFormat = useDanbooruTagFormat(backendUrl, active && imageGenEnabled, undefined);
    const { lorasByCategory } = useComfyLoras(backendUrl, ['character'], active && bulkTargets !== null);

    // 試しに生成で使うワークフロー（保存しない。既定の設定を初めの値にする）
    const [templates, setTemplates] = useState<TemplateInfo[]>([]);
    const [selectedTemplate, setSelectedTemplate] = useState('');
    const [isApi, setIsApi] = useState(false);
    const [useLeftCharacter, setUseLeftCharacter] = useState(true);

    useEffect(() => {
        if (!active || section !== 'test') return;
        let alive = true;
        Promise.all([listComfyUITemplates(backendUrl), getComfyUIConfig(backendUrl)]).then(([list, config]) => {
            if (!alive) return;
            setTemplates(list);
            setIsApi(config.imageBackend === 'api');
            setSelectedTemplate(prev => {
                if (prev && list.some(x => x.name === prev)) return prev;
                const def = config.defaultTemplateId || '';
                if (def && list.some(x => x.name === def)) return def;
                return list[0]?.name ?? '';
            });
        }).catch(() => {});
        return () => { alive = false; };
    }, [active, section, backendUrl]);

    // 保存して変更が無くなったら、一覧の状態の点を読み直す
    const wasDirty = useRef(false);
    const { reload } = status;
    useEffect(() => {
        if (wasDirty.current && !editor.isDirty) reload();
        wasDirty.current = editor.isDirty;
    }, [editor.isDirty, reload]);

    const changeSection = (next: Section) => {
        // 表情画像を作ったり消したりしたあとに、一覧の点を合わせる
        if (section === 'faces') reload();
        setSection(next);
    };

    const select = useCallback((c: CharacterTagInfo) => {
        setNarrowShowList(false);
        if (c.dirName === selected?.dirName) return;
        if (editor.isDirty) {
            setPendingSelect(c);
            return;
        }
        setSelected(c);
    }, [editor.isDirty, selected]);

    // 外から頼まれたキャラを選ぶ（一覧を読み終えてから、同じ依頼は1度だけ）。開く区画も頼まれていれば開く
    const [handledRequest, setHandledRequest] = useState('');
    const requestKey = initialCharacter ? `${initialCharacter}|${initialSection ?? ''}` : '';
    if (requestKey && requestKey !== handledRequest && status.characters.length > 0) {
        setHandledRequest(requestKey);
        const c = status.characters.find(x => x.name === initialCharacter || x.dirName === initialCharacter);
        if (c) setNarrowShowList(false);
        if (c && initialSection) setSection(initialSection);
        if (c && c.dirName !== selected?.dirName) {
            if (editor.isDirty) setPendingSelect(c);
            else setSelected(c);
        }
    }

    const leave = async (save: boolean) => {
        const next = pendingSelect;
        setPendingSelect(null);
        if (!next) return;
        if (save && (await editor.save()) === false) return;
        setSelected(next);
    };

    if (!active) return null;

    const sectionOptions: { value: Section; label: string }[] = [
        ...(imageGenEnabled ? [{ value: 'settings' as const, label: t(MATERIAL_I18N_KEYS.imagesSectionSettings) }] : []),
        ...(ttsEnabled ? [{ value: 'voice' as const, label: t(MATERIAL_I18N_KEYS.charactersVoice) }] : []),
        ...(imageGenEnabled ? [
            { value: 'faces' as const, label: t(MATERIAL_I18N_KEYS.imagesSectionFaces) },
            { value: 'test' as const, label: t(MATERIAL_I18N_KEYS.imagesSectionTest) },
        ] : []),
    ];
    const visibleSection: Section = sectionOptions.some(o => o.value === section) ? section : sectionOptions[0].value;

    // キャラのタブは押して使う場所と打つ欄でできているので、地の文字は選べないようにする
    // （打つ欄の外を押しても入力の点滅が入らないように。打つ欄は index.css の決まりで選べるまま）
    return (
        <div className="select-none flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] overflow-hidden">
            <div className={cn('min-h-0 flex-col lg:flex', narrowShowList || !selected ? 'flex' : 'hidden')}>
                <CharacterListPane
                    className="flex-1 lg:border-r border-line"
                    uiCatalog={uiCatalog}
                    status={status}
                    showImage
                    showVoice={ttsEnabled}
                    sessionCharacterPaths={sessionCharacterPaths}
                    selectedDirName={selected?.dirName ?? null}
                    onSelect={select}
                    bulkActions={targets => (
                        <Button size="sm" variant="secondary" onClick={() => setBulkTargets(targets)}>
                            <Layers size={14} />
                            {t(MATERIAL_I18N_KEYS.bulkLora)}
                        </Button>
                    )}
                />
            </div>

            <section className={cn('flex-col min-h-0 min-w-0 lg:flex', narrowShowList || !selected ? 'hidden' : 'flex')}>
                {!selected ? (
                    <div className="flex-1 grid place-items-center p-6">
                        <p className="text-sm text-fg-muted">{t(MATERIAL_I18N_KEYS.imagesPickCharacter)}</p>
                    </div>
                ) : (
                    <>
                        <div className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-5 py-2.5 border-b border-line">
                            <IconButton
                                size="sm"
                                className="lg:hidden -ml-1"
                                label={t(MATERIAL_I18N_KEYS.listBack)}
                                onClick={() => setNarrowShowList(true)}
                            >
                                <ChevronLeft size={16} />
                            </IconButton>
                            <div className="min-w-0">
                                <h2 className="font-head text-base font-bold truncate">{selected.name}</h2>
                                {selected.work && <p className="text-xs text-fg-muted truncate">{selected.work}</p>}
                            </div>
                            {sectionOptions.length > 1 && (
                                <Segmented<Section> label={selected.name} value={visibleSection} onChange={changeSection} options={sectionOptions} />
                            )}
                            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onOpenFile(selected)}>
                                <FileText size={14} />
                                {t(MATERIAL_I18N_KEYS.imagesOpenFile)}
                            </Button>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
                            {visibleSection === 'settings' && (
                                <div className="space-y-4">
                                {/* タグ検索（いつも出す。結果を押すと、設定画面で選んだタグの書き方でコピーする。
                                    キャラの設定なので「キャラ/作品のみ」の切り替えを出す） */}
                                <IntegratedDanbooruSearch backendUrl={backendUrl} danbooruTagFormat={danbooruTagFormat} uiCatalog={uiCatalog} characterFilter />
                                <IntegratedCharacterSection
                                    // キャラを替えたら作り直し、LoRA の「詳細」表示などを元に戻す
                                    key={selected.dirName}
                                    hideCharacterSelector
                                    hideSaveButton
                                    selectedCharacter={selected.dirName}
                                    workNameHint={t(CONFIG_EDITOR_I18N_KEYS.characterImageGenWorkNameHint)}
                                    config={editor.config}
                                    onUpdateConfig={editor.updateConfig}
                                    isLoading={editor.isLoading}
                                    isDirty={editor.isDirty}
                                    onSave={editor.save}
                                    availableLoras={editor.availableLoras}
                                    availableOutfitLoras={editor.availableOutfitLoras}
                                    comfyUnreachable={editor.comfyUnreachable}
                                    onRefreshLoras={editor.refreshLoras}
                                    onFetchTriggerWords={editor.fetchTriggerWords}
                                    triggerWordFormat={editor.triggerWordFormat}
                                    uiCatalog={uiCatalog}
                                    backendUrl={backendUrl}
                                    appearancePrompt={appearancePrompt}
                                    appearanceTarget={{ dirName: selected.dirName, fileName: selected.name, displayName: selected.name }}
                                    characterDirName={selected.dirName}
                                    onReloadConfig={editor.reload}
                                />
                                </div>
                            )}
                            {/* 声の紐づけ（準備・調整欄のキャラ詳細と同じ部品。保存は部品の中で行う） */}
                            {visibleSection === 'voice' && (
                                <div className="max-w-3xl">
                                    <TTSCharacterAssignForm key={selected.dirName} backendUrl={backendUrl} characterDirName={selected.dirName} uiCatalog={uiCatalog} />
                                </div>
                            )}
                            {visibleSection === 'faces' && (
                                <EmotionImageTab backendUrl={backendUrl} dirName={selected.dirName} uiCatalog={uiCatalog} imageGenEnabled />
                            )}
                            {visibleSection === 'test' && (
                                <div className="space-y-4 max-w-3xl">
                                    {!isApi && templates.length > 0 && (
                                        <div className="max-w-sm">
                                            <span className="block text-xs text-fg-muted mb-1">{t(MATERIAL_I18N_KEYS.imagesWorkflow)}</span>
                                            <Select
                                                aria-label={t(MATERIAL_I18N_KEYS.imagesWorkflow)}
                                                value={selectedTemplate}
                                                onChange={setSelectedTemplate}
                                                options={templates.map(x => ({ value: x.name, label: x.name }))}
                                            />
                                        </div>
                                    )}
                                    <IntegratedGenerateTestSection
                                        backendUrl={backendUrl}
                                        selectedTemplate={selectedTemplate}
                                        useLeftCharacter={useLeftCharacter}
                                        onToggleUseLeftCharacter={() => setUseLeftCharacter(v => !v)}
                                        leftCharacterName={selected.dirName}
                                        leftCharConfig={editor.config}
                                        characters={status.characters}
                                        uiCatalog={uiCatalog}
                                    />
                                </div>
                            )}
                        </div>
                        {/* 画像の設定の保存の帯。スクロールする欄の外に置き、下端・左右の端いっぱいに常に見せる */}
                        {visibleSection === 'settings' && (
                            <CharacterSaveBar
                                key={selected.dirName}
                                onSave={editor.save}
                                uiCatalog={uiCatalog}
                                className="shrink-0 px-4 sm:px-5 py-2.5 border-t border-line"
                            />
                        )}
                    </>
                )}
            </section>

            <BulkLoraModal
                open={bulkTargets !== null}
                onClose={() => setBulkTargets(null)}
                backendUrl={backendUrl}
                uiCatalog={uiCatalog}
                characters={bulkTargets ?? []}
                availableLoras={lorasByCategory['character'] ?? []}
                onApplied={() => {
                    reload();
                    // 開いているキャラが対象なら、読み直して差し替えた LoRA を見せる
                    if (selected && bulkTargets?.some(c => c.dirName === selected.dirName) && !editor.isDirty) void editor.reload();
                }}
            />

            <Modal
                open={pendingSelect !== null}
                onClose={() => setPendingSelect(null)}
                title={t(MATERIAL_I18N_KEYS.leaveTitle)}
                size="sm"
                closeLabel={t(MATERIAL_I18N_KEYS.leaveBack)}
                footer={(
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="ghost" onClick={() => setPendingSelect(null)}>{t(MATERIAL_I18N_KEYS.leaveBack)}</Button>
                        <Button variant="secondary" onClick={() => { void leave(false); }}>{t(MATERIAL_I18N_KEYS.leaveDiscard)}</Button>
                        <Button variant="primary" onClick={() => { void leave(true); }}>{t(MATERIAL_I18N_KEYS.leaveSave)}</Button>
                    </div>
                )}
            >
                <p className="p-5 text-sm">{(t(MATERIAL_I18N_KEYS.leaveMessage)).split('{{name}}').join(selected?.name ?? '')}</p>
            </Modal>
        </div>
    );
};

export default CharacterImagesTab;
