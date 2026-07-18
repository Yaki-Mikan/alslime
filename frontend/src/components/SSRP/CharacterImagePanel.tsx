/**
 * CharacterImagePanel.tsx - キャラクター画像管理パネル
 * 
 * 会話設定画面のキャラクター詳細設定内に配置される開閉可能なパネル。
 * - 画像プレビュー表示
 * - 心情プルダウン選択
 * - アップロード・切り抜き・削除ボタン
 */

import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, Upload, Scissors, Trash2, ImageIcon } from 'lucide-react';
import { ImageCropModal } from './ImageCropModal';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { CHARACTER_IMAGE_I18N_KEYS, CHARACTER_IMAGE_TEXT_FALLBACK_JA } from '../../constants/i18n';
import { authFetch } from '../../lib/authFetch';

interface CharacterImagePanelProps {
    characterName: string;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
}

interface EmotionDefinition {
    name: string;
    description: string;
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
    uiCatalog = null
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [emotions, setEmotions] = useState<EmotionDefinition[]>([]);
    const [selectedEmotion, setSelectedEmotion] = useState<string>('default');
    const [imageInfo, setImageInfo] = useState<Record<string, ImageInfo>>({});
    const [isLoading, setIsLoading] = useState(false);
    const [isCropModalOpen, setIsCropModalOpen] = useState(false);
    const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const t = (key: string) => resolveMessage(uiCatalog, key, CHARACTER_IMAGE_TEXT_FALLBACK_JA[key] || key);
    const formatText = (template: string, values: Record<string, string | number>) =>
        Object.entries(values).reduce((text, [key, value]) => text.split(`{{${key}}}`).join(String(value)), template);

    // トークン取得

    // 心情リスト取得
    const fetchEmotions = useCallback(async () => {
        try {
            const response = await authFetch(`${backendUrl}/api/characters/emotions`);
            const data = await response.json();
            if (data.success) {
                setEmotions(data.data.emotions);
                if (!selectedEmotion && data.data.emotions.length > 0) {
                    setSelectedEmotion(data.data.emotions[0].name);
                }
            }
        } catch (err) {
            console.error('Failed to fetch emotion list:', err);
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
    }, [isOpen, fetchEmotions, fetchImageInfo]);

    // 画像アップロード
    const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

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
                // アップロード成功後、画像情報を再取得
                await fetchImageInfo();
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
        <div className="mt-4 border border-gray-700 rounded-lg overflow-hidden">
            {/* ヘッダー（開閉ボタン） */}
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

            {/* コンテンツ */}
            {isOpen && (
                <div className="p-4 bg-gray-900 space-y-4">
                    {/* 画像プレビュー */}
                    <div className="flex justify-center">
                        <div className="w-32 h-32 rounded-lg overflow-hidden bg-gray-700 flex items-center justify-center">
                            <img
                                src={getCurrentIconUrl()}
                                alt={`${characterName} - ${selectedEmotion}`}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).src = '/assets/default/no-image-female.png';
                                }}
                            />
                        </div>
                    </div>

                    {/* 心情プルダウン */}
                    <div>
                        <label className="block text-sm text-gray-400 mb-1">{t(CHARACTER_IMAGE_I18N_KEYS.emotion)}</label>
                        <select
                            value={selectedEmotion}
                            onChange={(e) => setSelectedEmotion(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 text-gray-100 rounded-lg p-2"
                        >
                            {emotions.map((emotion) => (
                                <option key={emotion.name} value={emotion.name}>
                                    {emotion.name} - {emotion.description}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* エラーメッセージ */}
                    {error && (
                        <div className="p-2 bg-red-900/50 border border-red-700 rounded text-red-300 text-sm">
                            {error}
                        </div>
                    )}

                    {/* ボタン群 */}
                    <div className="flex gap-2">
                        {/* アップロードボタン */}
                        <label className="flex-1">
                            <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                onChange={handleUpload}
                                className="hidden"
                                disabled={isLoading}
                            />
                            <div className={`flex items-center justify-center gap-1 p-2 rounded-lg cursor-pointer transition-colors ${isLoading
                                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                : 'bg-blue-600 hover:bg-blue-500 text-white'
                                }`}>
                                <Upload size={16} />
                                <span className="text-sm">{t(CHARACTER_IMAGE_I18N_KEYS.upload)}</span>
                            </div>
                        </label>

                        {/* 切り抜きボタン */}
                        <button
                            onClick={handleOpenCrop}
                            disabled={isLoading || !imageInfo[selectedEmotion]?.hasOriginal}
                            className={`flex-1 flex items-center justify-center gap-1 p-2 rounded-lg transition-colors ${isLoading || !imageInfo[selectedEmotion]?.hasOriginal
                                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                : 'bg-green-600 hover:bg-green-500 text-white'
                                }`}
                        >
                            <Scissors size={16} />
                            <span className="text-sm">{t(CHARACTER_IMAGE_I18N_KEYS.crop)}</span>
                        </button>

                        {/* 削除ボタン */}
                        <button
                            onClick={handleDelete}
                            disabled={isLoading || (!imageInfo[selectedEmotion]?.hasOriginal && !imageInfo[selectedEmotion]?.hasIcon)}
                            className={`flex-1 flex items-center justify-center gap-1 p-2 rounded-lg transition-colors ${isLoading || (!imageInfo[selectedEmotion]?.hasOriginal && !imageInfo[selectedEmotion]?.hasIcon)
                                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                : 'bg-red-600 hover:bg-red-500 text-white'
                                }`}
                        >
                            <Trash2 size={16} />
                            <span className="text-sm">{t(CHARACTER_IMAGE_I18N_KEYS.delete)}</span>
                        </button>
                    </div>

                    {/* 画像状態表示 */}
                    <div className="text-xs text-gray-500 space-y-1">
                        <div>{t(CHARACTER_IMAGE_I18N_KEYS.originalImage)}: {imageInfo[selectedEmotion]?.hasOriginal ? `✓ ${t(CHARACTER_IMAGE_I18N_KEYS.available)}` : `✗ ${t(CHARACTER_IMAGE_I18N_KEYS.missing)}`}</div>
                        <div>{t(CHARACTER_IMAGE_I18N_KEYS.icon)}: {imageInfo[selectedEmotion]?.hasIcon ? `✓ ${t(CHARACTER_IMAGE_I18N_KEYS.available)}` : `✗ ${t(CHARACTER_IMAGE_I18N_KEYS.missing)}`}</div>
                    </div>
                </div>
            )}

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
