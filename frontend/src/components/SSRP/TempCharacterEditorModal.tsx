/**
 * TempCharacterEditorModal - 一時キャラクターの設定本文を見る・直す簡易エディタ
 *
 * 一時キャラクターは実ファイルを持たないため設定ファイルエディタでは開けない。
 * 会話設定内の本文を編集し、保存でサーバー（セッション正本）へ書く。
 * 開くたびに初期本文から始めるため、呼び出し側は対象ごとに key を変えて再マウントする。
 */

import React, { useState } from 'react';
import { X, Save } from 'lucide-react';
import { CodeEditor } from '../common/CodeEditor';
import { ConfirmDialog } from '../ConfirmDialog';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { SSRP_I18N_KEYS, SSRP_TEXT_FALLBACK_JA } from '../../constants/i18n';

interface TempCharacterEditorModalProps {
    isOpen: boolean;
    characterName: string;
    initialContent: string;
    onSave: (content: string) => Promise<void>;
    onClose: () => void;
    uiCatalog: I18NCatalog | null;
}

export const TempCharacterEditorModal: React.FC<TempCharacterEditorModalProps> = ({
    isOpen, characterName, initialContent, onSave, onClose, uiCatalog,
}) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, SSRP_TEXT_FALLBACK_JA[key] || key);
    const [content, setContent] = useState(initialContent);
    // 最後に保存した本文。content との差が未保存編集。
    const [savedContent, setSavedContent] = useState(initialContent);
    const [saving, setSaving] = useState(false);
    const [confirmClose, setConfirmClose] = useState(false);
    const [savedNotice, setSavedNotice] = useState(false);

    if (!isOpen) return null;
    const dirty = content !== savedContent;

    const doSave = async () => {
        if (saving) return;
        setSaving(true);
        try {
            await onSave(content);
            setSavedContent(content);
            setSavedNotice(true);
            setTimeout(() => setSavedNotice(false), 2000);
        } finally {
            setSaving(false);
        }
    };

    const requestClose = () => {
        if (dirty) {
            setConfirmClose(true);
            return;
        }
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-gray-900 border border-orange-700/60 rounded-lg shadow-xl w-full max-w-3xl h-[85vh] flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                    <div className="min-w-0">
                        <h2 className="text-sm font-bold text-orange-300 truncate">{t(SSRP_I18N_KEYS.tempCharacterEditorTitle)}</h2>
                        <p className="text-xs text-gray-400 truncate">{characterName}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {savedNotice && <span className="text-xs text-green-400">{t(SSRP_I18N_KEYS.tempCharacterEditorSaved)}</span>}
                        <button
                            onClick={doSave}
                            disabled={saving || !dirty}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-orange-700 hover:bg-orange-600 text-white disabled:opacity-40"
                        >
                            <Save size={14} />
                            {t(SSRP_I18N_KEYS.tempCharacterEditorSave)}
                        </button>
                        <button onClick={requestClose} className="p-1.5 text-gray-400 hover:text-white rounded" title={t(SSRP_I18N_KEYS.tempImportClose)}>
                            <X size={16} />
                        </button>
                    </div>
                </div>
                <div className="flex-1 min-h-0 p-2">
                    <CodeEditor value={content} onChange={setContent} onSave={doSave} uiCatalog={uiCatalog} className="h-full" />
                </div>
            </div>
            <ConfirmDialog
                isOpen={confirmClose}
                title={t(SSRP_I18N_KEYS.tempCharacterEditorUnsavedTitle)}
                message={t(SSRP_I18N_KEYS.tempCharacterEditorUnsaved)}
                onYes={async () => { setConfirmClose(false); await doSave(); onClose(); }}
                onNo={() => { setConfirmClose(false); onClose(); }}
                onCancel={() => setConfirmClose(false)}
                uiCatalog={uiCatalog}
            />
        </div>
    );
};
