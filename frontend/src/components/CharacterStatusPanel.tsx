/**
 * CharacterStatusPanel - 💛状態パネル
 * 
 * SSRPモードのキャラクター詳細設定を簡易表示・編集するパネル。
 * 会話設定メニュー（RolePlaySettings）で設定した内容と連動する。
 * 
 * 対応機能:
 * - 複数キャラクター対応（キャラクター選択ドロップダウン）
 * - パラメータグループの表示・編集（動的スキーマ対応）
 * - 相関関係（好感度・関係性）の表示・編集
 */
import React, { useState, useEffect, useRef } from 'react';
import { Heart, Edit2, Save, SaveAll, ChevronRight, ChevronDown, Users } from 'lucide-react';
import type { ParameterSchema, ParameterGroupState } from '../types/Parameter';
import { RenderGroup } from './common/ParameterElements';
import { getParameterSchema } from '../api/parameters';
import { getRelationshipOptions } from '../api/ssrp';
import type { RelationshipOption } from '../api/ssrp';
import { resolveMessage, type I18NCatalog } from '../api/i18n';
import { CHARACTER_STATUS_I18N_KEYS, CHARACTER_STATUS_TEXT_FALLBACK_JA, CHAT_VIEW_I18N_KEYS, CHAT_VIEW_TEXT_FALLBACK_JA, COMMON_I18N_KEYS, COMMON_TEXT_FALLBACK_JA } from '../constants/i18n';

// 相関関係型
interface Correlation {
    targetId: string;
    targetName: string;
    relationship: string;
    details: string;
    favorability?: number;
}

// キャラクター詳細設定型
interface CharacterDetail {
    individualBackground?: string;
    individualBackgrounds?: string[];
    individualOutfits?: string[];
    individualPersonalities?: string[];
    correlations: Correlation[];
    parameterGroups?: ParameterGroupState[];
    parameters?: Record<string, any>;
    isOpen?: boolean;
    isCorrelationOpen?: boolean;
}

// Props型（新仕様）
interface CharacterStatusPanelProps {
    sessionId: string | null;
    backendUrl: string;
    // SSRP設定データ
    isSSRP: boolean;
    characterDetails: Record<string, CharacterDetail> | null;
    selectedCharacters: string[];
    parameterSchemaId?: string;
    // 更新コールバック
    onUpdateCharacterDetails?: (newDetails: Record<string, CharacterDetail>) => void;
    onOpenChange?: (isOpen: boolean) => void;
    // タイトルバーの有無と編集状態
    hasTitleBar?: boolean;
    isTitleEditing?: boolean;
    uiCatalog?: I18NCatalog | null;
    // セッション未反映の変更があるとき、ヘッダーに反映ボタンを表示する
    isSessionDirty?: boolean;
    onApplyToSession?: () => void;
    applyToSessionState?: 'idle' | 'applying' | 'done';
    // ハンバーガーメニュー（セッション状態ドロワー）内に埋め込むモード。
    // 浮動配置と外側クリックでの自動クローズを無効化し、開閉セクションとして振る舞う。
    embedded?: boolean;
}

