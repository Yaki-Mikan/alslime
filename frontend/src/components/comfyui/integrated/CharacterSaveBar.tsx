/**
 * CharacterSaveBar.tsx - キャラの画像設定の保存の帯（保存結果の文言と保存ボタン）
 *
 * 素材づくりのキャラのタブでは、スクロールする欄の外（欄のすぐ下）に置いて、
 * 画面の下端・左右の端いっぱいに常に見せる。
 */
import React, { useLayoutEffect, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import type { I18NCatalog } from '../../../api/i18n';
import { createComfyUIText } from '../i18n';
import { cn } from '../../ui';
import { keepFocusOnPointerDown } from '../../../lib/pointer';

interface Props {
    onSave: () => Promise<boolean | undefined>;
    uiCatalog?: I18NCatalog | null;
    className?: string;
}

export const CharacterSaveBar: React.FC<Props> = ({ onSave, uiCatalog = null, className }) => {
    const { COMMON } = createComfyUIText(uiCatalog);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    // 入力欄から離れたときに反映する値（別名・LoRA強度）を反映させたあとの内容で保存するため、最新の onSave を持っておく
    const onSaveRef = useRef(onSave);
    useLayoutEffect(() => {
        onSaveRef.current = onSave;
    });

    const handleSave = async () => {
        setIsSaving(true);
        // 入力中の欄から外して値を反映させ、それが描き直されるのを待ってから保存する
        const active = document.activeElement;
        if (active instanceof HTMLElement && active !== document.body) {
            active.blur();
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        const success = await onSaveRef.current();
        setIsSaving(false);
        setSaveMessage(success ? COMMON.MESSAGES.SAVED : COMMON.MESSAGES.SAVE_FAILED);
        setTimeout(() => setSaveMessage(null), 3000);
    };

    return (
        <div className={cn('flex items-center justify-between', className)}>
            <div className="text-sm">
                {saveMessage && (
                    <span className={saveMessage === COMMON.MESSAGES.SAVE_FAILED ? 'text-danger' : 'text-ok'}>
                        {saveMessage}
                    </span>
                )}
            </div>
            {/* 押したときに入力欄から外さない（外れるとキーボードが閉じて配置が動き、指で押した1回目が押下にならない）。
                変更の有無にかかわらず、押されたら必ず保存する */}
            <button
                onPointerDown={keepFocusOnPointerDown}
                onClick={() => { void handleSave(); }}
                disabled={isSaving}
                className="px-4 py-2 text-sm text-on-accent bg-accent hover:brightness-110 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5"
            >
                <Save size={14} />
                {isSaving ? COMMON.BUTTONS.SAVING : COMMON.BUTTONS.SAVE}
            </button>
        </div>
    );
};
