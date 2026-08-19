/**
 * TTSSettingsModal.tsx - 小画面用のTTS設定モーダル（コンパクト版）
 *
 * ComfyUISettingsModal（画像生成設定の小画面モーダル）と同じ器の流儀で、
 * 設定メニューの「TTS設定」から開く。統合設定モーダル（90vw×90vh・2列）は
 * スマホのような小画面では扱いづらいため、必要最小限を縦一列にまとめる。
 * - 接続設定（エンドポイントURL・APIキー・タイムアウト）と接続確認
 * - キャラクター音声設定ボタン（TTSCharacterSettingsModal へ）
 * - 文体指示（絵文字による感情表現）のトグル
 * - 読み上げテスト（テキスト・音声プルダウン・テスト再生）
 * 値の正本は /api/tts/config で、統合設定と同じ read-modify-merge で書き戻す。
 * 広い画面では「統合設定を開く」で従来の統合設定へ移れる。
 */

import React, { useEffect, useRef, useState } from 'react';
import { AudioLines, ChevronDown, ChevronRight, Loader2, Play, Plug, Smile, Users, X } from 'lucide-react';
import { fetchTTSVoices, getTTSConfig, previewTTS, saveTTSConfig, testTTSConnection } from '../../api/tts';
import type { TTSConfig, TTSConnectionTestResult, TTSVoice } from '../../api/tts';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { TTSCharacterSettingsModal } from './TTSCharacterSettingsModal';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    // 統合設定（ConfigEditorHub の tts タブ）へ移る導線。呼ぶ前にこのモーダル自身は閉じる。
    // 未指定なら導線は表示しない。
    onOpenIntegrated?: () => void;
}

