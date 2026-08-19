/**
 * TTSDrawerPanel.tsx - 左メニュー用TTS設定パネル（設計04の4章）
 *
 * StatusDrawer 内で開閉するパネル（デフォルト閉。TagJudgeWorkflowDrawerPanel と
 * 同じ器の流儀）。開いた時に /api/tts/config と Voice 一覧を読み込むため、
 * 閉→開で他画面での変更を拾う。値の正本は /api/tts/config で、統合設定モーダルと
 * 同じ値を read-modify-merge の即時保存で書き戻し、他項目を消さない。
 * 表示条件（支援者機能・TTS連携済み・日本語表示）は Chat 側で判定して渡す。
 * 読み上げ範囲・地の文ナレーター読み・文体指示の「小画面でも設定できること」は
 * このパネルが担う。
 */

import React, { useEffect, useState } from 'react';
import { AudioLines, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { fetchTTSVoices, getTTSConfig, saveTTSConfig } from '../../api/tts';
import type { TTSConfig, TTSReadTarget, TTSResponseFormat, TTSVoice } from '../../api/tts';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';

interface Props {
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
}

export const TTSDrawerPanel: React.FC<Props> = ({ backendUrl, uiCatalog = null }) => {
    const t = (key: string, fallback: string) => resolveMessage(uiCatalog, key, fallback);
    const [isOpen, setIsOpen] = useState(false);
    const [config, setConfig] = useState<TTSConfig | null>(null);
    const [voices, setVoices] = useState<TTSVoice[]>([]);
    const [loading, setLoading] = useState(false);

    // 開くたびに設定とVoice一覧を読み直す（閉じている間の他画面での変更を拾う）。
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setLoading(true);
        (async () => {
            try {
                const cfg = await getTTSConfig(backendUrl);
                if (!cancelled) setConfig(cfg);
            } catch (error) {
                console.error('[TTSDrawerPanel] config load failed:', error);
                if (!cancelled) setConfig(null);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        (async () => {
            try {
                const list = await fetchTTSVoices(backendUrl);
                if (!cancelled) setVoices(list);
            } catch {
                // 未接続時はナレーターVoiceの選択肢が現在値のみになる（保存値は保持）。
                if (!cancelled) setVoices([]);
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, backendUrl]);

    // read-modify-merge の即時保存（統合設定の persistConfigPatch と同じ規約。
    // apiKey は空送信＝既存維持で、他項目も読み込んだ最新値へパッチを当てて送る）。
    const persistPatch = async (patch: Partial<TTSConfig>) => {
        if (!config) return;
        const next = { ...config, ...patch };
        setConfig(next);
        try {
            const { apiKeySet: _apiKeySet, ...rest } = next;
            await saveTTSConfig(backendUrl, { ...rest, apiKey: '', clearApiKey: false });
        } catch (error) {
            console.error('[TTSDrawerPanel] config save failed:', error);
        }
    };

    // 保存済みナレーターVoiceが一覧に無い場合（未接続等）も選択肢として残す。
    const narratorVoiceIds = voices.map(v => v.id);
    if (config?.narratorVoiceId && !narratorVoiceIds.includes(config.narratorVoiceId)) {
        narratorVoiceIds.unshift(config.narratorVoiceId);
    }

    return (
        <div className="border border-gray-700/60 rounded-lg overflow-hidden bg-gray-800/40">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700/60 transition-colors text-left"
            >
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <AudioLines size={14} className="text-orange-400" />
                <span>{t('tts.drawer.section', '音声読み上げ')}</span>
            </button>
            {isOpen && (
                <div className="p-3 border-t border-gray-700/60 space-y-3">
                    {loading && (
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                            <Loader2 size={14} className="animate-spin" />
                            {t('tts.drawer.loading', '設定を読み込み中...')}
                        </div>
                    )}
                    {!loading && config === null && (
                        <p className="text-xs text-gray-500">
                            {t('tts.drawer.loadFailed', '設定を読み込めませんでした')}
                        </p>
                    )}
                    {!loading && config && (
                        <>
                            <div className="flex items-center gap-2">
                                <label className="text-xs text-gray-400 shrink-0">
                                    {t('tts.readTarget.label', '読み上げ範囲')}
                                </label>
                                <select
                                    value={config.readTarget}
                                    onChange={e => void persistPatch({ readTarget: e.target.value as TTSReadTarget })}
                                    className="min-w-0 flex-1 bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1.5 outline-none focus:border-orange-500"
                                >
                                    <option value="dialogue">{t('tts.readTarget.dialogue', 'セリフのみ')}</option>
                                    <option value="dialogueAndNarration">{t('tts.readTarget.dialogueAndNarration', 'セリフ＋地の文')}</option>
                                </select>
                            </div>
                            {/* 音声形式（統合設定と同じ項目。mp3 はサーバー側に FFmpeg が必要。以後の生成から適用） */}
                            <div className="flex items-center gap-2">
                                <label className="text-xs text-gray-400 shrink-0">
                                    {t('tts.responseFormat.label', '音声形式')}
                                </label>
                                <select
                                    value={config.responseFormat}
                                    onChange={e => void persistPatch({ responseFormat: e.target.value as TTSResponseFormat })}
                                    className="min-w-0 flex-1 bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1.5 outline-none focus:border-orange-500"
                                >
                                    <option value="wav">wav</option>
                                    <option value="mp3">mp3</option>
                                </select>
                            </div>
                            {/* チャンク間の無音（秒）。統合設定と同じ項目。欄を離れる／Enter で保存し、以後の生成から適用 */}
                            <div className="flex items-center gap-2">
                                <label className="text-xs text-gray-400 shrink-0">
                                    {t('tts.gap.chunkSilence', 'チャンク間の無音（秒）')}
                                </label>
                                <input
                                    type="number"
                                    min={0}
                                    max={10}
                                    step={0.1}
                                    defaultValue={config.chunkSilenceSeconds}
                                    key={`chunk-${config.chunkSilenceSeconds}`}
                                    onBlur={e => {
                                        const v = Number(e.target.value);
                                        if (Number.isFinite(v) && v >= 0 && v !== config.chunkSilenceSeconds) void persistPatch({ chunkSilenceSeconds: v });
                                    }}
                                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                    className="w-20 bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1.5 outline-none focus:border-orange-500"
                                />
                            </div>
                            <ToggleSwitch
                                checked={config.autoReadEnabled}
                                onChange={value => void persistPatch({ autoReadEnabled: value })}
                                label={t('tts.drawer.autoRead', '自動読み上げ')}
                                labelPosition="right"
                                accent="orange"
                            />
                            {/* 自動読み上げがONのときだけ表示。ONなら応答完了時に生成しつつ順次再生する。 */}
                            {config.autoReadEnabled && (
                                <div className="pl-4">
                                    <ToggleSwitch
                                        checked={config.autoReadPlaybackEnabled}
                                        onChange={value => void persistPatch({ autoReadPlaybackEnabled: value })}
                                        label={t('tts.drawer.autoReadPlayback', '応答時に音声も再生する')}
                                        labelPosition="right"
                                        accent="orange"
                                    />
                                </div>
                            )}
                            <ToggleSwitch
                                checked={config.stopButtonEnabled}
                                onChange={value => void persistPatch({ stopButtonEnabled: value })}
                                label={t('tts.drawer.stopButton', '再生停止ボタンを表示')}
                                labelPosition="right"
                                accent="orange"
                            />
                            <ToggleSwitch
                                checked={config.autoAdvanceEnabled}
                                onChange={value => void persistPatch({ autoAdvanceEnabled: value })}
                                label={t('tts.autoAdvance.label', '続きを自動再生')}
                                labelPosition="right"
                                accent="orange"
                            />
                            <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs text-gray-400">
                                        {t('tts.volume.label', '再生音量')}
                                    </label>
                                    <span className="text-xs text-gray-300">{Math.round(config.volume * 100)}%</span>
                                </div>
                                {/* ドラッグ中はローカル反映のみ、離した時（キー操作後含む）に保存する。 */}
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={config.volume}
                                    onChange={e => setConfig({ ...config, volume: Number(e.target.value) })}
                                    onPointerUp={e => void persistPatch({ volume: Number((e.target as HTMLInputElement).value) })}
                                    onKeyUp={e => void persistPatch({ volume: Number((e.target as HTMLInputElement).value) })}
                                    className="w-full accent-orange-500"
                                />
                            </div>
                            <div className="space-y-2">
                                <ToggleSwitch
                                    checked={config.narratorEnabled}
                                    onChange={value => void persistPatch({ narratorEnabled: value })}
                                    label={t('tts.narrator.enabled', '地の文ナレーター読み')}
                                    labelPosition="right"
                                    accent="orange"
                                />
                                <div className="flex items-center gap-2 pl-1">
                                    <label className="text-xs text-gray-400 shrink-0">
                                        {t('tts.narrator.voice', 'ナレーター用Voice')}
                                    </label>
                                    <select
                                        value={config.narratorVoiceId}
                                        onChange={e => void persistPatch({ narratorVoiceId: e.target.value })}
                                        className="min-w-0 flex-1 bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1.5 outline-none focus:border-orange-500"
                                    >
                                        <option value="">{t('tts.charAssign.voiceNone', '（未設定）')}</option>
                                        {narratorVoiceIds.map(id => (
                                            <option key={id} value={id}>{id}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <ToggleSwitch
                                checked={config.emojiStyleEnabled}
                                onChange={value => void persistPatch({ emojiStyleEnabled: value })}
                                label={t('tts.emojiStyle.enabled', 'Irodori-TTS用文体指示')}
                                labelPosition="right"
                                accent="orange"
                            />
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
