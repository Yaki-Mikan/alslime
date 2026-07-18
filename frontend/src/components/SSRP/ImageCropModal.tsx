/**
 * ImageCropModal.tsx - 画像切り抜きモーダル
 * 
 * react-easy-cropを使用した1:1切り抜きUI。
 * - ドラッグで位置調整
 * - ズームスライダー
 * - 保存・キャンセルボタン
 */

import React, { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import { X, Save } from 'lucide-react';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { CHARACTER_IMAGE_I18N_KEYS, CHARACTER_IMAGE_TEXT_FALLBACK_JA, COMMON_I18N_KEYS, COMMON_TEXT_FALLBACK_JA } from '../../constants/i18n';

interface ImageCropModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (cropData: CropData) => void;
    imageSrc: string;
    emotion: string;
    uiCatalog?: I18NCatalog | null;
}

interface CropData {
    x: number;
    y: number;
    zoom: number;
    croppedAreaPixels: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}

export const ImageCropModal: React.FC<ImageCropModalProps> = ({
    isOpen,
    onClose,
    onSave,
    imageSrc,
    emotion,
    uiCatalog = null
}) => {
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState<CropData['croppedAreaPixels'] | null>(null);
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        CHARACTER_IMAGE_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key
    );
    const formatText = (template: string, values: Record<string, string | number>) =>
        Object.entries(values).reduce((text, [key, value]) => text.split(`{{${key}}}`).join(String(value)), template);

    const onCropComplete = useCallback((_croppedArea: any, croppedAreaPixels: CropData['croppedAreaPixels']) => {
        setCroppedAreaPixels(croppedAreaPixels);
    }, []);

    const handleSave = () => {
        if (!croppedAreaPixels) return;

        const cropData: CropData = {
            x: crop.x,
            y: crop.y,
            zoom,
            croppedAreaPixels
        };

        onSave(cropData);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* オーバーレイ */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* モーダル */}
            <div className="relative bg-gray-900 rounded-xl shadow-2xl border border-gray-700 w-full max-w-2xl mx-4 overflow-hidden">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 bg-gray-800">
                    <h2 className="text-lg font-semibold text-gray-100">
                        {formatText(t(CHARACTER_IMAGE_I18N_KEYS.cropTitle), { emotion })}
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* 切り抜きエリア */}
                <div className="relative h-96 bg-gray-800">
                    <Cropper
                        image={imageSrc}
                        crop={crop}
                        zoom={zoom}
                        aspect={1}
                        zoomSpeed={0.2}
                        onCropChange={setCrop}
                        onZoomChange={setZoom}
                        onCropComplete={onCropComplete}
                    />
                </div>

                {/* ズームスライダー */}
                <div className="p-4 border-t border-gray-700">
                    <div className="flex items-center gap-4">
                        <span className="text-sm text-gray-400 w-16">{t(CHARACTER_IMAGE_I18N_KEYS.zoom)}</span>
                        <input
                            type="range"
                            min={1}
                            max={3}
                            step={0.1}
                            value={zoom}
                            onChange={(e) => setZoom(Number(e.target.value))}
                            className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                        <span className="text-sm text-gray-300 w-12 text-right">
                            {Math.round(zoom * 100)}%
                        </span>
                    </div>
                </div>

                {/* フッター */}
                <div className="flex justify-end gap-2 p-4 border-t border-gray-700 bg-gray-800">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-300 hover:bg-gray-700 rounded-lg transition-colors"
                    >
                        {t(COMMON_I18N_KEYS.cancel)}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!croppedAreaPixels}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${croppedAreaPixels
                            ? 'bg-blue-600 hover:bg-blue-500 text-white'
                            : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                            }`}
                    >
                        <Save size={16} />
                        {t(COMMON_I18N_KEYS.save)}
                    </button>
                </div>
            </div>
        </div>
    );
};
