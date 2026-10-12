/**
 * BulkLoraModal.tsx - 選んだ複数のキャラに LoRA をまとめて設定する
 *
 * まとめて書き換える API は無いので、1人ずつ画像設定を読み出し、LoRA だけを差し替えて保存する。
 * ほかの項目を上書きしないよう、必ず読み出してから書く。失敗したキャラは一覧にして出し、
 * 設定し終えたキャラは戻さない。中止したら次のキャラから先へは進まない。
 */
import React, { useRef, useState } from 'react';
import { resolveMessage, type I18NCatalog } from '../../../api/i18n';
import type { CharacterTagInfo } from '../../../api/files';
import { getCharacterImageGenConfig, saveCharacterImageGenConfig } from '../../../api/comfyui';
import { MATERIAL_I18N_KEYS, MATERIAL_TEXT_FALLBACK_JA } from '../../../constants/i18n';
import { Button, Modal, Segmented, Select, TextField } from '../../ui';
import { applyLora, type BulkLoraMode as Mode } from './bulkLora';

interface BulkLoraModalProps {
    open: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog: I18NCatalog | null;
    characters: CharacterTagInfo[];
    /** 選べる LoRA（キャラ用の置き場所にあるもの） */
    availableLoras: string[];
    /** 1人でも設定したら呼ぶ（一覧の状態を読み直す） */
    onApplied: () => void;
}

export const BulkLoraModal: React.FC<BulkLoraModalProps> = ({ open, onClose, backendUrl, uiCatalog, characters, availableLoras, onApplied }) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, MATERIAL_TEXT_FALLBACK_JA[key] || key);
    const format = (template: string, values: Record<string, string | number>) =>
        Object.entries(values).reduce((text, [k, v]) => text.split(`{{${k}}}`).join(String(v)), template);

    const [loraName, setLoraName] = useState('');
    const [strength, setStrength] = useState(1);
    const [mode, setMode] = useState<Mode>('replace');
    const [running, setRunning] = useState(false);
    const [done, setDone] = useState(0);
    const [okCount, setOkCount] = useState(0);
    const [failed, setFailed] = useState<string[]>([]);
    const [finished, setFinished] = useState<'done' | 'stopped' | null>(null);
    const stopRef = useRef(false);

    const reset = () => {
        setDone(0);
        setOkCount(0);
        setFailed([]);
        setFinished(null);
    };

    const run = async () => {
        if (!loraName || running) return;
        reset();
        stopRef.current = false;
        setRunning(true);
        let ok = 0;
        const failures: string[] = [];
        for (let i = 0; i < characters.length; i++) {
            if (stopRef.current) break;
            const c = characters[i];
            try {
                const loaded = await getCharacterImageGenConfig(backendUrl, c.dirName);
                const base = loaded.characterName ? loaded : { ...loaded, characterName: c.name };
                await saveCharacterImageGenConfig(backendUrl, c.dirName, applyLora(base, loraName, strength, mode));
                ok++;
                setOkCount(ok);
            } catch {
                failures.push(c.name);
                setFailed([...failures]);
            }
            setDone(i + 1);
        }
        setRunning(false);
        setFinished(stopRef.current ? 'stopped' : 'done');
        if (ok > 0) onApplied();
    };

    const close = () => {
        if (running) return;
        reset();
        onClose();
    };

    const footer = (
        <div className="flex flex-wrap justify-end gap-2">
            {running ? (
                <Button variant="danger" onClick={() => { stopRef.current = true; }}>{t(MATERIAL_I18N_KEYS.bulkStop)}</Button>
            ) : (
                <>
                    <Button variant="ghost" onClick={close}>{t(MATERIAL_I18N_KEYS.bulkClose)}</Button>
                    {!finished && (
                        <Button variant="primary" disabled={!loraName || characters.length === 0} onClick={() => { void run(); }}>
                            {format(t(MATERIAL_I18N_KEYS.bulkRun), { count: characters.length })}
                        </Button>
                    )}
                </>
            )}
        </div>
    );

    return (
        <Modal open={open} onClose={close} title={t(MATERIAL_I18N_KEYS.bulkLoraTitle)} size="md" closeLabel={t(MATERIAL_I18N_KEYS.bulkClose)} footer={footer} closeOnOverlay={!running}>
            <div className="p-5 space-y-4">
                <p className="text-sm">{format(t(MATERIAL_I18N_KEYS.bulkSelected), { count: characters.length })}</p>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                    <div>
                        <span className="block text-xs text-fg-muted mb-1">{t(MATERIAL_I18N_KEYS.bulkLoraName)}</span>
                        <Select
                            aria-label={t(MATERIAL_I18N_KEYS.bulkLoraName)}
                            value={loraName}
                            disabled={running || !!finished}
                            onChange={setLoraName}
                            options={[{ value: '', label: t(MATERIAL_I18N_KEYS.bulkLoraSelect) }, ...availableLoras.map(l => ({ value: l, label: l }))]}
                        />
                    </div>
                    <div>
                        <span className="block text-xs text-fg-muted mb-1">{t(MATERIAL_I18N_KEYS.bulkStrength)}</span>
                        <TextField
                            aria-label={t(MATERIAL_I18N_KEYS.bulkStrength)}
                            type="number"
                            step={0.05}
                            min={-5}
                            max={5}
                            value={strength}
                            disabled={running || !!finished}
                            onChange={e => setStrength(Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : 1)}
                        />
                    </div>
                </div>
                <Segmented<Mode>
                    label={t(MATERIAL_I18N_KEYS.bulkLoraTitle)}
                    value={mode}
                    onChange={v => { if (!running && !finished) setMode(v); }}
                    options={[
                        { value: 'replace', label: t(MATERIAL_I18N_KEYS.bulkModeReplace) },
                        { value: 'append', label: t(MATERIAL_I18N_KEYS.bulkModeAppend) },
                    ]}
                />
                <p className="text-xs text-fg-muted leading-relaxed">{t(MATERIAL_I18N_KEYS.bulkLoraNote)}</p>

                {(running || finished) && (
                    <div className="space-y-2">
                        <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                            <div className="h-full bg-accent transition-all" style={{ width: `${characters.length ? (done / characters.length) * 100 : 0}%` }} />
                        </div>
                        <p className="text-xs text-fg-muted">{format(t(MATERIAL_I18N_KEYS.bulkProgress), { done, total: characters.length })}</p>
                        {finished === 'done' && <p className="text-sm text-ok">{format(t(MATERIAL_I18N_KEYS.bulkDone), { count: okCount })}</p>}
                        {finished === 'stopped' && <p className="text-sm text-warn">{t(MATERIAL_I18N_KEYS.bulkStopped)}</p>}
                        {failed.length > 0 && (
                            <div>
                                <p className="text-xs font-bold text-danger">{t(MATERIAL_I18N_KEYS.bulkFailed)}</p>
                                <ul className="mt-1 text-xs text-fg-muted list-disc pl-5">
                                    {failed.map(name => <li key={name}>{name}</li>)}
                                </ul>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </Modal>
    );
};

export default BulkLoraModal;
