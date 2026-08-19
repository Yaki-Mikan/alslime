/**
 * TTSCharacterAssignForm.tsx - キャラクターとVoiceの紐づけ編集フォーム（共通部品）
 *
 * CharacterVoicePanel（会話設定内パネル）と TTSCharacterSettingsModal（小画面用）の
 * 双方から使う。保存先は /api/tts/character-config/{name}（dirty管理＋明示保存）。
 * Voice選択は検索付き選択モーダル（GridSelectionModal の流儀。選択中を選択状態で表示）。
 */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Loader2, Play, Save, Search, Square, X } from 'lucide-react';
import { fetchTTSVoices, getTTSCharacterConfig, previewTTS, saveTTSCharacterConfig } from '../../api/tts';
import type { TTSCharacterConfig, TTSVoice } from '../../api/tts';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';

interface Props {
    backendUrl: string;
    // 読み書きに使うキャラクターのディレクトリ名（`_v数字` はサーバー側で除去される）。
    characterDirName: string;
    uiCatalog?: I18NCatalog | null;
}

export const TTSCharacterAssignForm: React.FC<Props> = ({ backendUrl, characterDirName, uiCatalog = null }) => {
    const t = (key: string, fallback: string) => resolveMessage(uiCatalog, key, fallback);

    const [config, setConfig] = useState<TTSCharacterConfig | null>(null);
    const [voices, setVoices] = useState<TTSVoice[]>([]);
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [notice, setNotice] = useState('');
    const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
    const [voiceSearch, setVoiceSearch] = useState('');
    const [isCfgOpen, setIsCfgOpen] = useState(false);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);

    useEffect(() => {
        if (!characterDirName) return;
        let cancelled = false;
        (async () => {
            try {
                const [cfg, voiceList] = await Promise.all([
                    getTTSCharacterConfig(backendUrl, characterDirName),
                    fetchTTSVoices(backendUrl).catch(() => [] as TTSVoice[]),
                ]);
                if (cancelled) return;
                setConfig(cfg);
                setVoices(voiceList);
                setIsDirty(false);
            } catch (error) {
                console.error('[TTSCharacterAssignForm] load failed:', error);
            }
        })();
        return () => { cancelled = true; };
    }, [backendUrl, characterDirName]);

    const showNotice = (message: string) => {
        setNotice(message);
        setTimeout(() => setNotice(''), 2500);
    };

    const update = <K extends keyof TTSCharacterConfig>(key: K, value: TTSCharacterConfig[K]) => {
        setConfig(prev => (prev ? { ...prev, [key]: value } : prev));
        setIsDirty(true);
    };

    const handleSave = async () => {
        if (!config || isSaving) return;
        setIsSaving(true);
        try {
            await saveTTSCharacterConfig(backendUrl, characterDirName, config);
            setIsDirty(false);
            showNotice(t('tts.charAssign.saved', 'キャラクター設定を保存しました'));
        } catch (error) {
            console.error('[TTSCharacterAssignForm] save failed:', error);
            showNotice(t('tts.charAssign.saveFailed', 'キャラクター設定の保存に失敗しました'));
        } finally {
            setIsSaving(false);
        }
    };

    // キャラの声で試聴（未保存の編集は反映されない。保存済み設定でのサーバー側解決）。
    const handlePreview = async () => {
        if (isPreviewing) {
            previewAudio?.pause();
            setPreviewAudio(null);
            setIsPreviewing(false);
            return;
        }
        setIsPreviewing(true);
        try {
            const blob = await previewTTS(backendUrl, {
                text: t('tts.voicePanel.previewText', 'こんにちは。音声のテストです。'),
                characterName: characterDirName,
            });
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.onended = () => {
                URL.revokeObjectURL(url);
                setIsPreviewing(false);
            };
            setPreviewAudio(audio);
            await audio.play();
        } catch (error) {
            console.error('[TTSCharacterAssignForm] preview failed:', error);
            setIsPreviewing(false);
            showNotice(t('tts.voices.previewFailed', '試聴に失敗しました'));
        }
    };

    if (!config) {
        return (
            <div className="flex items-center gap-2 text-xs text-gray-400 p-2">
                <Loader2 size={14} className="animate-spin" />
                {t('tts.voicePanel.loading', '読込中...')}
            </div>
        );
    }

    const filteredVoices = voiceSearch.trim()
        ? voices.filter(v => v.id.toLowerCase().includes(voiceSearch.trim().toLowerCase()))
        : voices;

    return (
        <div className="space-y-3">
            {/* 紐づけ済みVoiceの表示と選択モーダル起動 */}
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-400">{t('tts.charAssign.voice', 'Voice')}</span>
                <button
                    onClick={() => setIsVoiceModalOpen(true)}
                    className="px-3 py-1.5 text-sm bg-gray-800 border border-gray-600 hover:border-orange-500 text-gray-200 rounded transition-colors"
                >
                    {config.voiceId || t('tts.charAssign.voiceNone', '（未設定）')}
                </button>
                <button
                    onClick={() => void handlePreview()}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-orange-300 hover:text-white bg-orange-900/20 hover:bg-orange-800/50 border border-orange-600/40 rounded transition-colors"
                >
                    {isPreviewing ? <Square size={13} /> : <Play size={13} />}
                    <span>{isPreviewing ? t('tts.button.stop', '停止') : t('tts.voices.preview', '試聴')}</span>
                </button>
                {isDirty && <span className="text-xs text-yellow-400">{t('tts.settings.unsaved', '未保存')}</span>}
                {notice && <span className="text-xs text-orange-300">{notice}</span>}
            </div>

            {/* キャラ紐づけ側VoiceDesignキャプション */}
            <div>
                <label className="block text-xs text-gray-400 mb-1">
                    {t('tts.charAssign.voiceDesign', 'VoiceDesignキャプション')}
                </label>
                <textarea
                    value={config.voiceDesignCaption}
                    onChange={e => update('voiceDesignCaption', e.target.value)}
                    rows={2}
                    placeholder={t('tts.charAssign.voiceDesignPlaceholder', '声質の説明（例: 落ち着いた低めの女性の声）')}
                    className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 outline-none focus:border-orange-500 resize-y"
                />
            </div>

            {/* キャラ単位cfg上書き（折りたたみ） */}
            <div className="border border-gray-700/60 rounded">
                <button
                    onClick={() => setIsCfgOpen(prev => !prev)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-gray-800 transition-colors"
                >
                    {isCfgOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    {t('tts.charAssign.cfgOverride', 'キャラ単位のcfg上書き（空欄で全体既定値）')}
                </button>
                {isCfgOpen && (
                    <div className="flex flex-wrap items-center gap-2 px-3 pb-3 text-xs text-gray-400">
                        <span>cfg_scale_caption</span>
                        <input
                            type="number"
                            step={0.1}
                            min={0}
                            value={config.cfgScaleCaption ?? ''}
                            onChange={e => update('cfgScaleCaption', e.target.value.trim() === '' ? null : Number(e.target.value))}
                            className="w-20 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 outline-none focus:border-orange-500"
                        />
                        <span>cfg_scale_speaker</span>
                        <input
                            type="number"
                            step={0.1}
                            min={0}
                            value={config.cfgScaleSpeaker ?? ''}
                            onChange={e => update('cfgScaleSpeaker', e.target.value.trim() === '' ? null : Number(e.target.value))}
                            className="w-20 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 outline-none focus:border-orange-500"
                        />
                    </div>
                )}
            </div>

            <div className="flex justify-end">
                <button
                    onClick={() => void handleSave()}
                    disabled={!isDirty || isSaving}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm bg-orange-700 hover:bg-orange-600 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {t('tts.settings.save', '保存')}
                </button>
            </div>

            {/* Voice選択モーダル（検索付き・選択中を選択状態で表示） */}
            {isVoiceModalOpen && createPortal(
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg border border-gray-700 overflow-hidden flex flex-col max-h-[70vh]">
                        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700 bg-gray-800">
                            <span className="text-sm font-medium text-gray-100">
                                {t('tts.voicePanel.selectVoice', 'Voiceの選択')}
                            </span>
                            <button
                                onClick={() => setIsVoiceModalOpen(false)}
                                className="ml-auto p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="p-3 border-b border-gray-700/60">
                            <div className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded px-2">
                                <Search size={14} className="text-gray-500" />
                                <input
                                    type="text"
                                    value={voiceSearch}
                                    onChange={e => setVoiceSearch(e.target.value)}
                                    placeholder={t('tts.voicePanel.searchPlaceholder', 'Voice IDで検索')}
                                    className="flex-1 bg-transparent text-gray-200 text-sm py-2 outline-none"
                                />
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 grid grid-cols-2 gap-2">
                            <button
                                onClick={() => { update('voiceId', ''); setIsVoiceModalOpen(false); }}
                                className={`px-3 py-2 text-sm text-left rounded border transition-colors ${config.voiceId === ''
                                    ? 'border-orange-500 bg-orange-900/30 text-orange-200'
                                    : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500'}`}
                            >
                                {t('tts.charAssign.voiceNone', '（未設定）')}
                            </button>
                            {filteredVoices.map(voice => (
                                <button
                                    key={voice.id}
                                    onClick={() => { update('voiceId', voice.id); setIsVoiceModalOpen(false); }}
                                    className={`px-3 py-2 text-sm text-left rounded border transition-colors ${config.voiceId === voice.id
                                        ? 'border-orange-500 bg-orange-900/30 text-orange-200'
                                        : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500'}`}
                                >
                                    {voice.id}
                                </button>
                            ))}
                            {filteredVoices.length === 0 && (
                                <p className="col-span-2 text-xs text-gray-500 p-2">
                                    {t('tts.voicePanel.noVoices', '該当するVoiceがありません')}
                                </p>
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};
