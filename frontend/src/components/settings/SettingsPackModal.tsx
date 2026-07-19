import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Package, Download, Upload, AlertTriangle, ChevronDown, Sparkles } from 'lucide-react';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import {
    fetchSettingsPackCatalog,
    inspectSettingsPack,
    importSettingsPack,
    exportSettingsPack,
    fetchSettingsPackInbox,
    downloadSamplePack,
    type SettingsPackKind,
    type SettingsPackPlan,
    type SettingsPackPolicy,
    type SettingsPackImportResult,
    type SettingsPackInboxReport,
} from '../../api/settings-pack';

// 設定パック（設定インポート・エクスポート）モーダル。
// エクスポート: 種別選択 → zip ダウンロード。
// インポート: zip 選択 → プラン（dry-run）確認 → 衝突ポリシー選択 → 適用。
// 画像生成系（D 分類）は backend の catalog 応答から既に除外されている（tier ゲート）。

interface SettingsPackModalProps {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog: I18NCatalog | null;
}

// UI 文言のフォールバック（backend i18n カタログ未取得時）。
const FALLBACK_JA: Record<string, string> = {
    'settingsPack.title': '設定パック',
    'settingsPack.description': '設定一式を zip パックとして書き出し・取り込みできます。',
    'settingsPack.exportTab': 'エクスポート',
    'settingsPack.importTab': 'インポート',
    'settingsPack.export.selectTitle': '書き出す設定の選択',
    'settingsPack.export.selectAll': 'すべて選択',
    'settingsPack.export.clearAll': '選択解除',
    'settingsPack.export.includeImages': 'キャラクター画像を含める（サイズが大きくなります）',
    'settingsPack.export.nameLabel': 'パック名（任意）',
    'settingsPack.export.download': 'エクスポート（zip をダウンロード）',
    'settingsPack.export.running': '書き出し中...',
    'settingsPack.import.selectFile': 'パックファイル（zip）を選択',
    'settingsPack.import.inspecting': 'パックを検査しています...',
    'settingsPack.import.planTitle': '取り込みプラン',
    'settingsPack.import.policyLabel': '既存ファイルと衝突した場合',
    'settingsPack.policy.skip': 'スキップ（既存を残す）',
    'settingsPack.policy.overwrite': '上書き',
    'settingsPack.policy.rename': 'リネームして追加',
    'settingsPack.policy.followGlobal': '一括設定に従う',
    'settingsPack.import.apply': '取り込み実行',
    'settingsPack.import.running': '取り込み中...',
    'settingsPack.import.doneTitle': '取り込み結果',
    'settingsPack.summary.new': '新規',
    'settingsPack.summary.conflict': '衝突',
    'settingsPack.summary.skip': 'スキップ',
    'settingsPack.result.written': '書き込み',
    'settingsPack.result.skipped': 'スキップ',
    'settingsPack.warningsTitle': '警告',
    'settingsPack.error.inspectFailed': 'パックの検査に失敗しました。',
    'settingsPack.error.importFailed': 'パックの取り込みに失敗しました。',
    'settingsPack.error.exportFailed': 'エクスポートに失敗しました。',
    'settingsPack.error.noKinds': 'エクスポート対象を選択してください。',
    'settingsPack.close': '閉じる',
    'settingsPack.inbox.title': '起動時取り込み（import_inbox）',
    'settingsPack.inbox.hint': 'roleplay/import_inbox にパック zip を置くと、起動時に自動で取り込みます（新規のみ。既存ファイルは変更しません）。',
    'settingsPack.inbox.empty': '今回の起動で取り込んだパックはありません。',
    'settingsPack.inbox.deferred': '上限を超えたため、{{count}} 件を次回起動時に処理します。',
    'settingsPack.inbox.failed': '取り込み処理に失敗しました。',
    'settingsPack.samples.title': '公式サンプル',
    'settingsPack.samples.hint': '公式のサンプル一式（キャラクター・テンプレート・プリセット）を GitHub からダウンロードして取り込みます。既存ファイルは変更しません。',
    'settingsPack.samples.download': 'サンプルをダウンロードして取り込み',
    'settingsPack.samples.running': 'ダウンロード中...',
    'settingsPack.samples.errorDownloadFailed': 'サンプルのダウンロードに失敗しました。ネットワーク接続を確認してください。',
};

const CLASS_GROUP_LABELS: Record<string, string> = {
    A: 'ロールプレイ設定',
    B: '項目設定・プリセット',
    C: '各種設定',
    D: '画像生成設定',
};