export const TTSSettingsModal: React.FC<Props> = ({
    isOpen,
    onClose,
    backendUrl,
    uiCatalog = null,
    onOpenIntegrated,
}) => {
    const t = (key: string, fallback: string) => resolveMessage(uiCatalog, key, fallback);

    const [config, setConfig] = useState<TTSConfig | null>(null);
    const [apiKeyInput, setApiKeyInput] = useState('');
    const [clearApiKey, setClearApiKey] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [isConnectionOpen, setIsConnectionOpen] = useState(true);
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<TTSConnectionTestResult | null>(null);

    const [isCharModalOpen, setIsCharModalOpen] = useState(false);

    // 読み上げテスト（統合設定の右エリアと同じ挙動。実行中の再押下はリクエスト中断）。
    const [voices, setVoices] = useState<TTSVoice[]>([]);
    const [voicesLoaded, setVoicesLoaded] = useState(false);
    const [previewText, setPreviewText] = useState<string | null>(null);
    const [testTarget, setTestTarget] = useState('');
    const [testBusy, setTestBusy] = useState(false);
    const [testAudioUrl, setTestAudioUrl] = useState<string | null>(null);
    const testAbortRef = useRef<AbortController | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const effectivePreviewText = previewText ?? t('tts.voicePanel.previewText', 'こんにちは。今日はいい天気ですね。');

    const showNotice = (text: string) => {
        if (noticeTimerRef.current !== null) clearTimeout(noticeTimerRef.current);
        setNotice(text);
        noticeTimerRef.current = setTimeout(() => setNotice(null), 2500);
    };

    // 開くたびに設定と Voice 一覧を読み直す（他画面での変更を拾う）。
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setTestResult(null);
        setApiKeyInput('');
        setClearApiKey(false);
        setIsDirty(false);
        (async () => {
            try {
                const cfg = await getTTSConfig(backendUrl);
                if (!cancelled) setConfig(cfg);
            } catch (error) {
                console.error('[TTSSettingsModal] config load failed:', error);
                if (!cancelled) setConfig(null);
            }
        })();
        (async () => {
            try {
                const list = await fetchTTSVoices(backendUrl);
                if (!cancelled) {
                    setVoices(list);
                    setVoicesLoaded(true);
                }
            } catch {
                if (!cancelled) setVoices([]);
            }
        })();
        return () => {
            cancelled = true;
            testAbortRef.current?.abort();
            audioRef.current?.pause();
            audioRef.current = null;
        };
    }, [isOpen, backendUrl]);

    useEffect(() => () => {
        if (noticeTimerRef.current !== null) clearTimeout(noticeTimerRef.current);
        if (testAudioUrl) URL.revokeObjectURL(testAudioUrl);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!isOpen) return null;

    const updateConfig = <K extends keyof TTSConfig>(key: K, value: TTSConfig[K]) => {
        setConfig(prev => (prev ? { ...prev, [key]: value } : prev));
        setIsDirty(true);
    };

    // 接続設定の明示保存（APIキーは「非空なら更新・空なら既存維持」。削除はチェック時のみ）。
    const handleSave = async () => {
        if (!config || isSaving) return;
        setIsSaving(true);
        try {
            const { apiKeySet: _apiKeySet, ...rest } = config;
            const res = await saveTTSConfig(backendUrl, {
                ...rest,
                apiKey: clearApiKey ? '' : apiKeyInput,
                clearApiKey,
            });
            if (res.success) {
                const cfg = await getTTSConfig(backendUrl);
                setConfig(cfg);
                setApiKeyInput('');
                setClearApiKey(false);
                setIsDirty(false);
                showNotice(t('tts.settings.saved', '保存しました'));
            } else {
                showNotice(t('tts.settings.saveFailed', '保存に失敗しました'));
            }
        } catch (error) {
            console.error('[TTSSettingsModal] config save failed:', error);
            showNotice(t('tts.settings.saveFailed', '保存に失敗しました'));
        } finally {
            setIsSaving(false);
        }
    };

    // トグル類の即時保存（read-modify-merge。統合設定の persistConfigPatch と同じ規約）。
    const persistConfigPatch = async (patch: Partial<TTSConfig>) => {
        if (!config) return;
        setConfig(prev => (prev ? { ...prev, ...patch } : prev));
        try {
            const { apiKeySet: _apiKeySet, ...rest } = config;
            await saveTTSConfig(backendUrl, { ...rest, ...patch, apiKey: '', clearApiKey: false });
        } catch (error) {
            console.error('[TTSSettingsModal] config patch save failed:', error);
        }
    };

    const handleConnectionTest = async () => {
        if (isTesting || !config) return;
        setIsTesting(true);
        setTestResult(null);
        try {
            // 保存済み設定ではなく、入力中の値で確認する。
            setTestResult(await testTTSConnection(backendUrl, {
                connectionUrl: config.connectionUrl,
                connectTimeoutSeconds: config.connectTimeoutSeconds,
                apiKey: clearApiKey ? '' : apiKeyInput,
                clearApiKey,
            }));
        } catch (error) {
            console.error('[TTSSettingsModal] connection test failed:', error);
            setTestResult({
                success: false,
                message: t('tts.connection.requestFailed', '接続確認のリクエストに失敗しました'),
                checks: {},
            });
        } finally {
            setIsTesting(false);
        }
    };

    const stopTestAudio = () => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }
    };

    const handleTestSynthesize = async () => {
        if (testBusy) {
            testAbortRef.current?.abort();
            return;
        }
        if (!effectivePreviewText.trim() || !testTarget) return;
        stopTestAudio();
        setTestBusy(true);
        const ctrl = new AbortController();
        testAbortRef.current = ctrl;
        try {
            const blob = await previewTTS(backendUrl, { text: effectivePreviewText, voiceId: testTarget }, ctrl.signal);
            if (testAudioUrl) URL.revokeObjectURL(testAudioUrl);
            const url = URL.createObjectURL(blob);
            setTestAudioUrl(url);
            const audio = new Audio(url);
            audioRef.current = audio;
            await audio.play();
        } catch (error) {
            if (!ctrl.signal.aborted) {
                console.error('[TTSSettingsModal] test synthesize failed:', error);
                showNotice(t('tts.voices.previewFailed', '試聴に失敗しました'));
            }
        } finally {
            setTestBusy(false);
        }
    };

    const handleTestReplay = () => {
        if (!testAudioUrl) return;
        stopTestAudio();
        const audio = new Audio(testAudioUrl);
        audioRef.current = audio;
        void audio.play();
    };

    // 保存済み選択が一覧に無い場合（未接続等）も選択肢として残す。
    const voiceIds = voices.map(v => v.id);
    if (testTarget && !voiceIds.includes(testTarget)) voiceIds.unshift(testTarget);

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg border border-gray-700 max-h-[90vh] flex flex-col overflow-hidden">
                {/* ヘッダー */}
                <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-700 bg-gray-800 shrink-0">
                    <AudioLines size={20} className="text-orange-400" />
                    <h2 className="text-lg font-semibold text-gray-100">
                        {t('tts.settings.compactTitle', 'TTS設定')}
                    </h2>
                    {notice && <span className="text-xs text-orange-300">{notice}</span>}
                    <button
                        onClick={onClose}
                        className="ml-auto p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                        title={t('common.close', '閉じる')}
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
                    {config === null && (
                        <p className="text-xs text-gray-500">{t('tts.drawer.loadFailed', '設定を読み込めませんでした')}</p>
                    )}

                    {/* 接続設定＋接続確認 */}
                    <div className="border border-orange-600/40 rounded-lg overflow-hidden">
                        <button
                            onClick={() => setIsConnectionOpen(prev => !prev)}
                            className="w-full flex items-center gap-2 px-4 py-3 bg-gray-800/80 hover:bg-gray-800 text-sm font-medium text-orange-300 transition-colors"
                        >
                            {isConnectionOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            <Plug size={16} className="text-orange-400" />
                            {t('tts.settings.connectionSection', '接続設定')}
                        </button>
                        {isConnectionOpen && config && (
                            <div className="p-4 space-y-4">
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">
                                        {t('tts.settings.connectionUrl', 'エンドポイントURL')}
                                    </label>
                                    <input
                                        type="text"
                                        value={config.connectionUrl}
                                        onChange={e => updateConfig('connectionUrl', e.target.value)}
                                        placeholder="http://127.0.0.1:8088"
                                        className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 outline-none focus:border-orange-500"
                                    />
                                    <p className="mt-1 text-[11px] text-gray-500">
                                        {t('tts.settings.connectionUrlHint', 'Irodori-TTS-Server の接続先。別PC上のサーバーも指定できます。')}
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">
                                        {t('tts.settings.apiKey', 'APIキー（リモート接続時のみ）')}
                                    </label>
                                    <input
                                        type="password"
                                        value={apiKeyInput}
                                        onChange={e => {
                                            setApiKeyInput(e.target.value);
                                            setClearApiKey(false);
                                            setIsDirty(true);
                                        }}
                                        placeholder={config.apiKeySet
                                            ? t('tts.settings.apiKeySetPlaceholder', '設定済み（変更する場合のみ入力）')
                                            : t('tts.settings.apiKeyUnsetPlaceholder', '未設定')}
                                        className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 outline-none focus:border-orange-500"
                                    />
                                    {config.apiKeySet && (
                                        <label className="mt-1.5 flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
                                            <input
                                                type="checkbox"
                                                checked={clearApiKey}
                                                onChange={e => {
                                                    setClearApiKey(e.target.checked);
                                                    if (e.target.checked) setApiKeyInput('');
                                                    setIsDirty(true);
                                                }}
                                                className="accent-orange-500"
                                            />
                                            <span>{t('tts.settings.clearApiKey', 'APIキーを削除（チェックを入れて保存ボタンを押すと削除されます）')}</span>
                                        </label>
                                    )}
                                </div>
                                <div className="flex items-end gap-3">
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">
                                            {t('tts.settings.connectTimeout', '接続タイムアウト（秒）')}
                                        </label>
                                        <input
                                            type="number"
                                            min={1}
                                            max={60}
                                            value={config.connectTimeoutSeconds}
                                            onChange={e => updateConfig('connectTimeoutSeconds', Number(e.target.value))}
                                            className="w-24 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 outline-none focus:border-orange-500"
                                        />
                                    </div>
                                    <div className="ml-auto flex items-center gap-2">
                                        <button
                                            onClick={handleSave}
                                            disabled={!isDirty || isSaving}
                                            className="px-4 py-2 text-sm bg-orange-700 hover:bg-orange-600 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isSaving ? t('tts.settings.saving', '保存中...') : t('tts.settings.save', '保存')}
                                        </button>
                                        <button
                                            onClick={() => void handleConnectionTest()}
                                            disabled={isTesting}
                                            className="px-4 py-2 text-sm border border-orange-600/60 text-orange-300 hover:bg-orange-900/30 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isTesting ? t('tts.connection.testing', '確認中...') : t('tts.connection.test', '接続を確認')}
                                        </button>
                                    </div>
                                </div>
                                {testResult && (
                                    <div className="space-y-2 text-sm border border-gray-700/60 rounded p-3">
                                        <div className={testResult.success ? 'text-emerald-300' : 'text-red-300'}>
                                            {testResult.success
                                                ? t('tts.connection.ok', '接続できました')
                                                : t('tts.connection.failed', '接続できませんでした')}
                                        </div>
                                        <div className="text-xs text-gray-400 space-y-1">
                                            {(['health', 'models', 'voices'] as const).map(key => (
                                                <div key={key} className="flex items-center gap-2">
                                                    <span className={testResult.checks[key] ? 'text-emerald-400' : 'text-red-400'}>
                                                        {testResult.checks[key] ? '✓' : '✗'}
                                                    </span>
                                                    <span>
                                                        {key === 'health' && t('tts.connection.checkHealth', 'サーバー応答')}
                                                        {key === 'models' && t('tts.connection.checkModels', 'モデル一覧')}
                                                        {key === 'voices' && t('tts.connection.checkVoices', 'Voice一覧')}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* キャラクター音声設定（小画面用モーダルへ） */}
                    <button
                        onClick={() => setIsCharModalOpen(true)}
                        className="w-full flex items-center gap-2 px-4 py-3 border border-pink-600/40 rounded-lg bg-gray-800/60 hover:bg-gray-800 text-sm font-medium text-pink-300 transition-colors"
                    >
                        <Users size={16} className="text-pink-400" />
                        {t('tts.charModal.title', 'キャラクター音声設定')}
                        <ChevronRight size={16} className="ml-auto" />
                    </button>

                    {/* 文体指示（絵文字による感情表現） */}
                    {config && (
                        <div className="border border-orange-600/40 rounded-lg p-4 space-y-3">
                            <div className="flex items-center gap-2 text-sm font-medium text-orange-300">
                                <Smile size={16} className="text-orange-400" />
                                {t('tts.emojiStyle.section', '文体指示（絵文字による感情表現）')}
                            </div>
                            <ToggleSwitch
                                checked={config.emojiStyleEnabled}
                                onChange={value => void persistConfigPatch({ emojiStyleEnabled: value })}
                                label={t('tts.emojiStyle.enabled', 'Irodori-TTS用文体指示')}
                                labelPosition="right"
                                accent="orange"
                            />
                            <p className="text-[11px] text-gray-500">
                                {t('tts.emojiStyle.hint', '有効にすると、AIが対応絵文字を文へ添えて応答し、読み上げ音声へ感情が乗ります。絵文字は画面表示と画像生成では常に取り除かれ、音声生成にだけ使われます。変更は即時保存されます。')}
                            </p>
                        </div>
                    )}

                    {/* チャンク間の無音（秒）。統合設定と同じ項目。欄を離れる／Enter で保存し、以後の生成から適用 */}
                    {config && (
                        <div className="border border-orange-600/40 rounded-lg p-4 space-y-2">
                            <label className="flex items-center gap-2 text-xs text-gray-400">
                                {t('tts.gap.chunkSilence', 'チャンク間の無音（秒）')}
                                <input
                                    type="number"
                                    min={0}
                                    max={10}
                                    step={0.1}
                                    defaultValue={config.chunkSilenceSeconds}
                                    key={`chunk-${config.chunkSilenceSeconds}`}
                                    onBlur={e => {
                                        const v = Number(e.target.value);
                                        if (Number.isFinite(v) && v >= 0 && v !== config.chunkSilenceSeconds) void persistConfigPatch({ chunkSilenceSeconds: v });
                                    }}
                                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                    className="w-20 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 outline-none focus:border-orange-500"
                                />
                            </label>
                            <p className="text-[11px] text-gray-500">
                                {t('tts.gap.chunkSilenceHint', '結合音声への無音挿入と逐次再生の間隔の両方に使います。以後の生成から適用されます。')}
                            </p>
                        </div>
                    )}

                    {/* 読み上げテスト */}
                    <div className="border border-orange-600/40 rounded-lg p-4 space-y-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-orange-300">
                            <Play size={15} className="text-orange-400" />
                            {t('tts.test.section', '読み上げテスト')}
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">
                                {t('tts.test.text', 'テスト用テキスト')}
                            </label>
                            <textarea
                                value={effectivePreviewText}
                                onChange={e => setPreviewText(e.target.value)}
                                rows={3}
                                className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 outline-none focus:border-orange-500 resize-y"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">
                                {t('tts.test.voice', 'テストする音声')}
                            </label>
                            <select
                                value={testTarget}
                                onChange={e => setTestTarget(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 outline-none focus:border-orange-500"
                            >
                                <option value="">{voicesLoaded ? t('tts.test.selectVoice', '音声を選択') : t('tts.voices.loading', '読み込み中...')}</option>
                                {voiceIds.map(id => (
                                    <option key={id} value={id}>{id}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => void handleTestSynthesize()}
                                disabled={!testBusy && (!effectivePreviewText.trim() || !testTarget)}
                                className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${testBusy
                                    ? 'bg-red-800 hover:bg-red-700 text-white'
                                    : 'bg-orange-700 hover:bg-orange-600 text-white'}`}
                            >
                                {testBusy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                                {testBusy ? t('tts.test.cancel', 'キャンセル') : t('tts.test.run', 'テスト')}
                            </button>
                            <button
                                onClick={handleTestReplay}
                                disabled={!testAudioUrl || testBusy}
                                className="flex items-center gap-1.5 px-3 py-2 text-sm border border-orange-600/60 text-orange-300 hover:bg-orange-900/30 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Play size={14} />
                                {t('tts.test.replay', '再生')}
                            </button>
                        </div>
                    </div>

                    {/* 統合設定への導線（渡された環境のみ） */}
                    {onOpenIntegrated && (
                        <button
                            onClick={() => {
                                onClose();
                                onOpenIntegrated();
                            }}
                            className="w-full px-4 py-2 text-sm border border-gray-600 text-gray-300 hover:bg-gray-800 rounded-lg transition-colors"
                        >
                            {t('tts.settings.openIntegrated', 'TTS統合設定を開く')}
                        </button>
                    )}
                </div>
            </div>

            <TTSCharacterSettingsModal
                isOpen={isCharModalOpen}
                onClose={() => setIsCharModalOpen(false)}
                backendUrl={backendUrl}
                uiCatalog={uiCatalog}
            />
        </div>
    );
};
