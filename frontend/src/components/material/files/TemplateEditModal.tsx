/**
 * TemplateEditModal.tsx - 「AI で作る」のテンプレートを小窓で直す
 *
 * 開くたびに本文を読み、「保存」でテンプレートへ保存して閉じる。「キャンセル」と × は直した内容を捨てて閉じる。
 * 押し間違えで直した内容を失わないよう、小窓の外を押しても閉じない。
 * 読み込めなかったときは、空の内容で上書きしないよう保存させない。
 */
import React, { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { CodeEditor } from '../../common/CodeEditor';
import { resolveMessage, type I18NCatalog } from '../../../api/i18n';
import {
    COMMON_I18N_KEYS,
    COMMON_TEXT_FALLBACK_JA,
    CONFIG_GEN_I18N_KEYS,
    CONFIG_GEN_TEXT_FALLBACK_JA,
    MATERIAL_I18N_KEYS,
    MATERIAL_TEXT_FALLBACK_JA,
} from '../../../constants/i18n';
import { Button, Modal } from '../../ui';

interface Props {
    open: boolean;
    title: string;
    /** 開いたときに読む本文 */
    load: () => Promise<string>;
    /** 保存する。保存できたら true（小窓を閉じる） */
    save: (content: string) => Promise<boolean>;
    onClose: () => void;
    uiCatalog: I18NCatalog | null;
}

type BodyProps = Omit<Props, 'open' | 'title'> & { t: (key: string) => string };

/** 小窓の中身。閉じると消えるので、開くたびに読み直す */
const EditBody: React.FC<BodyProps> = ({ load, save, onClose, uiCatalog, t }) => {
    const [content, setContent] = useState('');
    const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
    const [saving, setSaving] = useState(false);
    // 保存に失敗した（画面の下の知らせはこの小窓の後ろに隠れるので、小窓の中に出す）
    const [saveFailed, setSaveFailed] = useState(false);

    useEffect(() => {
        let alive = true;
        load()
            .then(c => { if (alive) { setContent(c); setStatus('ready'); } })
            .catch(() => { if (alive) setStatus('failed'); });
        return () => { alive = false; };
        // 開くたびに作り直される部品なので、読むのは最初の1回だけ
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const doSave = async () => {
        if (status !== 'ready' || saving) return;
        setSaving(true);
        setSaveFailed(false);
        const ok = await save(content);
        setSaving(false);
        if (ok) onClose();
        else setSaveFailed(true);
    };

    return (
        <div className="flex flex-col min-h-0">
            <div className="px-5 pt-4 pb-3">
                {status === 'loading' ? (
                    <div className="h-[60vh] grid place-items-center text-fg-muted">
                        <Loader2 size={20} className="animate-spin" />
                    </div>
                ) : status === 'failed' ? (
                    <p className="py-8 text-center text-sm text-danger">{t(CONFIG_GEN_I18N_KEYS.templateLoadFailed)}</p>
                ) : (
                    <div className="h-[60vh] border border-line rounded-ui overflow-hidden">
                        <CodeEditor value={content} onChange={setContent} onSave={() => { void doSave(); }} uiCatalog={uiCatalog} />
                    </div>
                )}
                <p className="text-xs text-fg-muted mt-2">{t(MATERIAL_I18N_KEYS.genItemsHint)}</p>
            </div>
            <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 px-4 py-3 border-t border-line">
                {saveFailed && <span className="mr-auto text-xs text-danger">{t(CONFIG_GEN_I18N_KEYS.saveFailed)}</span>}
                <Button variant="ghost" onClick={onClose}>{t(COMMON_I18N_KEYS.cancel)}</Button>
                <Button variant="primary" disabled={status !== 'ready' || saving} onClick={() => { void doSave(); }}>
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {saving ? t(COMMON_I18N_KEYS.saving) : t(COMMON_I18N_KEYS.save)}
                </Button>
            </div>
        </div>
    );
};

export const TemplateEditModal: React.FC<Props> = ({ open, title, onClose, uiCatalog, ...rest }) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, CONFIG_GEN_TEXT_FALLBACK_JA[key] || MATERIAL_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key);
    return (
        <Modal open={open} onClose={onClose} title={title} size="xl" closeOnOverlay={false} closeLabel={t(COMMON_I18N_KEYS.cancel)}>
            <EditBody onClose={onClose} uiCatalog={uiCatalog} t={t} {...rest} />
        </Modal>
    );
};
