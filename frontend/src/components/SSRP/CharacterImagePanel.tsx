/**
 * CharacterImagePanel.tsx - キャラクター画像管理パネル
 * 
 * 会話設定画面のキャラクター詳細設定内に配置される開閉可能なパネル。
 * - 画像プレビュー表示
 * - 心情プルダウン選択
 * - アップロード・切り抜き・削除ボタン
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Upload, Scissors, Trash2, ImageIcon, SlidersHorizontal, AlertCircle, Sparkles } from 'lucide-react';
import { ImageCropModal } from './ImageCropModal';
import { EmotionCatalogModal } from '../settings/EmotionCatalogModal';
import { EmotionDropdown } from '../common/EmotionDropdown';
import {
    getEmotionCatalog,
    pruneOrphanEmotionImages,
    EmotionCatalogApiError
} from '../../api/emotion-catalog';
import type { EmotionCatalogEntry } from '../../api/emotion-catalog';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { notifyCharacterImagesUpdated } from '../../lib/characterImageEvents';
import { CHARACTER_IMAGE_I18N_KEYS, CHARACTER_IMAGE_TEXT_FALLBACK_JA, COMMON_I18N_KEYS, COMMON_TEXT_FALLBACK_JA, EMOTION_CATALOG_I18N_KEYS, EMOTION_CATALOG_TEXT_FALLBACK_JA, EMOTION_IMAGE_GEN_I18N_KEYS, EMOTION_IMAGE_GEN_TEXT_FALLBACK_JA } from '../../constants/i18n';
import { authFetch } from '../../lib/authFetch';

// 埋め込み時の段階レイアウトの閾値（パネル自身の幅・px）
const EMBEDDED_WIDE_MIN_WIDTH = 560;
const EMBEDDED_MEDIUM_MIN_WIDTH = 380;

interface CharacterImagePanelProps {
    characterName: string;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    // 設定ファイルエディタへの埋め込み：開閉ヘッダー・外枠を出さず常時展開し、プレビューを大きくする
    embedded?: boolean;
    // 表情画像生成（画像生成の利用条件を満たすときだけボタンを出す。埋め込み時のみ）
    imageGenEnabled?: boolean;
    onOpenEmotionImageGen?: (emotion: string) => void;
}

interface ImageInfo {
    hasOriginal: boolean;
    hasIcon: boolean;
    originalPath: string | null;
    iconPath: string | null;
    iconUrl: string | null;
    hash: string | null;
}

export const CharacterImagePanel: React.FC<CharacterImagePanelProps> = ({
    characterName,
    backendUrl,
    uiCatalog = null,
    embedded = false,
    imageGenEnabled = false,
    onOpenEmotionImageGen,
}) => {
    const [isOpen, setIsOpen] = useState(embedded);
    const [emotions, setEmotions] = useState<EmotionCatalogEntry[]>([]);
    const [selectedEmotion, setSelectedEmotion] = useState<string>('default');
    const [imageInfo, setImageInfo] = useState<Record<string, ImageInfo>>({});
    const [isLoading, setIsLoading] = useState(false);
    const [isCropModalOpen, setIsCropModalOpen] = useState(false);
    const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isEmotionCatalogOpen, setIsEmotionCatalogOpen] = useState(false);
    const [isPruneConfirmOpen, setIsPruneConfirmOpen] = useState(false);
    const [isPruning, setIsPruning] = useState(false);
    const [pruneNotice, setPruneNotice] = useState<string | null>(null);
    // 埋め込み時はパネル自身の幅で段階的にレイアウトを変える
    //   wide   : 画像を右、操作群を左に縦並び（ボタンは文字付き）
    //   medium : 画像の下に操作群（ボタンは文字付き）
    //   compact: 画像の下に操作群（ボタンはアイコンのみ・右寄せ）
    const contentRef = useRef<HTMLDivElement>(null);
    const [panelWidth, setPanelWidth] = useState(0);
    useEffect(() => {
        if (!embedded || !isOpen) return;
        const el = contentRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(entries => {
            for (const entry of entries) setPanelWidth(entry.contentRect.width);
        });
        observer.observe(el);
        setPanelWidth(el.clientWidth);
        return () => observer.disconnect();
    }, [embedded, isOpen]);
    const layout: 'wide' | 'medium' | 'compact' = !embedded
        ? 'medium'
        : panelWidth >= EMBEDDED_WIDE_MIN_WIDTH ? 'wide'
        : panelWidth >= EMBEDDED_MEDIUM_MIN_WIDTH ? 'medium'
        : 'compact';
    const iconOnly = embedded && layout === 'compact';

    // 埋め込み時：プレビュー枠の上でホイールを回すと表情を前後に切り替える。
    // React の onWheel は passive 登録で画面スクロールを止められないため、直接リスナーを付ける。
    const previewRef = useRef<HTMLDivElement>(null);
    const emotionsRef = useRef<EmotionCatalogEntry[]>([]);
    emotionsRef.current = emotions;
    useEffect(() => {
        if (!embedded || !isOpen) return;
        const el = previewRef.current;
        if (!el) return;
        const handleWheel = (e: WheelEvent) => {
            const list = emotionsRef.current;
            if (list.length === 0 || e.deltaY === 0) return;
            e.preventDefault();
            setSelectedEmotion(current => {
                const idx = list.findIndex(emotion => emotion.name === current);
                const step = e.deltaY > 0 ? 1 : -1;
                const next = (idx < 0 ? 0 : idx + step + list.length) % list.length;
                return list[next].name;
            });
        };
        el.addEventListener('wheel', handleWheel, { passive: false });
        return () => el.removeEventListener('wheel', handleWheel);
    }, [embedded, isOpen]);
    // プレビュー枠へのドラッグ&ドロップ中か（ハイライト表示用）
    const [isDragOver, setIsDragOver] = useState(false);
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        CHARACTER_IMAGE_TEXT_FALLBACK_JA[key] || EMOTION_CATALOG_TEXT_FALLBACK_JA[key] || EMOTION_IMAGE_GEN_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key
    );
    const formatText = (template: string, values: Record<string, string | number>) =>
        Object.entries(values).reduce((text, [key, value]) => text.split(`{{${key}}}`).join(String(value)), template);

    // 表情種別リスト取得（無効な表情も含む管理用カタログから）
    const fetchEmotions = useCallback(async () => {
        try {
            const catalog = await getEmotionCatalog(backendUrl);
            setEmotions(catalog.emotions || []);
            if (!selectedEmotion && (catalog.emotions || []).length > 0) {
                setSelectedEmotion(catalog.emotions[0].name);
            }
        } catch (err) {
            console.error('Failed to fetch emotion catalog:', err);
        }
    }, [backendUrl, selectedEmotion]);

    // 画像情報取得
    const fetchImageInfo = useCallback(async () => {
        if (!characterName) return;

        try {
            const response = await authFetch(
                `${backendUrl}/api/characters/${encodeURIComponent(characterName)}/images`
            );
            const data = await response.json();
            if (data.success) {
                setImageInfo(data.data.images);
            }
        } catch (err) {
            console.error('Failed to fetch image information:', err);
        }
    }, [characterName, backendUrl]);

    // 初期化
    useEffect(() => {
        if (isOpen) {
            fetchEmotions();
            fetchImageInfo();
        }
        // fetchImageInfo は characterName に依存するため、埋め込み時のキャラ切替でも再取得される
    }, [isOpen, fetchEmotions, fetchImageInfo]);

    // 画像アップロード（ボタン選択・ドラッグ&ドロップ共通）
    const uploadImageFile = async (file: File) => {
        // 形式チェック（D&Dはinputのaccept属性を通らないためここで判定する）
        const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!acceptedTypes.includes(file.type)) {
            setError(t(CHARACTER_IMAGE_I18N_KEYS.unsupportedFileType));
            return;
        }

        // ファイルサイズチェック（5MB）
        if (file.size > 5 * 1024 * 1024) {
            setError(t(CHARACTER_IMAGE_I18N_KEYS.fileTooLarge));
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const formData = new FormData();
            formData.append('emotion', selectedEmotion);
            formData.append('image', file);

            const response = await authFetch(
                `${backendUrl}/api/characters/${encodeURIComponent(characterName)}/images/upload`,
                {
                    method: 'POST',
                    body: formData
                }
            );

            const data = await response.json();
            if (data.success) {
                // アップロード成功後、画像情報を再取得（チャット画面へも反映を通知）
                await fetchImageInfo();
                notifyCharacterImagesUpdated();
                // 切り抜きモーダルを開く
                const reader = new FileReader();
                reader.onload = () => {
                    setOriginalImageUrl(reader.result as string);
                    setIsCropModalOpen(true);
                };
                reader.readAsDataURL(file);
            } else {
                setError(data.error?.message || t(CHARACTER_IMAGE_I18N_KEYS.uploadFailed));
            }
        } catch (err) {
            setError(t(CHARACTER_IMAGE_I18N_KEYS.uploadFailed));
            console.error('Upload error:', err);
        } finally {
            setIsLoading(false);
        }
    };

    // アップロードボタン（ファイル選択）からのアップロード
    const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        await uploadImageFile(file);
        // input要素をリセット
        event.target.value = '';
    };

    // 切り抜き設定ボタン
    const handleOpenCrop = async () => {
        const info = imageInfo[selectedEmotion];
        if (!info?.hasOriginal) {
            setError(t(CHARACTER_IMAGE_I18N_KEYS.originalMissing));
            return;
        }

        // 元画像を取得
        try {
            const originalUrl = `${backendUrl}/images/characters/${encodeURIComponent(characterName)}/images/originals/${selectedEmotion}`;
            // 複数拡張子を試す
            const extensions = ['.webp', '.png', '.jpg', '.jpeg'];
            let imageFound = false;

            for (const ext of extensions) {
                try {
                    const testUrl = `${originalUrl}${ext}`;
                    const response = await fetch(testUrl);
                    if (response.ok) {
                        const blob = await response.blob();
                        const reader = new FileReader();
                        reader.onload = () => {
                            setOriginalImageUrl(reader.result as string);
                            setIsCropModalOpen(true);
                        };
                        reader.readAsDataURL(blob);
                        imageFound = true;
                        break;
                    }
                } catch (e) {
                    // 次の拡張子を試す
                }
            }

            if (!imageFound) {
                setError(t(CHARACTER_IMAGE_I18N_KEYS.originalLoadFailed));
            }
        } catch (err) {
            setError(t(CHARACTER_IMAGE_I18N_KEYS.originalLoadFailed));
            console.error('Original image load error:', err);
        }
    };

    // 切り抜き保存
    const handleCropSave = async (cropData: any) => {
        setIsLoading(true);
        setError(null);

        try {
            const response = await authFetch(
                `${backendUrl}/api/characters/${encodeURIComponent(characterName)}/images/crop`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        emotion: selectedEmotion,
                        cropData
                    })
                }
            );

            const data = await response.json();
            if (data.success) {
                await fetchImageInfo();
                notifyCharacterImagesUpdated();
                setIsCropModalOpen(false);
            } else {
                setError(data.error?.message || t(CHARACTER_IMAGE_I18N_KEYS.cropFailed));
            }
        } catch (err) {
            setError(t(CHARACTER_IMAGE_I18N_KEYS.cropFailed));
            console.error('Crop error:', err);
        } finally {
            setIsLoading(false);
        }
    };

    // 画像削除
    const handleDelete = async () => {
        if (!confirm(formatText(t(CHARACTER_IMAGE_I18N_KEYS.deleteConfirm), { emotion: selectedEmotion }))) return;

        setIsLoading(true);
        setError(null);

        try {
            const response = await authFetch(
                `${backendUrl}/api/characters/${encodeURIComponent(characterName)}/images/${selectedEmotion}`,
                { method: 'DELETE' }
            );

            const data = await response.json();
            if (data.success) {
                await fetchImageInfo();
                notifyCharacterImagesUpdated();
            } else {
                setError(data.error?.message || t(CHARACTER_IMAGE_I18N_KEYS.deleteFailed));
            }
        } catch (err) {
            setError(t(CHARACTER_IMAGE_I18N_KEYS.deleteFailed));
            console.error('Delete error:', err);
        } finally {
            setIsLoading(false);
        }
    };

    // 定義に無い表情の画像を全キャラクターから一括削除
    const handlePrune = async () => {
        setIsPruning(true);
        setError(null);
        setPruneNotice(null);
        try {
            const result = await pruneOrphanEmotionImages(backendUrl);
            setPruneNotice(formatText(t(EMOTION_CATALOG_I18N_KEYS.pruneResult), {
                files: result.deletedFiles,
                entries: result.deletedEntries,
                characters: result.affectedCharacters,
            }));
            await fetchImageInfo();
            notifyCharacterImagesUpdated();
        } catch (err) {
            console.error('Prune error:', err);
            const messageKey = err instanceof EmotionCatalogApiError ? err.messageKey : undefined;
            setError(messageKey ? t(messageKey) : t(EMOTION_CATALOG_I18N_KEYS.pruneFailed));
        } finally {
            setIsPruning(false);
            setIsPruneConfirmOpen(false);
        }
    };

    // 表情種別管理モーダルを閉じたら一覧と画像情報を取り直す
    const handleEmotionCatalogClose = () => {
        setIsEmotionCatalogOpen(false);
        fetchEmotions();
        fetchImageInfo();
    };

    const selectedEntry = emotions.find((emotion) => emotion.name === selectedEmotion);

    // 現在の心情の画像URL取得（画像管理パネル用: フォールバックなし、該当心情のみ）
    const getCurrentIconUrl = () => {
        const info = imageInfo[selectedEmotion];
        if (info?.iconUrl) {
            return `${backendUrl}${info.iconUrl}`;
        }
        // 画像管理パネルではフォールバックせず、NO IMAGEを表示
        return '/assets/default/no-image-female.png';
    };

    if (!characterName) return null;

    return (
        <div className={embedded ? '' : 'mt-4 border border-gray-700 rounded-lg overflow-hidden'}>
            {/* ヘッダー（開閉ボタン）。埋め込み時は常時展開のため出さない */}
            {!embedded && (
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-3 bg-gray-800/80 hover:bg-gray-800 transition-colors"
            >
                <div className="flex items-center gap-2 text-gray-200">
                    <ImageIcon size={18} />
                    <span className="font-medium">{t(CHARACTER_IMAGE_I18N_KEYS.title)}</span>
                </div>
                {isOpen ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
            </button>
            )}

            {/* コンテンツ */}
            {isOpen && (
                <div ref={contentRef} className="p-4 bg-gray-900 space-y-4">
                    {/* wide では画像を右・操作群を左に横並び（flex-row-reverse）、それ以外は画像の下に操作群 */}
                    <div className={layout === 'wide' ? 'flex flex-row-reverse gap-5 items-start' : 'space-y-4'}>
                    {/* 画像プレビュー（ドラッグ&ドロップで選択中の心情の元画像としてアップロード） */}
                    <div className={layout === 'wide' ? 'flex-1 min-w-0 flex justify-center' : 'flex justify-center'}>
                        <div
                            ref={previewRef}
                            className={`relative ${!embedded ? 'w-32 h-32' : layout === 'wide' ? 'w-72 h-72' : 'w-56 h-56'} rounded-lg overflow-hidden bg-gray-700 flex items-center justify-center transition-shadow ${isDragOver ? 'ring-2 ring-blue-400' : ''}`}
                            title={t(CHARACTER_IMAGE_I18N_KEYS.dropHint)}
                            onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (!isLoading) setIsDragOver(true);
                            }}
                            onDragLeave={(e) => {
                                // 子要素への移動では解除しない（ハイライトのちらつき防止）
                                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                                setIsDragOver(false);
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setIsDragOver(false);
                                if (isLoading) return;
                                const file = e.dataTransfer.files?.[0];
                                if (file) void uploadImageFile(file);
                            }}
                        >
                            <img
                                src={getCurrentIconUrl()}
                                alt={`${characterName} - ${selectedEmotion}`}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).src = '/assets/default/no-image-female.png';
                                }}
                            />
                            {isDragOver && (
                                <div className="absolute inset-0 bg-blue-600/40 flex items-center justify-center pointer-events-none">
                                    <Upload size={28} className="text-white drop-shadow" />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 操作群（心情・通知・ボタン・画像状態）。wide では固定幅の細い列にして画像を主役にする */}
                    <div className={layout === 'wide' ? 'w-56 shrink-0 space-y-3' : 'space-y-4'}>
                    {/* 心情プルダウン */}
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="text-sm text-gray-400">{t(CHARACTER_IMAGE_I18N_KEYS.emotion)}</label>
                            {/* 表情種別管理への遷移 */}
                            <button
                                onClick={() => setIsEmotionCatalogOpen(true)}
                                className="p-1.5 text-gray-400 hover:text-purple-300 hover:bg-gray-800 rounded transition-colors"
                                title={t(EMOTION_CATALOG_I18N_KEYS.manageButton)}
                            >
                                <SlidersHorizontal size={16} />
                            </button>
                        </div>
                        {/* 心情の選択（閉：表示名のみ／開：表示名＋説明。表情画像生成モーダルと共用） */}
                        <EmotionDropdown
                            emotions={emotions}
                            value={selectedEmotion}
                            onChange={setSelectedEmotion}
                            disabledSuffix={t(EMOTION_CATALOG_I18N_KEYS.disabledSuffix)}
                        />
                    </div>

                    {/* 無効な表情を選択中の注意 */}
                    {selectedEntry && !selectedEntry.enabled && (
                        <div className="p-2 bg-amber-900/30 border border-amber-700 rounded flex items-center gap-2 text-amber-300 text-sm">
                            <AlertCircle size={16} className="shrink-0" />
                            {t(EMOTION_CATALOG_I18N_KEYS.disabledNotice)}
                        </div>
                    )}

                    {/* エラーメッセージ */}
                    {error && (
                        <div className="p-2 bg-red-900/50 border border-red-700 rounded text-red-300 text-sm">
                            {error}
                        </div>
                    )}

                    {/* 一括削除の結果通知 */}
                    {pruneNotice && (
                        <div className="p-2 bg-green-900/30 border border-green-700 rounded text-green-300 text-sm">
                            {pruneNotice}
                        </div>
                    )}

                    {/* ボタン群。wide は縦並び・medium は横並び（いずれも文字付き）、compact はアイコンのみで右寄せ */}
                    <div className={layout === 'wide' ? 'flex flex-col gap-2' : iconOnly ? 'flex justify-end gap-2' : 'flex gap-2'}>
                        {/* アップロードボタン */}
                        <label className={iconOnly ? '' : 'flex-1'} title={iconOnly ? t(CHARACTER_IMAGE_I18N_KEYS.upload) : undefined}>
                            <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                onChange={handleUpload}
                                className="hidden"
                                disabled={isLoading}
                            />
                            <div className={`flex items-center justify-center gap-1 ${iconOnly ? 'p-2 rounded-md' : 'p-2 rounded-lg'} cursor-pointer transition-colors ${isLoading
                                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                : 'bg-blue-600 hover:bg-blue-500 text-white'
                                }`}>
                                <Upload size={16} />
                                {!iconOnly && <span className="text-sm">{t(CHARACTER_IMAGE_I18N_KEYS.upload)}</span>}
                            </div>
                        </label>

                        {/* 切り抜きボタン */}
                        <button
                            onClick={handleOpenCrop}
                            disabled={isLoading || !imageInfo[selectedEmotion]?.hasOriginal}
                            title={iconOnly ? t(CHARACTER_IMAGE_I18N_KEYS.crop) : undefined}
                            className={`${iconOnly ? 'p-2 rounded-md' : 'flex-1 p-2 rounded-lg'} flex items-center justify-center gap-1 transition-colors ${isLoading || !imageInfo[selectedEmotion]?.hasOriginal
                                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                : 'bg-green-600 hover:bg-green-500 text-white'
                                }`}
                        >
                            <Scissors size={16} />
                            {!iconOnly && <span className="text-sm">{t(CHARACTER_IMAGE_I18N_KEYS.crop)}</span>}
                        </button>

                        {/* 削除ボタン */}
                        <button
                            onClick={handleDelete}
                            disabled={isLoading || (!imageInfo[selectedEmotion]?.hasOriginal && !imageInfo[selectedEmotion]?.hasIcon)}
                            title={iconOnly ? t(CHARACTER_IMAGE_I18N_KEYS.delete) : undefined}
                            className={`${iconOnly ? 'p-2 rounded-md' : 'flex-1 p-2 rounded-lg'} flex items-center justify-center gap-1 transition-colors ${isLoading || (!imageInfo[selectedEmotion]?.hasOriginal && !imageInfo[selectedEmotion]?.hasIcon)
                                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                : 'bg-red-600 hover:bg-red-500 text-white'
                                }`}
                        >
                            <Trash2 size={16} />
                            {!iconOnly && <span className="text-sm">{t(CHARACTER_IMAGE_I18N_KEYS.delete)}</span>}
                        </button>
                    </div>

                    {/* 表情画像生成（埋め込み時かつ画像生成の利用条件を満たすときだけ） */}
                    {embedded && imageGenEnabled && onOpenEmotionImageGen && (
                        <div className={iconOnly ? 'flex justify-end' : 'flex'}>
                            <button
                                type="button"
                                onClick={() => onOpenEmotionImageGen(selectedEmotion)}
                                disabled={isLoading}
                                title={t(EMOTION_IMAGE_GEN_I18N_KEYS.button)}
                                className={`${iconOnly ? 'p-2 rounded-md' : 'flex-1 p-2 rounded-lg'} flex items-center justify-center gap-1 transition-colors ${isLoading
                                    ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                    : 'bg-purple-600 hover:bg-purple-500 text-white'
                                    }`}
                            >
                                <Sparkles size={16} />
                                {!iconOnly && <span className="text-sm">{t(EMOTION_IMAGE_GEN_I18N_KEYS.button)}</span>}
                            </button>
                        </div>
                    )}

                    {/* 画像状態表示 */}
                    <div className="text-xs text-gray-500 space-y-1">
                        <div>{t(CHARACTER_IMAGE_I18N_KEYS.originalImage)}: {imageInfo[selectedEmotion]?.hasOriginal ? `✓ ${t(CHARACTER_IMAGE_I18N_KEYS.available)}` : `✗ ${t(CHARACTER_IMAGE_I18N_KEYS.missing)}`}</div>
                        <div>{t(CHARACTER_IMAGE_I18N_KEYS.icon)}: {imageInfo[selectedEmotion]?.hasIcon ? `✓ ${t(CHARACTER_IMAGE_I18N_KEYS.available)}` : `✗ ${t(CHARACTER_IMAGE_I18N_KEYS.missing)}`}</div>
                    </div>

                    </div>
                    </div>

                    {/* 定義に無い表情画像の一括削除（画像・操作群の下） */}
                    <div className="pt-2 border-t border-gray-800">
                        <button
                            onClick={() => setIsPruneConfirmOpen(true)}
                            disabled={isPruning}
                            className="w-full flex items-center justify-center gap-2 p-2 rounded-lg text-sm border border-red-800 text-red-300 hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <Trash2 size={14} />
                            {t(EMOTION_CATALOG_I18N_KEYS.pruneButton)}
                        </button>
                    </div>
                </div>
            )}

            {/* 一括削除の確認モーダル（祖先の transform の影響を避けるため body 直下へポータル描画） */}
            {isPruneConfirmOpen && createPortal(
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-md border border-gray-700 overflow-hidden">
                        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-700 bg-gray-800">
                            <AlertCircle size={20} className="text-red-400" />
                            <h3 className="font-semibold text-gray-100">{t(EMOTION_CATALOG_I18N_KEYS.pruneConfirmTitle)}</h3>
                        </div>
                        <div className="p-5 space-y-3">
                            <p className="text-sm text-red-300 font-medium">
                                {t(EMOTION_CATALOG_I18N_KEYS.pruneConfirmBody)}
                            </p>
                            <p className="text-xs text-gray-400">
                                {t(EMOTION_CATALOG_I18N_KEYS.pruneConfirmNote)}
                            </p>
                        </div>
                        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-700 bg-gray-800">
                            <button
                                onClick={() => setIsPruneConfirmOpen(false)}
                                disabled={isPruning}
                                className="px-4 py-2 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded-lg transition-colors"
                            >
                                {t(COMMON_I18N_KEYS.cancel)}
                            </button>
                            <button
                                onClick={handlePrune}
                                disabled={isPruning}
                                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-lg text-white transition-colors"
                            >
                                <Trash2 size={16} />
                                {t(EMOTION_CATALOG_I18N_KEYS.pruneExecute)}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* 表情種別管理モーダル */}
            <EmotionCatalogModal
                isOpen={isEmotionCatalogOpen}
                onClose={handleEmotionCatalogClose}
                backendUrl={backendUrl}
                uiCatalog={uiCatalog}
            />

            {/* 切り抜きモーダル */}
            {isCropModalOpen && originalImageUrl && (
                <ImageCropModal
                    isOpen={isCropModalOpen}
                    onClose={() => setIsCropModalOpen(false)}
                    onSave={handleCropSave}
                    imageSrc={originalImageUrl}
                    emotion={selectedEmotion}
                    uiCatalog={uiCatalog}
                />
            )}
        </div>
    );
};
