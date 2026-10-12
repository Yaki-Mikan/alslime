/**
 * ImageGenDrawerControls.tsx - クイック設定の画像生成ジョブの単位・自動生成・タグの有効/無効
 *
 * クイック設定の欄に並べる部品（ほかの部品と同じ開閉式の器。既定は閉）。画像生成ジョブの
 * 単位（分析と生成をまとめて 1 ジョブ／分析と生成を分ける）は横並び 2 ボタンで選び、
 * 変更は config 全体を読み直して該当キーだけ差し替えて即時保存する
 * （タグ判定・ワークフロー設定パネルと同じ規約。連続した変更で古い読み直しが新しい保存を
 * 上書きしないよう直列化する）。
 * タグの有効・無効は、ボタンからその場の窓（TagEnableModal）を開いて切り替える。
 * 窓の「素材づくりで編集」から、素材づくりのタグのタブへ移れる（onOpenTags）。
 * クイック設定の欄は閉じても中身を捨てないため、欄の開閉状態を active で受け取り、
 * 欄が開くたびに設定を読み直す（ほかの画面での変更を拾う）。表示条件（支援者機能・モジュール連携）は
 * Chat 側で判定して渡す。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle, ChevronDown, ChevronRight, Layers, ListChecks } from 'lucide-react';
import { getComfyUIConfig, saveComfyUIConfig } from '../../api/comfyui';
import type { ComfyUIConfig, ImageJobMode } from '../../api/comfyui';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { TagEnableModal } from './TagEnableModal';
import { AutoSoundEffectsToggle } from './apiservice/AutoSoundEffectsToggle';
import { createComfyUIText } from './i18n';
import type { I18NCatalog } from '../../api/i18n';

interface Props {
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    // クイック設定の欄が開いているか。true になるたびに設定を読み直す（未指定なら常に有効）。
    active?: boolean;
    // 素材づくりのタグのタブを開く（未指定なら、タグの窓に「素材づくりで編集」を出さない）
    onOpenTags?: () => void;
}

// 設定に無い・想定外の値は既定（まとめて 1 ジョブ）として扱う
const normalizeImageJobMode = (value: unknown): ImageJobMode => (value === 'split' ? 'split' : 'combined');

export const ImageGenDrawerControls: React.FC<Props> = ({ backendUrl, uiCatalog = null, active = true, onOpenTags }) => {
    const { COMMON, SECTION_NAMES } = createComfyUIText(uiCatalog);
    const [isOpen, setIsOpen] = useState(false);
    const [isTagEnableOpen, setIsTagEnableOpen] = useState(false);
    const [imageJobMode, setImageJobMode] = useState<ImageJobMode>('combined');
    // 応答時の自動画像生成（設定に無ければ無効として扱う）
    const [autoGenerateEnabled, setAutoGenerateEnabled] = useState(false);
    // 開くたびに読み直した設定（自動効果音描画のトグルへ渡す。同じ設定を二重に読まないため）
    const [loadedConfig, setLoadedConfig] = useState<ComfyUIConfig | null>(null);
    const [notice, setNotice] = useState<{ kind: 'saved' | 'error'; text: string } | null>(null);
    // 保存の直列化（読み直し→書き込みの組が交差しないようにする）
    const saveChain = useRef<Promise<void>>(Promise.resolve());

    // パネルを開いたとき、および開いたままクイック設定の欄が開き直されるたびに現在の設定を読み込む
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
                setLoadedConfig(config);
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
        <div className="border border-line-strong rounded-lg overflow-hidden bg-surface">
            {/* 開閉ヘッダ（タグ判定・ワークフロー設定パネルと同じ器） */}
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-fg hover:bg-surface-2 transition-colors text-left"
            >
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Layers size={14} className="text-accent" />
                <span>{COMMON.BUTTONS.IMAGE_JOB_MODE}</span>
            </button>
            {isOpen && (
                <div className="p-3 border-t border-line-strong space-y-3">
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
                                            ? 'bg-accent-soft border-accent text-fg'
                                            : 'bg-surface border-line-strong text-fg-muted hover:border-line-strong'
                                    }`}
                                >
                                    {row.label}
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-fg-muted">{imageJobModeDescription}</p>
                        <p className="text-xs text-fg-muted">{COMMON.BUTTONS.IMAGE_JOB_MODE_NOTE}</p>
                        {/* 応答時の自動画像生成（TTS の自動読み上げと同じ即時保存トグル） */}
                        <div className="pt-2 space-y-1">
                            <ToggleSwitch
                                checked={autoGenerateEnabled}
                                onChange={handleChangeAutoGenerate}
                                label={COMMON.BUTTONS.AUTO_GENERATE}
                                labelPosition="right"
                                accent="green"
                            />
                            <p className="text-xs text-fg-muted">{COMMON.BUTTONS.AUTO_GENERATE_DESCRIPTION}</p>
                        </div>
                        {/* 自動効果音描画（API サービスを選んでいるときだけ出す。値は設定画面のトグルと同じ） */}
                        <AutoSoundEffectsToggle
                            backendUrl={backendUrl}
                            uiCatalog={uiCatalog}
                            active={isOpen && active}
                            onlyWhenApiBackend
                            source={loadedConfig}
                        />
                        {notice && (
                            <span className={`flex items-center gap-1 text-xs ${notice.kind === 'saved' ? 'text-ok' : 'text-danger'}`}>
                                {notice.kind === 'saved' ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                                {notice.text}
                            </span>
                        )}
                    </div>

                    {/* タグの有効・無効（その場で開く窓で切り替える。中身の編集は窓から素材づくりへ移る） */}
                    <div className="space-y-1 pt-3 border-t border-line-strong">
                        <button
                            type="button"
                            onClick={() => setIsTagEnableOpen(true)}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-surface hover:bg-surface-2 border border-accent rounded-lg text-sm text-fg-muted transition-colors"
                        >
                            <ListChecks size={14} className="text-accent" />
                            {SECTION_NAMES.TAG_ENABLE}
                        </button>
                        <p className="text-xs text-fg-muted">{COMMON.MESSAGES.TAG_ENABLE_DESC}</p>
                    </div>
                </div>
            )}
            <TagEnableModal
                isOpen={isTagEnableOpen}
                onClose={() => setIsTagEnableOpen(false)}
                backendUrl={backendUrl}
                uiCatalog={uiCatalog}
                onOpenMaterial={onOpenTags}
            />
        </div>
    );
};