type Tab = 'export' | 'import';

export const SettingsPackModal: React.FC<SettingsPackModalProps> = ({
    isOpen,
    onClose,
    backendUrl,
    uiCatalog,
}) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, FALLBACK_JA[key] || key);

    const [tab, setTab] = useState<Tab>('export');
    const [kinds, setKinds] = useState<SettingsPackKind[]>([]);
    const [error, setError] = useState<string | null>(null);

    // エクスポート状態
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [includeImages, setIncludeImages] = useState(false);
    const [packName, setPackName] = useState('');
    const [isExporting, setIsExporting] = useState(false);

    // インポート状態
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [file, setFile] = useState<File | null>(null);
    const [plan, setPlan] = useState<SettingsPackPlan | null>(null);
    const [isInspecting, setIsInspecting] = useState(false);
    const [policy, setPolicy] = useState<SettingsPackPolicy>('skip');
    // 衝突エントリごとの個別ポリシー（未指定は一括ポリシーに従う）
    const [overrides, setOverrides] = useState<Record<string, SettingsPackPolicy>>({});
    const [isImporting, setIsImporting] = useState(false);
    const [result, setResult] = useState<SettingsPackImportResult | null>(null);
    // D&D でのパックファイル受け付け
    const [isDragOver, setIsDragOver] = useState(false);

    // 起動時取り込み（import_inbox）の結果表示
    const [inboxReport, setInboxReport] = useState<SettingsPackInboxReport | null>(null);

    // 公式サンプルのダウンロード取り込み
    const [isDownloadingSamples, setIsDownloadingSamples] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setError(null);
        setResult(null);
        setPlan(null);
        setFile(null);
        fetchSettingsPackCatalog(backendUrl)
            .then((catalog) => {
                setKinds(catalog.kinds);
                setSelected(new Set(catalog.kinds.map(k => k.id)));
            })
            .catch((err) => {
                console.error('Failed to fetch settings pack catalog:', err);
                setKinds([]);
            });
        fetchSettingsPackInbox(backendUrl)
            .then((res) => setInboxReport(res.status === 'done' ? res.report ?? null : null))
            .catch(() => setInboxReport(null));
    }, [isOpen, backendUrl]);

    const grouped = useMemo(() => {
        const groups: Record<string, SettingsPackKind[]> = {};
        for (const kind of kinds) {
            (groups[kind.class] ||= []).push(kind);
        }
        return groups;
    }, [kinds]);

    const toggleKind = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const handleExport = async () => {
        if (selected.size === 0) {
            setError(t('settingsPack.error.noKinds'));
            return;
        }
        setError(null);
        setIsExporting(true);
        try {
            await exportSettingsPack(backendUrl, Array.from(selected), includeImages, packName);
        } catch (err) {
            console.error('Failed to export settings pack:', err);
            setError(t('settingsPack.error.exportFailed'));
        } finally {
            setIsExporting(false);
        }
    };

    // クリック選択・D&D 共通のパックファイル受け付け処理
    const processPickedFile = async (picked: File) => {
        setFile(picked);
        setPlan(null);
        setResult(null);
        setOverrides({});
        setError(null);
        setIsInspecting(true);
        try {
            const inspected = await inspectSettingsPack(backendUrl, picked);
            setPlan(inspected);
        } catch (err) {
            console.error('Failed to inspect settings pack:', err);
            setError(t('settingsPack.error.inspectFailed'));
            setFile(null);
        } finally {
            setIsInspecting(false);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const picked = e.target.files?.[0] ?? null;
        e.target.value = '';
        if (!picked) return;
        void processPickedFile(picked);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        if (isInspecting || isImporting) return;
        const dropped = e.dataTransfer.files?.[0];
        if (!dropped) return;
        void processPickedFile(dropped);
    };

    const handleImport = async () => {
        if (!file || !plan || plan.blocked) return;
        setError(null);
        setIsImporting(true);
        try {
            const imported = await importSettingsPack(backendUrl, file, policy, overrides);
            setResult(imported);
            setPlan(null);
            setFile(null);
            setOverrides({});
        } catch (err) {
            console.error('Failed to import settings pack:', err);
            setError(t('settingsPack.error.importFailed'));
        } finally {
            setIsImporting(false);
        }
    };

    // 公式サンプルパックのダウンロード取り込み。言語はサンプル提供言語（ja/en）へ寄せる。
    const handleDownloadSamples = async () => {
        setError(null);
        setResult(null);
        setIsDownloadingSamples(true);
        try {
            const lang = uiCatalog?.lang === 'en' ? 'en' : 'ja';
            const imported = await downloadSamplePack(backendUrl, lang);
            setResult(imported);
        } catch (err: any) {
            console.error('Failed to download sample pack:', err);
            const messageKey = err?.response?.data?.messageKey;
            setError(t(messageKey || 'settingsPack.samples.errorDownloadFailed'));
        } finally {
            setIsDownloadingSamples(false);
        }
    };

    if (!isOpen) return null;

    const summaryBadge = (label: string, count: number | undefined, color: string) => (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${color}`}>
            {label}: {count ?? 0}
        </span>
    );

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl border border-gray-700 overflow-hidden flex flex-col max-h-[85vh]">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 bg-gray-800">
                    <div className="flex items-center gap-2">
                        <Package size={20} className="text-emerald-400" />
                        <h3 className="font-semibold text-gray-100 text-lg">{t('settingsPack.title')}</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* タブ */}
                <div className="flex border-b border-gray-700 bg-gray-800/60">
                    {([['export', t('settingsPack.exportTab'), Download], ['import', t('settingsPack.importTab'), Upload]] as const).map(([key, label, Icon]) => (
                        <button
                            key={key}
                            onClick={() => { setTab(key); setError(null); }}
                            className={`flex items-center gap-2 px-5 py-2.5 text-sm transition-colors border-b-2 ${tab === key
                                ? 'border-emerald-500 text-emerald-300'
                                : 'border-transparent text-gray-400 hover:text-gray-200'}`}
                        >
                            <Icon size={15} />
                            {label}
                        </button>
                    ))}
                </div>

                <div className="p-5 overflow-y-auto custom-scrollbar space-y-4">
                    <p className="text-xs text-gray-500">{t('settingsPack.description')}</p>

                    {error && (
                        <p className="text-xs text-red-300 bg-red-950/30 border border-red-900/50 rounded px-3 py-2">
                            {error}
                        </p>
                    )}

                    {tab === 'export' ? (
                        <>
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-medium text-gray-400">{t('settingsPack.export.selectTitle')}</h4>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setSelected(new Set(kinds.map(k => k.id)))}
                                        className="text-xs text-emerald-400 hover:text-emerald-300"
                                    >
                                        {t('settingsPack.export.selectAll')}
                                    </button>
                                    <button
                                        onClick={() => setSelected(new Set())}
                                        className="text-xs text-gray-400 hover:text-gray-300"
                                    >
                                        {t('settingsPack.export.clearAll')}
                                    </button>
                                </div>
                            </div>
                            <div className="space-y-3">
                                {Object.entries(grouped).map(([cls, members]) => (
                                    <div key={cls} className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
                                        <div className="text-xs text-gray-500 mb-2">{CLASS_GROUP_LABELS[cls] || cls}</div>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                                            {members.map(kind => (
                                                <label key={kind.id} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-gray-100">
                                                    <input
                                                        type="checkbox"
                                                        checked={selected.has(kind.id)}
                                                        onChange={() => toggleKind(kind.id)}
                                                        className="accent-emerald-500"
                                                    />
                                                    <span className="truncate">{kind.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {selected.has('character') && (
                                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer px-1">
                                    <input
                                        type="checkbox"
                                        checked={includeImages}
                                        onChange={(e) => setIncludeImages(e.target.checked)}
                                        className="accent-emerald-500"
                                    />
                                    {t('settingsPack.export.includeImages')}
                                </label>
                            )}
                            <label className="block">
                                <span className="text-xs text-gray-500">{t('settingsPack.export.nameLabel')}</span>
                                <input
                                    type="text"
                                    value={packName}
                                    onChange={(e) => setPackName(e.target.value)}
                                    className="mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-emerald-500"
                                />
                            </label>
                            <button
                                onClick={handleExport}
                                disabled={isExporting}
                                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded-lg text-sm text-white transition-colors"
                            >
                                <Download size={16} />
                                {isExporting ? t('settingsPack.export.running') : t('settingsPack.export.download')}
                            </button>
                        </>
                    ) : (
                        <>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".zip,application/zip"
                                className="hidden"
                                onChange={handleFileChange}
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isInspecting || isImporting}
                                onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                                onDragLeave={() => setIsDragOver(false)}
                                onDrop={handleDrop}
                                className={`w-full flex items-center justify-center gap-2 px-4 py-3 border border-dashed rounded-lg text-sm transition-colors disabled:opacity-50 ${isDragOver
                                    ? 'border-emerald-400 bg-emerald-900/30 text-emerald-200'
                                    : 'bg-gray-800 hover:bg-gray-700 border-emerald-700 text-gray-300'}`}
                            >
                                <Upload size={16} className="text-emerald-400" />
                                {isInspecting ? t('settingsPack.import.inspecting') : t('settingsPack.import.selectFile')}
                            </button>

                            {plan && (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-sm font-medium text-gray-400">
                                            {t('settingsPack.import.planTitle')}
                                            {plan.manifest?.name ? `: ${plan.manifest.name}` : ''}
                                            {file ? `（${file.name}）` : ''}
                                        </h4>
                                        <div className="flex gap-1.5">
                                            {summaryBadge(t('settingsPack.summary.new'), plan.summary.new, 'bg-emerald-900/60 text-emerald-300')}
                                            {summaryBadge(t('settingsPack.summary.conflict'), plan.summary.conflict, 'bg-amber-900/60 text-amber-300')}
                                            {summaryBadge(t('settingsPack.summary.skip'), plan.summary.skip, 'bg-gray-700 text-gray-400')}
                                        </div>
                                    </div>

                                    {plan.blocked && (
                                        <p className="flex items-center gap-2 text-xs text-red-300 bg-red-950/30 border border-red-900/50 rounded px-3 py-2">
                                            <AlertTriangle size={14} />
                                            {t(plan.blockedKey || 'settingsPack.blocked.auth')}
                                        </p>
                                    )}

                                    {plan.warnings.length > 0 && (
                                        <div className="text-xs text-amber-300 bg-amber-950/20 border border-amber-900/40 rounded px-3 py-2 space-y-1">
                                            <div className="font-medium">{t('settingsPack.warningsTitle')}</div>
                                            {plan.warnings.map((w, i) => (
                                                <div key={i}>{t(w.key)}{w.path ? ` (${w.path})` : ''}</div>
                                            ))}
                                        </div>
                                    )}

                                    <div className="max-h-56 overflow-y-auto custom-scrollbar border border-gray-700 rounded-lg divide-y divide-gray-800">
                                        {plan.entries.map((entry, i) => (
                                            <div key={i} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                                                <span className="text-gray-300 truncate" title={entry.path}>{entry.path}</span>
                                                {entry.action === 'conflict' && !plan.blocked ? (
                                                    /* 衝突エントリはファイル単位でポリシーを上書きできる（未指定は一括に従う） */
                                                    <select
                                                        value={overrides[entry.path] ?? ''}
                                                        onChange={(e) => {
                                                            const v = e.target.value as SettingsPackPolicy | '';
                                                            setOverrides(prev => {
                                                                const next = { ...prev };
                                                                if (v === '') { delete next[entry.path]; } else { next[entry.path] = v; }
                                                                return next;
                                                            });
                                                        }}
                                                        className="shrink-0 bg-gray-800 border border-amber-700/60 rounded px-1.5 py-0.5 text-xs text-amber-300 outline-none focus:border-amber-500 cursor-pointer"
                                                    >
                                                        <option value="">{t('settingsPack.policy.followGlobal')}</option>
                                                        <option value="skip">{t('settingsPack.policy.skip')}</option>
                                                        <option value="overwrite">{t('settingsPack.policy.overwrite')}</option>
                                                        <option value="rename">{t('settingsPack.policy.rename')}</option>
                                                    </select>
                                                ) : (
                                                    <span className={
                                                        entry.action === 'new' ? 'shrink-0 text-emerald-400'
                                                            : entry.action === 'conflict' ? 'shrink-0 text-amber-400'
                                                                : 'shrink-0 text-gray-500'
                                                    }>
                                                        {entry.action === 'skip' && entry.reasonKey
                                                            ? t(entry.reasonKey)
                                                            : t(`settingsPack.summary.${entry.action}`)}
                                                    </span>
                                                )}
                                            </div>
                                        ))}
                                    </div>

                                    {!plan.blocked && (
                                        <>
                                            {(plan.summary.conflict ?? 0) > 0 && (
                                                <label className="block">
                                                    <span className="text-xs text-gray-500">{t('settingsPack.import.policyLabel')}</span>
                                                    <div className="relative mt-1">
                                                        <select
                                                            value={policy}
                                                            onChange={(e) => setPolicy(e.target.value as SettingsPackPolicy)}
                                                            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-emerald-500 appearance-none cursor-pointer pr-8"
                                                        >
                                                            <option value="skip">{t('settingsPack.policy.skip')}</option>
                                                            <option value="overwrite">{t('settingsPack.policy.overwrite')}</option>
                                                            <option value="rename">{t('settingsPack.policy.rename')}</option>
                                                        </select>
                                                        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                                                    </div>
                                                </label>
                                            )}
                                            <button
                                                onClick={handleImport}
                                                disabled={isImporting}
                                                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded-lg text-sm text-white transition-colors"
                                            >
                                                <Upload size={16} />
                                                {isImporting ? t('settingsPack.import.running') : t('settingsPack.import.apply')}
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* 公式サンプルのダウンロード取り込み */}
                            <div className="space-y-2 pt-2 border-t border-gray-800">
                                <h4 className="text-sm font-medium text-gray-400">{t('settingsPack.samples.title')}</h4>
                                <p className="text-xs text-gray-500">{t('settingsPack.samples.hint')}</p>
                                <button
                                    onClick={handleDownloadSamples}
                                    disabled={isDownloadingSamples || isImporting || isInspecting}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 border border-emerald-700 rounded-lg text-sm text-gray-300 transition-colors disabled:opacity-50"
                                >
                                    <Sparkles size={16} className="text-emerald-400" />
                                    {isDownloadingSamples ? t('settingsPack.samples.running') : t('settingsPack.samples.download')}
                                </button>
                            </div>

                            {/* 起動時取り込み（import_inbox）の結果 */}
                            <div className="space-y-2 pt-2 border-t border-gray-800">
                                <h4 className="text-sm font-medium text-gray-400">{t('settingsPack.inbox.title')}</h4>
                                <p className="text-xs text-gray-500">{t('settingsPack.inbox.hint')}</p>
                                {inboxReport && inboxReport.items.length > 0 ? (
                                    <div className="border border-gray-700 rounded-lg divide-y divide-gray-800">
                                        {inboxReport.items.map((item, i) => (
                                            <div key={i} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                                                <span className="text-gray-300 truncate" title={item.file}>{item.file}</span>
                                                <span className="shrink-0 text-gray-400">
                                                    {t(item.messageKey)}
                                                    {item.written + item.skipped > 0
                                                        ? `（${t('settingsPack.result.written')}: ${item.written} / ${t('settingsPack.result.skipped')}: ${item.skipped}）`
                                                        : ''}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-gray-600">{t('settingsPack.inbox.empty')}</p>
                                )}
                                {inboxReport && inboxReport.deferred > 0 && (
                                    <p className="text-xs text-amber-300">
                                        {t('settingsPack.inbox.deferred').split('{{count}}').join(String(inboxReport.deferred))}
                                    </p>
                                )}
                                {inboxReport?.errorKey && (
                                    <p className="text-xs text-red-300">{t(inboxReport.errorKey)}</p>
                                )}
                            </div>

                            {result && (
                                <div className="space-y-2">
                                    <h4 className="text-sm font-medium text-gray-400">{t('settingsPack.import.doneTitle')}</h4>
                                    <p className="text-xs text-emerald-300 bg-emerald-950/30 border border-emerald-900/50 rounded px-3 py-2">
                                        {t(result.messageKey)}
                                        {`（${t('settingsPack.result.written')}: ${result.written.length} / ${t('settingsPack.result.skipped')}: ${result.skipped.length}）`}
                                    </p>
                                    {result.written.length > 0 && (
                                        <div className="max-h-40 overflow-y-auto custom-scrollbar border border-gray-700 rounded-lg divide-y divide-gray-800">
                                            {result.written.map((entry, i) => (
                                                <div key={i} className="px-3 py-1.5 text-xs text-gray-300 truncate" title={entry.writtenAs || entry.path}>
                                                    {entry.writtenAs || entry.path}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* フッター */}
                <div className="flex justify-end px-5 py-3 border-t border-gray-700 bg-gray-800/50">
                    <button
                        onClick={onClose}
                        className="px-5 py-2 text-sm text-gray-300 hover:text-gray-100 hover:bg-gray-700 rounded-lg transition-colors"
                    >
                        {t('settingsPack.close')}
                    </button>
                </div>
            </div>
        </div>
    );
};