export const CharacterStatusPanel: React.FC<CharacterStatusPanelProps> = ({
    sessionId,
    backendUrl,
    isSSRP,
    characterDetails,
    selectedCharacters,
    parameterSchemaId,
    onUpdateCharacterDetails,
    onOpenChange,
    hasTitleBar = false,
    isTitleEditing = false,
    uiCatalog = null,
    isSessionDirty = false,
    onApplyToSession,
    applyToSessionState = 'idle',
    embedded = false
}) => {
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        CHARACTER_STATUS_TEXT_FALLBACK_JA[key] || CHAT_VIEW_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key
    );
    const formatText = (template: string, values: Record<string, string | number>) => {
        return Object.entries(values).reduce((text, [key, value]) => {
            return text.split(`{{${key}}}`).join(String(value));
        }, template);
    };
    // UI状態
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    // キャラクター毎の状態セクション開閉（デフォルトどちらも閉）
    const [openCharPaths, setOpenCharPaths] = useState<Record<string, boolean>>({});

    // 編集中のキャラクターと編集データ（ローカルコピー）。同時編集は1キャラのみ
    const [editingCharPath, setEditingCharPath] = useState<string | null>(null);
    const [editingDetail, setEditingDetail] = useState<CharacterDetail | null>(null);

    // パラメータスキーマ
    const [parameterSchema, setParameterSchema] = useState<ParameterSchema | null>(null);

    // 関係性選択肢
    const [relationshipOptions, setRelationshipOptions] = useState<RelationshipOption[]>([]);

    // キャラクター毎のパラメータ・相関関係サブセクション開閉（デフォルト開）
    const [paramOpenByChar, setParamOpenByChar] = useState<Record<string, boolean>>({});
    const [correlationOpenByChar, setCorrelationOpenByChar] = useState<Record<string, boolean>>({});

    // 外部クリックで閉じる
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            // クリック対象がdata-panel属性を持つ要素内なら無視（他パネルのクリック）
            const target = event.target as HTMLElement;
            if (target.closest('[data-panel]')) {
                return;
            }
            if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setEditingCharPath(null);
                setEditingDetail(null);
                onOpenChange?.(false);
            }
        };

        // 埋め込みモードではドロワー側が開閉を管理するため、外側クリックで閉じない
        if (isOpen && !embedded) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, onOpenChange, embedded]);

    // キャラクター名取得ヘルパー
    const getCharacterName = (path: string): string => {
        if (!path) return '';
        return path.split('/').pop() || path;
    };

    // 編集中のキャラが選択解除された場合は編集を破棄
    useEffect(() => {
        if (editingCharPath && !selectedCharacters.includes(editingCharPath)) {
            setEditingCharPath(null);
            setEditingDetail(null);
        }
    }, [selectedCharacters, editingCharPath]);

    // スキーマ・関係性オプション読み込み
    useEffect(() => {
        const loadData = async () => {
            if (!isOpen) return;

            // パラメータスキーマ読み込み
            if (parameterSchemaId) {
                try {
                    const schema = await getParameterSchema(parameterSchemaId);
                    setParameterSchema(schema);
                } catch (e) {
                    console.warn('[CharacterStatusPanel] Failed to load parameter schema:', e);
                }
            }

            // 関係性オプション読み込み
            try {
                const options = await getRelationshipOptions(backendUrl);
                setRelationshipOptions(options);
            } catch (e) {
                console.warn('[CharacterStatusPanel] Failed to load relationship options:', e);
            }
        };
        loadData();
    }, [isOpen, parameterSchemaId, backendUrl]);

    // 編集開始（キャラクター毎。同時編集は1キャラのみ）
    const handleStartEdit = (charPath: string) => {
        if (characterDetails && characterDetails[charPath]) {
            setEditingDetail(JSON.parse(JSON.stringify(characterDetails[charPath])));
            setEditingCharPath(charPath);
        }
    };

    // 編集キャンセル
    const handleCancel = () => {
        setEditingCharPath(null);
        setEditingDetail(null);
    };

    // 保存
    const handleSave = () => {
        if (!editingCharPath || !editingDetail || !onUpdateCharacterDetails || !characterDetails) return;

        setIsLoading(true);
        try {
            const newDetails = {
                ...characterDetails,
                [editingCharPath]: editingDetail
            };
            onUpdateCharacterDetails(newDetails);
            setEditingCharPath(null);
            setEditingDetail(null);
        } catch (error) {
            console.error('[CharacterStatusPanel] Failed to save:', error);
            alert(t(CHARACTER_STATUS_I18N_KEYS.saveFailed));
        } finally {
            setIsLoading(false);
        }
    };

    // パラメータ値変更ハンドラ
    const handleParameterValueChange = (groupId: string, elementId: string, value: any) => {
        if (!editingDetail?.parameterGroups) return;

        setEditingDetail(prev => {
            if (!prev) return null;
            const newGroups = prev.parameterGroups?.map(g => {
                if (g.id === groupId) {
                    return {
                        ...g,
                        values: { ...g.values, [elementId]: value }
                    };
                }
                return g;
            });
            return { ...prev, parameterGroups: newGroups };
        });
    };

    // パラメータグループ状態変更ハンドラ
    const handleGroupStateChange = (groupId: string, updates: Partial<ParameterGroupState>) => {
        if (!editingDetail?.parameterGroups) return;

        setEditingDetail(prev => {
            if (!prev) return null;
            const newGroups = prev.parameterGroups?.map(g => {
                if (g.id === groupId) {
                    return { ...g, ...updates };
                }
                return g;
            });
            return { ...prev, parameterGroups: newGroups };
        });
    };

    // 相関関係変更ハンドラ
    const handleCorrelationChange = (targetId: string, field: keyof Correlation, value: any) => {
        if (!editingDetail) return;

        setEditingDetail(prev => {
            if (!prev) return null;
            const newCorrelations = prev.correlations.map(c => {
                if (c.targetId === targetId) {
                    return { ...c, [field]: value };
                }
                return c;
            });
            return { ...prev, correlations: newCorrelations };
        });
    };

    // SSRPモードでない場合、またはセッションIDがない場合は非表示
    if (!isSSRP || !sessionId) return null;

    // キャラクターが選択されていない場合は非表示
    if (selectedCharacters.length === 0) return null;

    // タイトル編集中は非表示
    if (isTitleEditing) return null;

    const hasAnyDetail = !!characterDetails && selectedCharacters.some(p => !!characterDetails[p]);

    return (
        <div ref={panelRef} data-panel="status" className={embedded ? 'w-full' : `absolute ${hasTitleBar ? 'top-28' : 'top-16'} left-4 z-30`}>
            {!isOpen ? (
                <button
                    onClick={() => { setIsOpen(true); onOpenChange?.(true); }}
                    className={`flex items-center gap-2 bg-gray-800/80 backdrop-blur border border-gray-700 text-pink-400 px-3 py-2 ${embedded ? 'w-full rounded-lg' : 'rounded-full shadow-lg'} hover:bg-gray-700 transition-all font-medium text-sm group`}
                >
                    <Heart size={16} className={`group-hover:scale-110 transition-transform ${hasAnyDetail ? 'fill-pink-400/20' : ''}`} />
                    <span>{t(CHARACTER_STATUS_I18N_KEYS.closedTitle)}</span>
                    <ChevronRight size={14} className={`text-gray-500 ${embedded ? 'ml-auto' : ''}`} />
                </button>
            ) : (
                <div className={`bg-gray-900/95 backdrop-blur-md border border-gray-700 rounded-xl shadow-2xl ${embedded ? 'w-full' : 'w-96'} overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-2 duration-200`}>
                    {/* Header */}
                    <div className="px-4 py-3 bg-gray-800 border-b border-gray-700 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-pink-400 font-medium">
                            <Heart size={16} className="fill-pink-400/20" />
                            <span>{t(CHARACTER_STATUS_I18N_KEYS.title)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            {(isSessionDirty || applyToSessionState === 'done') && onApplyToSession && (
                                <button
                                    onClick={onApplyToSession}
                                    disabled={applyToSessionState === 'applying'}
                                    className={`p-1.5 rounded transition-colors ${applyToSessionState === 'done'
                                        ? 'text-emerald-400'
                                        : 'text-emerald-400 hover:text-emerald-300 hover:bg-gray-700 disabled:opacity-60'}`}
                                    title={t(CHAT_VIEW_I18N_KEYS.applyToSession)}
                                >
                                    <SaveAll size={14} className={applyToSessionState === 'applying' ? 'animate-pulse' : ''} />
                                </button>
                            )}
                            <button
                                onClick={() => { setIsOpen(false); onOpenChange?.(false); }}
                                className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                            >
                                <ChevronDown size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Content: キャラクター毎の状態セクション（開閉可能・デフォルト閉） */}
                    <div className="p-3 space-y-2 max-h-[60vh] overflow-y-auto custom-scrollbar">
                        {selectedCharacters.map(charPath => {
                            const isCharOpen = !!openCharPaths[charPath];
                            const isEditingThis = editingCharPath === charPath;
                            const detail = isEditingThis ? editingDetail : (characterDetails ? characterDetails[charPath] : null);
                            const isParamOpen = paramOpenByChar[charPath] ?? true;
                            const isCorrelationOpen = correlationOpenByChar[charPath] ?? true;
                            return (
                                <div key={charPath} className="border border-gray-700/60 rounded-lg overflow-hidden">
                                    {/* キャラクターセクションヘッダー */}
                                    <div className="flex items-center bg-gray-800/60">
                                        <button
                                            onClick={() => setOpenCharPaths(prev => ({ ...prev, [charPath]: !isCharOpen }))}
                                            className="flex-1 flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700/60 transition-colors text-left"
                                        >
                                            {isCharOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                            <span>{formatText(t(CHARACTER_STATUS_I18N_KEYS.characterSection), { name: getCharacterName(charPath) })}</span>
                                        </button>
                                        {/* 編集は同時に1キャラのみ */}
                                        {isCharOpen && editingCharPath === null && (
                                            <button
                                                onClick={() => handleStartEdit(charPath)}
                                                className="p-1.5 mr-2 hover:bg-gray-700 rounded text-gray-400 hover:text-blue-400 transition-colors"
                                                title={t(COMMON_I18N_KEYS.edit)}
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                        )}
                                    </div>

                                    {isCharOpen && (
                                        <div className="p-3 space-y-4">
                                            {!detail ? (
                                                <div className="text-center py-4 text-gray-500 text-sm">
                                                    {t(CHARACTER_STATUS_I18N_KEYS.noData)}
                                                </div>
                                            ) : (
                                                <>
                                                    {/* 個別性格・個別服装・個別背景（表示のみ・共通処理） */}
                                                    {([
                                                        { label: t(CHARACTER_STATUS_I18N_KEYS.individualPersonality), items: (detail.individualPersonalities || []).filter(Boolean) },
                                                        { label: t(CHARACTER_STATUS_I18N_KEYS.individualOutfit), items: (detail.individualOutfits || []).filter(Boolean) },
                                                        { label: t(CHARACTER_STATUS_I18N_KEYS.individualBackground), items: (detail.individualBackgrounds || (detail.individualBackground ? [detail.individualBackground] : [])).filter(Boolean) },
                                                    ] as { label: string; items: string[] }[]).map(({ label, items }) =>
                                                        items.length > 0 && (
                                                            <div key={label} className="text-xs text-gray-400 leading-tight">
                                                                <span className="text-gray-500 block mb-0.5">{label}:</span>
                                                                <div className="space-y-0.5 pl-2 border-l border-gray-700">
                                                                    {items.map((item, idx) => (
                                                                        <div key={idx}>{item.split('/').pop()?.replace('.md', '')}</div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )
                                                    )}

                                                    {/* パラメータセクション */}
                                                    {detail.parameterGroups && parameterSchema && (
                                                        <div>
                                                            <button
                                                                onClick={() => setParamOpenByChar(prev => ({ ...prev, [charPath]: !isParamOpen }))}
                                                                className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-2 w-full"
                                                            >
                                                                {isParamOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                                {t(CHARACTER_STATUS_I18N_KEYS.parameters)}
                                                            </button>

                                                            {isParamOpen && (
                                                                <div className="space-y-2 pl-2">
                                                                    {parameterSchema.groups.map(groupDef => {
                                                                        const groupState = detail.parameterGroups?.find(g => g.id === groupDef.id);
                                                                        if (!groupState) return null;

                                                                        return (
                                                                            <RenderGroup
                                                                                key={groupDef.id}
                                                                                groupDef={groupDef}
                                                                                groupState={groupState}
                                                                                onGroupStateChange={(updates) => { if (isEditingThis) handleGroupStateChange(groupDef.id, updates); }}
                                                                                onValueChange={(elementId, value) => { if (isEditingThis) handleParameterValueChange(groupDef.id, elementId, value); }}
                                                                                uiCatalog={uiCatalog}
                                                                            />
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* 相関関係セクション */}
                                                    {detail.correlations && detail.correlations.length > 0 && (
                                                        <div>
                                                            <button
                                                                onClick={() => setCorrelationOpenByChar(prev => ({ ...prev, [charPath]: !isCorrelationOpen }))}
                                                                className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-2 w-full"
                                                            >
                                                                {isCorrelationOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                                <Users size={14} />
                                                                {t(CHARACTER_STATUS_I18N_KEYS.correlations)}
                                                            </button>

                                                            {isCorrelationOpen && (
                                                                <div className="space-y-3 pl-2">
                                                                    {detail.correlations.map(corr => (
                                                                        <div key={corr.targetId} className="border border-gray-700/50 rounded p-2 space-y-2">
                                                                            <div className="text-xs font-medium text-gray-400">
                                                                                {formatText(t(CHARACTER_STATUS_I18N_KEYS.target), { name: corr.targetName })}
                                                                            </div>

                                                                            {/* 関係性 */}
                                                                            <div className="flex items-center gap-2">
                                                                                <span className="text-xs text-gray-500 w-12">{t(CHARACTER_STATUS_I18N_KEYS.relationship)}</span>
                                                                                {isEditingThis ? (
                                                                                    <select
                                                                                        value={corr.relationship || ''}
                                                                                        onChange={(e) => handleCorrelationChange(corr.targetId, 'relationship', e.target.value)}
                                                                                        className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs"
                                                                                    >
                                                                                        <option value="">{t(CHARACTER_STATUS_I18N_KEYS.unset)}</option>
                                                                                        {relationshipOptions.map(opt => (
                                                                                            <option key={opt.value} value={opt.value}>
                                                                                                {opt.label}
                                                                                            </option>
                                                                                        ))}
                                                                                    </select>
                                                                                ) : (
                                                                                    <span className="text-xs text-gray-300">
                                                                                        {corr.relationship || t(CHARACTER_STATUS_I18N_KEYS.unset)}
                                                                                    </span>
                                                                                )}
                                                                            </div>

                                                                            {/* 好感度 */}
                                                                            <div className="flex items-center gap-2">
                                                                                <span className="text-xs text-gray-500 w-12">{t(CHARACTER_STATUS_I18N_KEYS.favorability)}</span>
                                                                                {isEditingThis ? (
                                                                                    <div className="flex-1 flex items-center gap-2">
                                                                                        <input
                                                                                            type="range"
                                                                                            min={-100}
                                                                                            max={100}
                                                                                            value={corr.favorability ?? 0}
                                                                                            onChange={(e) => handleCorrelationChange(corr.targetId, 'favorability', parseInt(e.target.value))}
                                                                                            className="flex-1 h-1.5 accent-pink-500"
                                                                                        />
                                                                                        <span className="text-xs w-8 text-right text-pink-400">
                                                                                            {corr.favorability ?? 0}
                                                                                        </span>
                                                                                    </div>
                                                                                ) : (
                                                                                    <div className="flex-1 flex items-center gap-2">
                                                                                        <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                                                                            <div
                                                                                                className="h-full bg-pink-500"
                                                                                                style={{
                                                                                                    width: `${Math.max(0, ((corr.favorability ?? 0) + 100) / 200 * 100)}%`
                                                                                                }}
                                                                                            />
                                                                                        </div>
                                                                                        <span className="text-xs w-8 text-right text-pink-400">
                                                                                            {corr.favorability ?? 0}
                                                                                        </span>
                                                                                    </div>
                                                                                )}
                                                                            </div>

                                                                            {/* 詳細 */}
                                                                            {(corr.details || isEditingThis) && (
                                                                                <div>
                                                                                    <span className="text-xs text-gray-500">{t(CHARACTER_STATUS_I18N_KEYS.details)}</span>
                                                                                    {isEditingThis ? (
                                                                                        <textarea
                                                                                            value={corr.details || ''}
                                                                                            onChange={(e) => handleCorrelationChange(corr.targetId, 'details', e.target.value)}
                                                                                            className="w-full mt-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs resize-none"
                                                                                            rows={2}
                                                                                            placeholder={t(CHARACTER_STATUS_I18N_KEYS.detailsPlaceholder)}
                                                                                        />
                                                                                    ) : (
                                                                                        <p className="text-xs text-gray-400 mt-1">
                                                                                            {corr.details || t(CHARACTER_STATUS_I18N_KEYS.noDetails)}
                                                                                        </p>
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </>
                                            )}

                                            {/* 編集中の保存・キャンセル */}
                                            {isEditingThis && (
                                                <div className="flex gap-2 pt-1 border-t border-gray-700/50">
                                                    <button
                                                        onClick={handleCancel}
                                                        className="flex-1 py-1.5 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                                                    >
                                                        {t(COMMON_I18N_KEYS.cancel)}
                                                    </button>
                                                    <button
                                                        onClick={handleSave}
                                                        disabled={isLoading}
                                                        className="flex-1 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors flex items-center justify-center gap-1"
                                                    >
                                                        <Save size={14} />
                                                        {t(COMMON_I18N_KEYS.save)}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};
