/**
 * ImageGenDrawerControls.tsx - 左メニュー用の画像生成ジョブ単位とタグ有効/無効設定
 *
 * StatusDrawer 内で開閉するパネル（他のパネルと同じ器。デフォルト閉）。画像生成ジョブの
 * 単位（分析と生成をまとめて 1 ジョブ／分析と生成を分ける）は背景画像の縮尺と同じ
 * 横並び 2 ボタンで選び、変更は config 全体を読み直して該当キーだけ差し替えて即時保存する
 * （タグ判定・ワークフロー設定パネルと同じ規約。連続した変更で古い読み直しが新しい保存を
 * 上書きしないよう直列化する）。
 * タグ有効/無効設定はボタンから ComfyUITagEnableModal を開く。
 * StatusDrawer は閉じても中身を捨てないため、パネルを開いたままドロワーを閉じて開き直した
 * 場合も他画面での変更を拾えるよう、ドロワーの開閉状態を active で受け取り、パネルが
 * 開いていてドロワーが開くたびに設定を読み直す。表示条件（支援者機能・モジュール連携）は
 * Chat 側で判定して渡す。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle, ChevronDown, ChevronRight, Layers, ListChecks } from 'lucide-react';
import { getComfyUIConfig, saveComfyUIConfig } from '../../api/comfyui';
import type { ImageJobMode } from '../../api/comfyui';
import { ComfyUITagEnableModal } from './ComfyUITagEnableModal';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { createComfyUIText } from './i18n';
import type { I18NCatalog } from '../../api/i18n';

interface Props {
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    // ドロワーが開いているか。true になるたびに設定を読み直す（未指定なら常に有効）。
    active?: boolean;
}

// 設定に無い・想定外の値は既定（まとめて 1 ジョブ）として扱う
const normalizeImageJobMode = (value: unknown): ImageJobMode => (value === 'split' ? 'split' : 'combined');

export const ImageGenDrawerControls: React.FC<Props> = ({ backendUrl, uiCatalog = null, active = true }) => {
    const { COMMON, SECTION_NAMES } = createComfyUIText(uiCatalog);
    const [isOpen, setIsOpen] = useState(false);
    const [imageJobMode, setImageJobMode] = useState<ImageJobMode>('combined');
    // 応答時の自動画像生成（設定に無ければ無効として扱う）
    const [autoGenerateEnabled, setAutoGenerateEnabled] = useState(false);
    const [isTagEnableOpen, setIsTagEnableOpen] = useState(false);
    const [notice, setNotice] = useState<{ kind: 'saved' | 'error'; text: string } | null>(null);
    // 保存の直列化（読み直し→書き込みの組が交差しないようにする）
    const saveChain = useRef<Promise<void>>(Promise.resolve());

    // パネルを開いたとき、および開いたままドロワーが開き直されるたびに現在の設定を読み込む
    // （閉じている間の他画面での変更を拾う）。
    useEffect(() => {
        if (!isOpen || !active) return;
        let cancelled = false;
        (async () => {
            try {
                const config = await getComfyUIConfig(backendUrl);
                if (cancelled) return;
                setImageJobMode(normalizeImageJobMode(config.imageJobMode));
                setAutoGenerateEnabled(config.autoGenerateEnabled === true);
            } catch (error) {
                console.error('[ImageGenDrawerControls] config load failed:', error);
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, active, backendUrl]);

    const showNotice = (kind: 'saved' | 'error', text: string) => {
        setNotice({ kind, text });
        window.setTimeout(() => setNotice(null), 2500);
    };

    // 即時保存（config 全体を読み直して imageJobMode だけ差し替えて PUT）
    const persistImageJobMode = useCallback((mode: ImageJobMode) => {
        const run = async () => {
            try {
                const config = await getComfyUIConfig(backendUrl);
                await saveComfyUIConfig(backendUrl, { ...config, imageJobMode: mode });
                showNotice('saved', COMMON.MESSAGES.SAVED);
            } catch (error) {
                console.error('[ImageGenDrawerControls] save failed:', error);
                showNotice('error', COMMON.MESSAGES.SAVE_FAILED);
            }
        };
        saveChain.current = saveChain.current.then(run, run);
        return saveChain.current;
    }, [backendUrl, COMMON.MESSAGES.SAVED, COMMON.MESSAGES.SAVE_FAILED]);

    const handleChangeImageJobMode = (mode: ImageJobMode) => {
        setImageJobMode(mode);
        void persistImageJobMode(mode);
    };

    // 即時保存（config 全体を読み直して autoGenerateEnabled だけ差し替えて PUT）
    const persistAutoGenerateEnabled = useCallback((enabled: boolean) => {
        const run = async () => {
            try {
                const config = await getComfyUIConfig(backendUrl);
                await saveComfyUIConfig(backendUrl, { ...config, autoGenerateEnabled: enabled });
                showNotice('saved', COMMON.MESSAGES.SAVED);
            } catch (error) {
                console.error('[ImageGenDrawerControls] auto generate save failed:', error);
                showNotice('error', COMMON.MESSAGES.SAVE_FAILED);
            }
        };
        saveChain.current = saveChain.current.then(run, run);
        return saveChain.current;
    }, [backendUrl, COMMON.MESSAGES.SAVED, COMMON.MESSAGES.SAVE_FAILED]);

    const handleChangeAutoGenerate = (enabled: boolean) => {
        setAutoGenerateEnabled(enabled);
        void persistAutoGenerateEnabled(enabled);
    };

    const imageJobModeDescription = imageJobMode === 'split'
        ? COMMON.BUTTONS.IMAGE_JOB_MODE_SPLIT_DESCRIPTION
        : COMMON.BUTTONS.IMAGE_JOB_MODE_COMBINED_DESCRIPTION;

    const modeRows: { value: ImageJobMode; label: string }[] = [
        { value: 'combined', label: COMMON.BUTTONS.IMAGE_JOB_MODE_COMBINED },
        { value: 'split', label: COMMON.BUTTONS.IMAGE_JOB_MODE_SPLIT },
    ];

    return (
        <div className="border border-gray-700/60 rounded-lg overflow-hidden bg-gray-800/40">
            {/* 開閉ヘッダ（タグ判定・ワークフロー設定パネルと同じ器） */}
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700/60 transition-colors text-left"
            >
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Layers size={14} className="text-green-400" />
                <span>{COMMON.BUTTONS.IMAGE_JOB_MODE}</span>
            </button>
            {isOpen && (
                <div className="p-3 border-t border-gray-700/60 space-y-3">
                    {/* 画像生成ジョブの単位（背景画像の縮尺と同じ横並び 2 ボタン。変更は即時保存） */}
                    <div className="space-y-1">
                        <div className="flex gap-2">
                            {modeRows.map((row) => (
                                <button
                                    key={row.value}
                                    type="button"
                                    aria-pressed={imageJobMode === row.value}
                                    onClick={() => handleChangeImageJobMode(row.value)}
                                    className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                                        imageJobMode === row.value
                                            ? 'bg-blue-600/30 border-blue-500 text-blue-200'
                                            : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
                                    }`}
                                >
                                    {row.label}
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-gray-600">{imageJobModeDescription}</p>
                        <p className="text-xs text-gray-600">{COMMON.BUTTONS.IMAGE_JOB_MODE_NOTE}</p>
                        {/* 応答時の自動画像生成（TTS の自動読み上げと同じ即時保存トグル） */}
                        <div className="pt-2 space-y-1">
                            <ToggleSwitch
                                checked={autoGenerateEnabled}
                                onChange={handleChangeAutoGenerate}
                                label={COMMON.BUTTONS.AUTO_GENERATE}
                                labelPosition="right"
                                accent="green"
                            />
                            <p className="text-xs text-gray-600">{COMMON.BUTTONS.AUTO_GENERATE_DESCRIPTION}</p>
                        </div>
                        {notice && (
                            <span className={`flex items-center gap-1 text-xs ${notice.kind === 'saved' ? 'text-green-400' : 'text-red-300'}`}>
                                {notice.kind === 'saved' ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                                {notice.text}
                            </span>
                        )}
                    </div>

                    {/* タグ有効/無効設定（カテゴリ横断のトグル一覧を別モーダルで開く） */}
                    <div className="space-y-1 pt-3 border-t border-gray-700/60">
                        <button
                            type="button"
                            onClick={() => setIsTagEnableOpen(true)}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-cyan-600 rounded-lg text-sm text-gray-300 transition-colors"
                        >
                            <ListChecks size={14} className="text-cyan-400" />
                            {SECTION_NAMES.TAG_ENABLE}
                        </button>
                        <p className="text-xs text-gray-500">{COMMON.MESSAGES.TAG_ENABLE_DESC}</p>
                    </div>
                </div>
            )}

            <ComfyUITagEnableModal
                isOpen={isTagEnableOpen}
                onClose={() => setIsTagEnableOpen(false)}
                backendUrl={backendUrl}
                uiCatalog={uiCatalog}
            />
        </div>
    );
};
