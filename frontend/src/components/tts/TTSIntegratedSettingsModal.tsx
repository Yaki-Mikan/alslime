/**
 * TTSIntegratedSettingsModal.tsx - TTS（音声読み上げ）統合設定モーダル
 *
 * 画像生成統合設定（ComfyUIIntegratedSettingsModal）と同型の統合モーダル。
 * ConfigEditorHub の「TTS設定」タブから常時マウントで開かれる（headerTabs 差し込み）。
 * P0 時点は接続設定セクションのみ。読み上げ動作・ボイス管理・キャラクター割り当ては
 * 後続フェーズで追加する（設計 04_画面設計）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { AudioLines, ChevronDown, ChevronRight, Cpu, Download, Loader2, Mic, Play, Plug, Save, Search, Smile, Square, Trash2, Upload, Users, Wand2, X } from 'lucide-react';
import { deleteTTSVoice, encodeTTSLatent, fetchTTSHealth, fetchTTSRuntimeModels, fetchTTSRuntimeProfiles, fetchTTSVoices, getTTSCharacterConfig, getTTSConfig, getTTSServerCapabilities, previewTTS, restartTTSRuntime, saveTTSCharacterConfig, saveTTSConfig, setTTSRuntimeModel, setTTSRuntimeProfile, testTTSConnection, unloadTTSRuntimeModel, uploadTTSVoice } from '../../api/tts';
import type { TTSCharacterConfig, TTSConfig, TTSConnectionTestResult, TTSReadTarget, TTSResponseFormat, TTSRuntimeModel, TTSRuntimeProfilesResult, TTSRuntimeState, TTSServerCapabilitiesResult, TTSVoice } from '../../api/tts';
import { getCharacterTags } from '../../api/files';
import type { CharacterTagInfo } from '../../api/files';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { ConfirmDialog } from '../ConfirmDialog';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { GridSelectionModal } from '../common/GridSelectionModal';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    // ConfigEditorHub のタブ切り替え UI をヘッダーへ差し込む。
    headerTabs?: React.ReactNode;
    // 開いた時にキャラクター割り当てセクションで初期選択するキャラクター名（表示名または dirName）。
    initialSelectedCharacter?: string;
}

export const TTSIntegratedSettingsModal: React.FC<Props> = ({
    isOpen,
    onClose,
    backendUrl,
    uiCatalog = null,
    headerTabs,
    initialSelectedCharacter = '',
}) => {
    const t = (key: string, fallback: string) => resolveMessage(uiCatalog, key, fallback);

    const [config, setConfig] = useState<TTSConfig | null>(null);
    const [apiKeyInput, setApiKeyInput] = useState('');
    const [clearApiKey, setClearApiKey] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [notice, setNotice] = useState('');
    const [isConnectionOpen, setIsConnectionOpen] = useState(true);
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<TTSConnectionTestResult | null>(null);
    // エンジン管理セクション（P3#5: runtime系APIを持つサーバーのみ。要件8章）。
    const [isEngineOpen, setIsEngineOpen] = useState(false);
    // null=未確認 / false=接続先が runtime系API 非対応（404等）/ true=利用可能。
    const [engineSupported, setEngineSupported] = useState<boolean | null>(null);
    const [engineModels, setEngineModels] = useState<TTSRuntimeModel[]>([]);
    const [engineRuntime, setEngineRuntime] = useState<TTSRuntimeState>({});
    const [engineModelSel, setEngineModelSel] = useState('');
    const [engineProfiles, setEngineProfiles] = useState<TTSRuntimeProfilesResult | null>(null);
    const [engineProfileSel, setEngineProfileSel] = useState('');
    const [engineBusy, setEngineBusy] = useState(false);
    const [engineNotice, setEngineNotice] = useState('');
    const [isRestartConfirmOpen, setIsRestartConfirmOpen] = useState(false);
    // ボイス管理セクション（P2#1）。
    const [isVoicesOpen, setIsVoicesOpen] = useState(false);
    const [voices, setVoices] = useState<TTSVoice[]>([]);
    const [voicesLoading, setVoicesLoading] = useState(false);
    // 登録Voice一覧の開閉（既定は閉）と検索。数百件規模になりうるため、開いた時だけ
    // 描画し、検索で絞り込み、10件分程度の高さを上限にスクロールさせる。
    const [isVoiceListOpen, setIsVoiceListOpen] = useState(false);
    const [voiceSearch, setVoiceSearch] = useState('');
    const [voicesLoaded, setVoicesLoaded] = useState(false);
    // 読み上げテスト文。null は未編集（表示時にカタログの既定文へ解決する。べた書き回避）。
    const [previewText, setPreviewText] = useState<string | null>(null);
    const effectivePreviewText = previewText ?? t('tts.voicePanel.previewText', 'こんにちは。音声のテストです。');
    const [previewingId, setPreviewingId] = useState<string | null>(null);
    const [uploadVoiceId, setUploadVoiceId] = useState('');
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    // 接続先の Voice ファイル API 拡張能力（フォーク版判定。null=未判定）。
    const [serverCaps, setServerCaps] = useState<TTSServerCapabilitiesResult | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
    // 削除対象Voiceを使用中のキャラクター名一覧（null=確認中。要件5.1）。
    const [deleteUsedBy, setDeleteUsedBy] = useState<string[] | null>(null);
    const previewAudioRef = useRef<HTMLAudioElement | null>(null);
    // Latent生成エリア（P2#2）。
    const [latentVoiceId, setLatentVoiceId] = useState('');
    const [latentDisplayName, setLatentDisplayName] = useState('');
    const [latentAudioFile, setLatentAudioFile] = useState<File | null>(null);
    const [latentAudioDuration, setLatentAudioDuration] = useState<number | null>(null);
    const [latentStart, setLatentStart] = useState('0');
    const [latentEnd, setLatentEnd] = useState('');
    const [latentNormDb, setLatentNormDb] = useState('-16');
    const [latentDevice, setLatentDevice] = useState('cpu');
    const [latentPrecision, setLatentPrecision] = useState('fp32');
    const [latentBusy, setLatentBusy] = useState(false);
    // D&D で投下された既存 latent（.pt/.pth）。設定時は生成系ボタンを隠し保存/取り消しへ切り替える。
    const [droppedLatent, setDroppedLatent] = useState<File | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    // ナレーター設定セクション（設計04の2章）。
    const [isNarratorOpen, setIsNarratorOpen] = useState(false);
    // 文体指示（絵文字）セクション（要件9.8: トグルは統合設定とドロワーの両方へ配置）。
    const [isEmojiStyleOpen, setIsEmojiStyleOpen] = useState(false);
    // 右半分の読み上げテストエリア（設計04の2章）。
    const [testTarget, setTestTarget] = useState('');
    const [testBusy, setTestBusy] = useState(false);
    const [testElapsed, setTestElapsed] = useState(0);
    const [testAudioUrl, setTestAudioUrl] = useState<string | null>(null);
    const testAbortRef = useRef<AbortController | null>(null);
    const testTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // キャラクター割り当てセクション（P2#3。dirty管理＋明示保存）。
    const [isCharsOpen, setIsCharsOpen] = useState(false);
    const [ttsCharacters, setTtsCharacters] = useState<CharacterTagInfo[]>([]);
    const [selectedCharName, setSelectedCharName] = useState('');
    // キャラクター／Voice の検索付き選択モーダル（会話設定のキャラクター選択と同じ器）。
    const [isCharPickerOpen, setIsCharPickerOpen] = useState(false);
    const [isVoicePickerOpen, setIsVoicePickerOpen] = useState(false);
    const [charConfig, setCharConfig] = useState<TTSCharacterConfig | null>(null);
    const [charDirty, setCharDirty] = useState(false);
    const [charSaving, setCharSaving] = useState(false);
    const [charPreviewing, setCharPreviewing] = useState(false);
    const [isCfgOverrideOpen, setIsCfgOverrideOpen] = useState(false);

    // 開くたびに設定を読み直す（閉じている間の外部変更を拾う）。
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        (async () => {
            try {
                const cfg = await getTTSConfig(backendUrl);
                if (cancelled) return;
                setConfig(cfg);
                setApiKeyInput('');
                setClearApiKey(false);
                setIsDirty(false);
            } catch (error) {
                console.error('[TTSIntegratedSettingsModal] config load failed:', error);
            }
        })();
        // 接続先の Voice ファイル API 拡張能力（フォーク版判定）。
        // 判定できない間（checked=false）はガードせず、操作結果のエラーに任せる。
        (async () => {
            try {
                const caps = await getTTSServerCapabilities(backendUrl);
                if (!cancelled) setServerCaps(caps);
            } catch {
                if (!cancelled) setServerCaps(null);
            }
        })();
        // runtime系API（エンジン管理）の対応判定。応答があるサーバー（燈版）のみ
        // エンジン管理セクションを表示する（公式・未対応サーバーではセクション自体を出さない）。
        (async () => {
            try {
                await fetchTTSRuntimeProfiles(backendUrl);
                if (!cancelled) setEngineSupported(true);
            } catch {
                if (!cancelled) setEngineSupported(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, backendUrl]);

    const showNotice = (message: string) => {
        setNotice(message);
        setTimeout(() => setNotice(''), 2500);
    };

    // エンジン管理: 開いた時・再読込時にモデル一覧とプロファイルを取得する。
    // runtime系API を持たないサーバー（404等）は「未対応」として案内表示に切り替える。
    const loadEngineInfo = async () => {
        setEngineBusy(true);
        try {
            const [modelsRes, profilesRes] = await Promise.all([
                fetchTTSRuntimeModels(backendUrl),
                fetchTTSRuntimeProfiles(backendUrl),
            ]);
            setEngineSupported(true);
            setEngineModels(modelsRes.models);
            setEngineRuntime(modelsRes.runtime);
            setEngineModelSel(modelsRes.runtime.selected_checkpoint ?? modelsRes.models[0]?.checkpoint ?? '');
            setEngineProfiles(profilesRes);
            setEngineProfileSel(profilesRes.selectedProfile || profilesRes.profiles[0]?.id || '');
        } catch (error) {
            console.error('[TTSIntegratedSettingsModal] engine info load failed:', error);
            setEngineSupported(false);
        } finally {
            setEngineBusy(false);
        }
    };

    const toggleEngineSection = () => {
        setIsEngineOpen(prev => {
            const next = !prev;
            if (next && engineModels.length === 0) void loadEngineInfo();
            return next;
        });
    };

    const showEngineNotice = (message: string) => {
        setEngineNotice(message);
    };

    // モデル切替＋ロード（旧モデルの解放→選択モデルのロードはサーバー側が行う。要件8.2）。
    const handleEngineModelLoad = async () => {
        if (!engineModelSel || engineBusy) return;
        setEngineBusy(true);
        showEngineNotice(t('tts.engine.loading', 'モデルをロードしています...'));
        try {
            const runtime = await setTTSRuntimeModel(backendUrl, engineModelSel, true);
            setEngineRuntime(runtime);
            showEngineNotice(t('tts.engine.loadDone', 'モデルのロードが完了しました'));
        } catch (error) {
            console.error('[TTSIntegratedSettingsModal] model load failed:', error);
            showEngineNotice(t('tts.engine.actionFailed', '操作に失敗しました'));
        } finally {
            setEngineBusy(false);
        }
    };

    const handleEngineUnload = async () => {
        if (engineBusy) return;
        setEngineBusy(true);
        showEngineNotice(t('tts.engine.unloading', 'モデルをメモリから解放しています...'));
        try {
            const runtime = await unloadTTSRuntimeModel(backendUrl);
            setEngineRuntime(runtime);
            showEngineNotice(t('tts.engine.unloadDone', 'モデルを解放しました'));
        } catch (error) {
            console.error('[TTSIntegratedSettingsModal] model unload failed:', error);
            showEngineNotice(t('tts.engine.actionFailed', '操作に失敗しました'));
        } finally {
            setEngineBusy(false);
        }
    };

    const handleEngineProfileApply = async () => {
        if (!engineProfileSel || engineBusy) return;
        setEngineBusy(true);
        try {
            await setTTSRuntimeProfile(backendUrl, engineProfileSel);
            const profilesRes = await fetchTTSRuntimeProfiles(backendUrl);
            setEngineProfiles(profilesRes);
            showEngineNotice(profilesRes.restartRequired
                ? t('tts.engine.profileNeedsRestart', 'プロファイルを保存しました。反映にはサーバーの再起動が必要です。')
                : t('tts.engine.profileApplied', 'プロファイルを適用しました'));
        } catch (error) {
            console.error('[TTSIntegratedSettingsModal] profile apply failed:', error);
            showEngineNotice(t('tts.engine.actionFailed', '操作に失敗しました'));
        } finally {
            setEngineBusy(false);
        }
    };

    // サーバー再起動（要件12章: 確認操作あり）。復帰は /health の応答回復で検知する。
    const handleEngineRestart = async () => {
        setIsRestartConfirmOpen(false);
        setEngineBusy(true);
        showEngineNotice(t('tts.engine.restarting', 'サーバーを再起動しています...'));
        try {
            await restartTTSRuntime(backendUrl);
        } catch {
            // 再起動でプロセスが落ちると要求自体がエラーになることがあるため無視して復帰を待つ。
        }
        const deadline = Date.now() + 120000;
        let recovered = false;
        while (Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            try {
                const health = await fetchTTSHealth(backendUrl);
                if ((health as { status?: string }).status === 'ok') {
                    recovered = true;
                    break;
                }
            } catch {
                // 再起動中は接続エラーが正常。
            }
        }
        setEngineBusy(false);
        if (recovered) {
            showEngineNotice(t('tts.engine.restartDone', '再起動が完了しました'));
            void loadEngineInfo();
        } else {
            showEngineNotice(t('tts.engine.restartTimeout', '再起動の完了を確認できませんでした。接続確認をお試しください。'));
        }
    };

    // 公式サーバーの voice_id 制約（英数字・ハイフン・アンダースコアのみ）。
    // フォーク版（voice_api_capabilities あり）は日本語等も使える。
    const officialVoiceIdOk = (id: string) => /^[A-Za-z0-9_-]*$/.test(id.trim());
    // 判定済みで能力なしのときだけガードする（未判定＝接続不可時は操作結果のエラーに任せる）。
    const unicodeIdBlocked = (id: string) =>
        serverCaps?.checked === true && !serverCaps.capabilities.unicodeVoiceId && !officialVoiceIdOk(id);
    // Latent 系機能（Latent生成・Latent直接アップロード）は、Latent登録に対応した
    // AlSlime 対応フォーク版サーバーへ接続しているときのみ表示する。
    const latentFeaturesAvailable = serverCaps?.checked === true && serverCaps.capabilities.latentUpload;

    const updateConfig = <K extends keyof TTSConfig>(key: K, value: TTSConfig[K]) => {
        setConfig(prev => (prev ? { ...prev, [key]: value } : prev));
        setIsDirty(true);
    };

    const handleSave = async () => {
        if (!config || isSaving) return;
        setIsSaving(true);
        try {
            const { apiKeySet: _apiKeySet, ...rest } = config;
            const res = await saveTTSConfig(backendUrl, {
                ...rest,
                apiKey: clearApiKey ? '' : apiKeyInput,
                clearApiKey,
            });
            if (res.success) {
                const cfg = await getTTSConfig(backendUrl);
                setConfig(cfg);
                setApiKeyInput('');
                setClearApiKey(false);
                setIsDirty(false);
                showNotice(t('tts.settings.saved', '保存しました'));
            } else {
                showNotice(t('tts.settings.saveFailed', '保存に失敗しました'));
            }
        } catch (error) {
            console.error('[TTSIntegratedSettingsModal] config save failed:', error);
            showNotice(t('tts.settings.saveFailed', '保存に失敗しました'));
        } finally {
            setIsSaving(false);
        }
    };

    const handleConnectionTest = async () => {
        if (isTesting || !config) return;
        setIsTesting(true);
        setTestResult(null);
        try {
            // 保存済み設定ではなく、入力中の値で確認する。
            const result = await testTTSConnection(backendUrl, {
                connectionUrl: config.connectionUrl,
                connectTimeoutSeconds: config.connectTimeoutSeconds,
                apiKey: clearApiKey ? '' : apiKeyInput,
                clearApiKey,
            });
            setTestResult(result);
        } catch (error) {
            console.error('[TTSIntegratedSettingsModal] connection test failed:', error);
            setTestResult({
                success: false,
                message: t('tts.connection.requestFailed', '接続確認のリクエストに失敗しました'),
                checks: {},
            });
        } finally {
            setIsTesting(false);
        }
    };

    const loadVoices = async () => {
        setVoicesLoading(true);
        try {
            const list = await fetchTTSVoices(backendUrl);
            setVoices(list);
            setVoicesLoaded(true);
        } catch (error) {
            console.error('[TTSIntegratedSettingsModal] voices load failed:', error);
            showNotice(t('tts.voices.loadFailed', 'Voice一覧の取得に失敗しました'));
        } finally {
            setVoicesLoading(false);
        }
    };

    const stopPreview = () => {
        if (previewAudioRef.current) {
            previewAudioRef.current.pause();
            previewAudioRef.current = null;
        }
        setPreviewingId(null);
    };

    const handlePreview = async (voiceId: string) => {
        const wasPlaying = previewingId === voiceId;
        stopPreview();
        if (wasPlaying) return;
        setPreviewingId(voiceId);
        try {
            const blob = await previewTTS(backendUrl, { text: effectivePreviewText, voiceId });
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.onended = () => {
                URL.revokeObjectURL(url);
                setPreviewingId(current => (current === voiceId ? null : current));
            };
            previewAudioRef.current = audio;
            await audio.play();
        } catch (error) {
            console.error('[TTSIntegratedSettingsModal] preview failed:', error);
            setPreviewingId(null);
            showNotice(t('tts.voices.previewFailed', '試聴に失敗しました'));
        }
    };

    const handleUpload = async () => {
        if (!uploadVoiceId.trim() || !uploadFile || isUploading) return;
        setIsUploading(true);
        try {
            await uploadTTSVoice(backendUrl, uploadVoiceId.trim(), uploadFile);
            setUploadVoiceId('');
            setUploadFile(null);
            showNotice(t('tts.voices.uploaded', 'Voiceを登録しました'));
            await loadVoices();
        } catch (error) {
            console.error('[TTSIntegratedSettingsModal] voice upload failed:', error);
            showNotice(t('tts.voices.uploadFailed', 'Voiceの登録に失敗しました'));
        } finally {
            setIsUploading(false);
        }
    };

    // 削除確認を開き、対象Voiceを使用中のキャラクターを非同期で調べる（要件5.1）。
    const openDeleteConfirm = (voiceId: string) => {
        setDeleteTarget(voiceId);
        setDeleteUsedBy(null);
        void (async () => {
            try {
                let chars = ttsCharacters;
                if (chars.length === 0) {
                    chars = (await getCharacterTags()).characters;
                    setTtsCharacters(chars);
                }
                const configs = await Promise.all(chars.map(async c => {
                    try {
                        return await getTTSCharacterConfig(backendUrl, c.dirName);
                    } catch {
                        return null;
                    }
                }));
                setDeleteUsedBy(chars.filter((_c, i) => configs[i]?.voiceId === voiceId).map(c => c.name));
            } catch (error) {
                console.error('[TTSIntegratedSettingsModal] voice usage check failed:', error);
                setDeleteUsedBy([]);
            }
        })();
    };

    const handleDelete = async () => {
        const target = deleteTarget;
        setDeleteTarget(null);
        if (!target) return;
        try {
            await deleteTTSVoice(backendUrl, target);
            await loadVoices();
        } catch (error) {
            console.error('[TTSIntegratedSettingsModal] voice delete failed:', error);
            showNotice(t('tts.voices.deleteFailed', 'Voiceの削除に失敗しました'));
        }
    };

    const toggleVoicesSection = () => {
        setIsVoicesOpen(prev => {
            const next = !prev;
            if (next && !voicesLoaded && !voicesLoading) {
                void loadVoices();
            }
            return next;
        });
    };

    // 参照音声の選択。合計秒数表示のため duration を測る。
    const setLatentAudio = (file: File | null) => {
        setLatentAudioFile(file);
        setLatentAudioDuration(null);
        if (!file) return;
        const url = URL.createObjectURL(file);
        const audio = new Audio(url);
        audio.onloadedmetadata = () => {
            setLatentAudioDuration(Number.isFinite(audio.duration) ? audio.duration : null);
            URL.revokeObjectURL(url);
        };
        audio.onerror = () => URL.revokeObjectURL(url);
    };

    // 「使用する秒数」の実効合計（終了が空・総時間超えは末尾まで。要件5.2）。
    const latentRangeSeconds = (): number | null => {
        if (latentAudioDuration === null) return null;
        const start = Math.max(0, Number(latentStart) || 0);
        const endRaw = Number(latentEnd);
        const end = latentEnd.trim() !== '' && Number.isFinite(endRaw) && endRaw > 0
            ? Math.min(endRaw, latentAudioDuration)
            : latentAudioDuration;
        return Math.max(0, end - start);
    };

    const latentParams = () => ({
        voiceId: latentVoiceId.trim(),
        displayName: latentDisplayName.trim(),
        startSeconds: Math.max(0, Number(latentStart) || 0),
        endSeconds: latentEnd.trim() !== '' ? Math.max(0, Number(latentEnd) || 0) : 0,
        normalizeDb: latentNormDb.trim() !== '' ? Number(latentNormDb) : null,
        device: latentDevice,
        precision: latentPrecision,
    });

    // Latent生成（register=生成して登録 / download=生成してダウンロード）。
    const handleLatentGenerate = async (mode: 'register' | 'download') => {
        if (!latentAudioFile || latentBusy) return;
        setLatentBusy(true);
        try {
            const blob = await encodeTTSLatent(backendUrl, { ...latentParams(), file: latentAudioFile, mode });
            if (mode === 'download' && blob) {
                const name = latentDisplayName.trim() || latentVoiceId.trim() || 'latent';
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${name}.pt`;
                a.click();
                URL.revokeObjectURL(url);
                showNotice(t('tts.latent.downloaded', 'Latentをダウンロードしました'));
            } else {
                showNotice(t('tts.latent.registered', 'LatentをVoiceとして登録しました'));
                await loadVoices();
            }
        } catch (error) {
            console.error('[TTSIntegratedSettingsModal] latent encode failed:', error);
            showNotice(t('tts.latent.failed', 'Latent変換に失敗しました'));
        } finally {
            setLatentBusy(false);
        }
    };

    // D&D された既存 latent（.pt/.pth）の登録（保存）。
    const handleLatentRegisterExisting = async () => {
        if (!droppedLatent || latentBusy) return;
        setLatentBusy(true);
        try {
            await encodeTTSLatent(backendUrl, { ...latentParams(), file: droppedLatent, mode: 'register' });
            showNotice(t('tts.latent.registered', 'LatentをVoiceとして登録しました'));
            setDroppedLatent(null);
            await loadVoices();
        } catch (error) {
            console.error('[TTSIntegratedSettingsModal] latent register failed:', error);
            showNotice(t('tts.latent.failed', 'Latent変換に失敗しました'));
        } finally {
            setLatentBusy(false);
        }
    };

    // キャラ名→ディレクトリ名（設定の読み書きはディレクトリ名を使う。comfyui と同じ規約）。
    // 一覧に無い名前は版サフィックス（`_v3` 等）を剥がしてディレクトリ名とみなす（存在しないディレクトリを作らない）。
    const getCharDirName = (name: string) => ttsCharacters.find(c => c.name === name)?.dirName || name.replace(/_v\d+$/, '');

    // 指定キャラの初期選択は開くたびに一度だけ適用する（comfyui の統合設定と同じ規約）。
    const initialCharacterAppliedRef = useRef(false);
    useEffect(() => {
        if (!isOpen) {
            initialCharacterAppliedRef.current = false;
            return;
        }
        if (initialCharacterAppliedRef.current || !initialSelectedCharacter) return;
        if (ttsCharacters.length === 0) {
            // 一覧が無ければ取得だけ行い、反映後の再実行で適用する。
            void (async () => {
                try {
                    const result = await getCharacterTags();
                    setTtsCharacters(result.characters);
                } catch (error) {
                    console.error('[TTSIntegratedSettingsModal] character list load failed:', error);
                }
            })();
            return;
        }
        initialCharacterAppliedRef.current = true;
        setIsCharsOpen(true);
        if (!voicesLoaded && !voicesLoading) void loadVoices();
        const found = ttsCharacters.find(
            c => c.name === initialSelectedCharacter || c.dirName === initialSelectedCharacter
        );
        void handleCharSelect(found?.name || initialSelectedCharacter);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, initialSelectedCharacter, ttsCharacters]);

    const toggleCharsSection = () => {
        setIsCharsOpen(prev => {
            const next = !prev;
            if (next) {
                if (ttsCharacters.length === 0) {
                    void (async () => {
                        try {
                            const result = await getCharacterTags();
                            setTtsCharacters(result.characters);
                        } catch (error) {
                            console.error('[TTSIntegratedSettingsModal] character list load failed:', error);
                        }
                    })();
                }
                if (!voicesLoaded && !voicesLoading) void loadVoices();
            }
            return next;
        });
    };

    // キャラ選択の切り替え。未保存編集は破棄してロードし直す（明示保存方式）。
    const handleCharSelect = async (name: string) => {
        setSelectedCharName(name);
        setCharConfig(null);
        setCharDirty(false);
        if (!name) return;
        try {
            const cfg = await getTTSCharacterConfig(backendUrl, getCharDirName(name));
            setCharConfig(cfg);
        } catch (error) {
            console.error('[TTSIntegratedSettingsModal] character config load failed:', error);
            showNotice(t('tts.charAssign.loadFailed', 'キャラクター設定の読み込みに失敗しました'));
        }
    };

    const updateCharConfig = <K extends keyof TTSCharacterConfig>(key: K, value: TTSCharacterConfig[K]) => {
        setCharConfig(prev => (prev ? { ...prev, [key]: value } : prev));
        setCharDirty(true);
    };

    const handleCharSave = async () => {
        if (!selectedCharName || !charConfig || charSaving) return;
        setCharSaving(true);
        try {
            await saveTTSCharacterConfig(backendUrl, getCharDirName(selectedCharName), charConfig);
            setCharDirty(false);
            showNotice(t('tts.charAssign.saved', 'キャラクター設定を保存しました'));
        } catch (error) {
            console.error('[TTSIntegratedSettingsModal] character config save failed:', error);
            showNotice(t('tts.charAssign.saveFailed', 'キャラクター設定の保存に失敗しました'));
        } finally {
            setCharSaving(false);
        }
    };

    // キャラの声で試聴（サーバー側で Voice・キャプションを解決）。
    const handleCharPreview = async () => {
        if (!selectedCharName || charPreviewing) {
            stopPreview();
            setCharPreviewing(false);
            return;
        }
        stopPreview();
        setCharPreviewing(true);
        try {
            const blob = await previewTTS(backendUrl, { text: effectivePreviewText, characterName: getCharDirName(selectedCharName) });
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.onended = () => {
                URL.revokeObjectURL(url);
                setCharPreviewing(false);
            };
            previewAudioRef.current = audio;
            await audio.play();
        } catch (error) {
            console.error('[TTSIntegratedSettingsModal] character preview failed:', error);
            setCharPreviewing(false);
            showNotice(t('tts.voices.previewFailed', '試聴に失敗しました'));
        }
    };

    // グローバル設定の一部項目（ナレーター設定）は即時保存する（persistFormat 方式）。
    const persistConfigPatch = async (patch: Partial<TTSConfig>) => {
        if (!config) return;
        setConfig(prev => (prev ? { ...prev, ...patch } : prev));
        try {
            const { apiKeySet: _apiKeySet, ...rest } = config;
            await saveTTSConfig(backendUrl, { ...rest, ...patch, apiKey: '', clearApiKey: false });
        } catch (error) {
            console.error('[TTSIntegratedSettingsModal] config patch save failed:', error);
        }
    };

    const toggleNarratorSection = () => {
        setIsNarratorOpen(prev => {
            const next = !prev;
            if (next && !voicesLoaded && !voicesLoading) void loadVoices();
            return next;
        });
    };

    // 読み上げテスト（右エリア）。実行中の再押下はリクエスト中断でキャンセル。
    const handleTestSynthesize = async () => {
        if (testBusy) {
            testAbortRef.current?.abort();
            return;
        }
        if (!effectivePreviewText.trim() || !testTarget) return;
        stopPreview();
        setTestBusy(true);
        setTestElapsed(0);
        const startedAt = Date.now();
        testTimerRef.current = setInterval(() => {
            setTestElapsed((Date.now() - startedAt) / 1000);
        }, 100);
        const ctrl = new AbortController();
        testAbortRef.current = ctrl;
        try {
            const body = testTarget === 'character'
                ? { text: effectivePreviewText, characterName: getCharDirName(selectedCharName) }
                : { text: effectivePreviewText, voiceId: testTarget };
            const blob = await previewTTS(backendUrl, body, ctrl.signal);
            if (testAudioUrl) URL.revokeObjectURL(testAudioUrl);
            const url = URL.createObjectURL(blob);
            setTestAudioUrl(url);
            const audio = new Audio(url);
            previewAudioRef.current = audio;
            await audio.play();
        } catch (error) {
            if (!ctrl.signal.aborted) {
                console.error('[TTSIntegratedSettingsModal] test synthesize failed:', error);
                showNotice(t('tts.voices.previewFailed', '試聴に失敗しました'));
            }
        } finally {
            if (testTimerRef.current !== null) {
                clearInterval(testTimerRef.current);
                testTimerRef.current = null;
            }
            setTestBusy(false);
        }
    };

    // 生成済みテスト音声の再再生。
    const handleTestReplay = () => {
        if (!testAudioUrl) return;
        stopPreview();
        const audio = new Audio(testAudioUrl);
        previewAudioRef.current = audio;
        void audio.play();
    };

    // D&D エリア。音声（wav）と latent（.pt/.pth）の両対応（設計04の2章）。
    const handleLatentDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (!file) return;
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.pt') || lower.endsWith('.pth')) {
            setDroppedLatent(file);
        } else if (lower.endsWith('.wav')) {
            setLatentAudio(file);
        } else {
            showNotice(t('tts.latent.dropUnsupported', 'wav または .pt / .pth のファイルを投下してください'));
        }
    };

    if (!isOpen) return null;

    // 接続テスト結果からサーバー情報の要点を取り出す（health 応答は Irodori-TTS の生 JSON）。
    const health = (testResult?.health ?? null) as { model?: { id?: string }; runtime?: { loaded?: boolean; loading?: boolean }; voices?: { files?: number } } | null;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div
                className="bg-gray-900 rounded-xl shadow-2xl border border-gray-700 overflow-hidden flex flex-col"
                style={{ width: '90vw', height: '90vh' }}
            >
                {/* ヘッダー */}
                <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-700 bg-gray-800 shrink-0">
                    <AudioLines size={20} className="text-orange-400" />
                    <h2 className="text-lg font-semibold text-gray-100">
                        {t('tts.settings.title', 'TTS統合設定')}
                    </h2>
                    {headerTabs}
                    {notice && <span className="text-xs text-orange-300">{notice}</span>}
                    {isDirty && <span className="ml-auto text-xs text-yellow-400">{t('tts.settings.unsaved', '未保存')}</span>}
                    <button
                        onClick={onClose}
                        className={`p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors ${isDirty ? '' : 'ml-auto'}`}
                        title={t('common.close', '閉じる')}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* メイン: 設定セクション縦積み（読み上げテストエリアが入るフェーズで左右分割へ拡張する） */}
                <div className="flex flex-1 overflow-hidden">
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
                        {/* 接続設定セクション */}
                        <div className="border border-orange-600/40 rounded-lg overflow-hidden">
                            <button
                                onClick={() => setIsConnectionOpen(prev => !prev)}
                                className="w-full flex items-center gap-2 px-4 py-3 bg-gray-800/80 hover:bg-gray-800 text-sm font-medium text-orange-300 transition-colors"
                            >
                                {isConnectionOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                <Plug size={16} className="text-orange-400" />
                                {t('tts.settings.connectionSection', '接続設定')}
                            </button>
                            {isConnectionOpen && config && (
                                <div className="p-4 space-y-4">
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">
                                            {t('tts.settings.connectionUrl', 'エンドポイントURL')}
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="text"
                                                value={config.connectionUrl}
                                                onChange={e => updateConfig('connectionUrl', e.target.value)}
                                                placeholder="http://127.0.0.1:8088"
                                                className="flex-1 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 outline-none focus:border-orange-500"
                                            />
                                            <button
                                                onClick={handleConnectionTest}
                                                disabled={isTesting}
                                                className="shrink-0 px-4 py-2 text-sm bg-orange-700 hover:bg-orange-600 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {isTesting ? t('tts.connection.testing', '確認中...') : t('tts.connection.test', '接続を確認')}
                                            </button>
                                        </div>
                                        <p className="mt-1 text-[11px] text-gray-500">
                                            {t('tts.settings.connectionUrlHint', 'Irodori-TTS-Server の接続先。別PC上のサーバーも指定できます。')}
                                        </p>
                                        {testResult && (
                                            <div className="mt-2 space-y-2 text-sm border border-gray-700/60 rounded p-3">
                                                <div className={testResult.success ? 'text-emerald-300' : 'text-red-300'}>
                                                    {testResult.success
                                                        ? t('tts.connection.ok', '接続できました')
                                                        : t('tts.connection.failed', '接続できませんでした')}
                                                </div>
                                                <div className="text-xs text-gray-400 space-y-1">
                                                    {(['health', 'models', 'voices'] as const).map(key => (
                                                        <div key={key} className="flex items-center gap-2">
                                                            <span className={testResult.checks[key] ? 'text-emerald-400' : 'text-red-400'}>
                                                                {testResult.checks[key] ? '✓' : '✗'}
                                                            </span>
                                                            <span>
                                                                {key === 'health' && t('tts.connection.checkHealth', 'サーバー応答')}
                                                                {key === 'models' && t('tts.connection.checkModels', 'モデル一覧')}
                                                                {key === 'voices' && t('tts.connection.checkVoices', 'Voice一覧')}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                                {health && (
                                                    <div className="text-xs text-gray-400 border-t border-gray-700 pt-2 space-y-0.5">
                                                        {health.model?.id && (
                                                            <div>{t('tts.connection.modelId', 'モデル')}: {health.model.id}</div>
                                                        )}
                                                        <div>
                                                            {t('tts.connection.modelState', 'モデル状態')}: {health.runtime?.loading
                                                                ? t('tts.connection.stateLoading', 'ロード中')
                                                                : health.runtime?.loaded
                                                                    ? t('tts.connection.stateLoaded', 'ロード済み')
                                                                    : t('tts.connection.stateUnloaded', '未ロード')}
                                                        </div>
                                                        {typeof health.voices?.files === 'number' && (
                                                            <div>{t('tts.connection.voiceCount', '登録Voice数')}: {health.voices.files}</div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">
                                            {t('tts.settings.apiKey', 'APIキー（リモート接続時のみ）')}
                                        </label>
                                        <input
                                            type="password"
                                            value={apiKeyInput}
                                            onChange={e => {
                                                setApiKeyInput(e.target.value);
                                                setClearApiKey(false);
                                                setIsDirty(true);
                                            }}
                                            placeholder={config.apiKeySet
                                                ? t('tts.settings.apiKeySetPlaceholder', '設定済み（変更する場合のみ入力）')
                                                : t('tts.settings.apiKeyUnsetPlaceholder', '未設定')}
                                            className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 outline-none focus:border-orange-500"
                                        />
                                        {config.apiKeySet && (
                                            <label className="mt-1.5 flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
                                                <input
                                                    type="checkbox"
                                                    checked={clearApiKey}
                                                    onChange={e => {
                                                        setClearApiKey(e.target.checked);
                                                        if (e.target.checked) setApiKeyInput('');
                                                        setIsDirty(true);
                                                    }}
                                                    className="accent-orange-500"
                                                />
                                                <span>{t('tts.settings.clearApiKey', 'APIキーを削除（チェックを入れて保存ボタンを押すと削除されます）')}</span>
                                            </label>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">
                                            {t('tts.settings.connectTimeout', '接続タイムアウト（秒）')}
                                        </label>
                                        <input
                                            type="number"
                                            min={1}
                                            max={60}
                                            value={config.connectTimeoutSeconds}
                                            onChange={e => updateConfig('connectTimeoutSeconds', Number(e.target.value))}
                                            className="w-24 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 outline-none focus:border-orange-500"
                                        />
                                    </div>
                                    <div className="flex justify-end pt-1">
                                        <button
                                            onClick={handleSave}
                                            disabled={!isDirty || isSaving}
                                            className="px-4 py-2 text-sm bg-orange-700 hover:bg-orange-600 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isSaving ? t('tts.settings.saving', '保存中...') : t('tts.settings.save', '保存')}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* エンジン管理セクション（P3#5: モデル選択・ロード／オフロード・プロファイル・再起動。要件8章）。
                            runtime系API 対応サーバー（燈版）と判定できたときだけセクションごと表示する。 */}
                        {engineSupported === true && (
                        <div className="border border-orange-600/40 rounded-lg overflow-hidden">
                            <button
                                onClick={toggleEngineSection}
                                className="w-full flex items-center gap-2 px-4 py-3 bg-gray-800/80 hover:bg-gray-800 text-sm font-medium text-orange-300 transition-colors"
                            >
                                {isEngineOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                <Cpu size={16} className="text-orange-400" />
                                {t('tts.engine.section', 'エンジン管理')}
                            </button>
                            {isEngineOpen && (
                                <div className="p-4 space-y-3">
                                    {engineBusy && engineModels.length === 0 && (
                                        <div className="flex items-center gap-2 text-xs text-gray-400">
                                            <Loader2 size={14} className="animate-spin" />
                                            {t('tts.drawer.loading', '設定を読み込み中...')}
                                        </div>
                                    )}
                                    {engineModels.length > 0 && (
                                        <>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <label className="text-xs text-gray-400">
                                                    {t('tts.engine.model', 'モデル')}
                                                </label>
                                                <select
                                                    value={engineModelSel}
                                                    onChange={e => setEngineModelSel(e.target.value)}
                                                    className="min-w-0 max-w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 outline-none focus:border-orange-500"
                                                >
                                                    {engineModels.map(model => (
                                                        <option key={model.checkpoint} value={model.checkpoint}>{model.name}</option>
                                                    ))}
                                                </select>
                                                <button
                                                    onClick={() => void loadEngineInfo()}
                                                    disabled={engineBusy}
                                                    className="px-2 py-1 text-xs border border-gray-600 rounded text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-50"
                                                >
                                                    {t('tts.voices.reload', '再読込')}
                                                </button>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <button
                                                    onClick={() => void handleEngineModelLoad()}
                                                    disabled={engineBusy || !engineModelSel}
                                                    className="flex items-center gap-1.5 px-3 py-2 text-sm bg-orange-700 hover:bg-orange-600 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {engineBusy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                                                    {t('tts.engine.load', '選択モデルをロード')}
                                                </button>
                                                <button
                                                    onClick={() => void handleEngineUnload()}
                                                    disabled={engineBusy}
                                                    className="px-3 py-2 text-sm border border-orange-600/60 text-orange-300 hover:bg-orange-900/30 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {t('tts.engine.unload', 'オフロード')}
                                                </button>
                                                <span className="text-[11px] text-gray-400">
                                                    {engineRuntime.loading
                                                        ? t('tts.connection.stateLoading', 'ロード中')
                                                        : engineRuntime.loaded
                                                            ? t('tts.connection.stateLoaded', 'ロード済み')
                                                            : t('tts.connection.stateUnloaded', '未ロード')}
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2 border-t border-gray-700/60 pt-3">
                                                <label className="text-xs text-gray-400">
                                                    {t('tts.engine.profile', '動作モード')}
                                                </label>
                                                <select
                                                    value={engineProfileSel}
                                                    onChange={e => setEngineProfileSel(e.target.value)}
                                                    className="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 outline-none focus:border-orange-500"
                                                >
                                                    {(engineProfiles?.profiles ?? []).map(profile => (
                                                        <option key={profile.id} value={profile.id}>{profile.label}</option>
                                                    ))}
                                                </select>
                                                <button
                                                    onClick={() => void handleEngineProfileApply()}
                                                    disabled={engineBusy || !engineProfileSel}
                                                    className="px-3 py-2 text-sm bg-orange-700 hover:bg-orange-600 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {t('tts.engine.applyProfile', '適用')}
                                                </button>
                                                {engineProfiles && (
                                                    <span className="text-[11px] text-gray-400">
                                                        {t('tts.engine.activeProfile', '稼働中')}: {engineProfiles.activeProfile || t('tts.charAssign.voiceNone', '（未設定）')}
                                                    </span>
                                                )}
                                            </div>
                                            {engineProfiles?.restartRequired && (
                                                <p className="text-[11px] text-amber-400">
                                                    {t('tts.engine.restartRequired', '設定の反映にはサーバーの再起動が必要です。')}
                                                </p>
                                            )}
                                            <div className="border-t border-gray-700/60 pt-3">
                                                <button
                                                    onClick={() => setIsRestartConfirmOpen(true)}
                                                    disabled={engineBusy}
                                                    className="px-3 py-2 text-sm border border-red-600/60 text-red-300 hover:bg-red-900/30 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {t('tts.engine.restart', 'サーバーを再起動')}
                                                </button>
                                            </div>
                                        </>
                                    )}
                                    {engineNotice && (
                                        <p className="text-[11px] text-orange-300">{engineNotice}</p>
                                    )}
                                </div>
                            )}
                        </div>
                        )}

                        {/* ボイス管理セクション（P2#1: 一覧・試聴・削除・アップロード） */}
                        <div className="border border-orange-600/40 rounded-lg overflow-hidden">
                            <button
                                onClick={toggleVoicesSection}
                                className="w-full flex items-center gap-2 px-4 py-3 bg-gray-800/80 hover:bg-gray-800 text-sm font-medium text-orange-300 transition-colors"
                            >
                                {isVoicesOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                <Mic size={16} className="text-orange-400" />
                                {t('tts.voices.section', 'ボイス登録・管理')}
                            </button>
                            {isVoicesOpen && (
                                <div className="p-4 space-y-4">
                                    <div className="space-y-1.5">
                                        {/* 見出し行＝開閉ボタン（既定は閉。数百件規模でも開くまで一覧を描画しない） */}
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => setIsVoiceListOpen(prev => !prev)}
                                                className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white transition-colors"
                                            >
                                                {isVoiceListOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                <span>{t('tts.voices.list', '登録Voice一覧')}</span>
                                                {voicesLoaded && (
                                                    <span className="text-gray-500">({voices.length})</span>
                                                )}
                                            </button>
                                            <button
                                                onClick={() => void loadVoices()}
                                                disabled={voicesLoading}
                                                className="ml-auto px-2 py-1 text-xs border border-gray-600 rounded text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-50"
                                            >
                                                {t('tts.voices.reload', '再読込')}
                                            </button>
                                        </div>
                                        {isVoiceListOpen && (() => {
                                            const query = voiceSearch.trim().toLowerCase();
                                            const filtered = query
                                                ? voices.filter(voice => voice.id.toLowerCase().includes(query))
                                                : voices;
                                            return (
                                                <>
                                                    {/* 検索欄（Voice ID の部分一致・大文字小文字は区別しない） */}
                                                    <input
                                                        type="text"
                                                        value={voiceSearch}
                                                        onChange={e => setVoiceSearch(e.target.value)}
                                                        placeholder={t('tts.voices.searchPlaceholder', 'Voice IDで検索')}
                                                        className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-1.5 outline-none focus:border-orange-500"
                                                    />
                                                    {voicesLoading ? (
                                                        <div className="flex items-center gap-2 text-xs text-gray-400 px-1 py-2">
                                                            <Loader2 size={14} className="animate-spin" />
                                                            {t('tts.voices.loading', '読込中...')}
                                                        </div>
                                                    ) : voices.length === 0 ? (
                                                        <p className="text-xs text-gray-500 px-1 py-2">
                                                            {t('tts.voices.empty', '登録Voiceがありません。Irodori-TTSへの接続と登録状況を確認してください。')}
                                                        </p>
                                                    ) : filtered.length === 0 ? (
                                                        <p className="text-xs text-gray-500 px-1 py-2">
                                                            {t('tts.voices.searchNoMatch', '検索に一致するVoiceがありません')}
                                                        </p>
                                                    ) : (
                                                        <>
                                                            {query && (
                                                                <p className="text-[11px] text-gray-500 px-1">
                                                                    {filtered.length} / {voices.length}
                                                                </p>
                                                            )}
                                                            {/* 10件分程度（1行約38px＋間隔）を上限に、超えた分は縦スクロール */}
                                                            <div className="max-h-[27.5rem] overflow-y-auto custom-scrollbar space-y-1.5 pr-1">
                                                                {filtered.map(voice => (
                                                                    <div key={voice.id} className="flex items-center gap-2 px-3 py-2 bg-gray-800/60 border border-gray-700 rounded">
                                                                        <span className="text-sm text-gray-200 truncate">{voice.id}</span>
                                                                        <button
                                                                            onClick={() => void handlePreview(voice.id)}
                                                                            className="ml-auto shrink-0 flex items-center gap-1.5 px-2.5 py-1 text-xs text-orange-300 hover:text-white bg-orange-900/20 hover:bg-orange-800/50 border border-orange-600/40 rounded transition-colors"
                                                                            title={previewingId === voice.id ? t('tts.button.stop', '停止') : t('tts.voices.preview', '試聴')}
                                                                        >
                                                                            {previewingId === voice.id ? <Square size={13} /> : <Play size={13} />}
                                                                            <span>{previewingId === voice.id ? t('tts.button.stop', '停止') : t('tts.voices.preview', '試聴')}</span>
                                                                        </button>
                                                                        <button
                                                                            onClick={() => openDeleteConfirm(voice.id)}
                                                                            className="shrink-0 p-1.5 text-gray-500 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors"
                                                                            title={t('tts.voices.delete', '削除')}
                                                                        >
                                                                            <Trash2 size={13} />
                                                                        </button>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </div>
                                    {/* Latent生成エリア（P2#2: 要件5.2・設計04の2章。
                                        Latent登録対応（AlSlime対応フォーク版）サーバー接続時のみ表示する） */}
                                    {latentFeaturesAvailable && (
                                    <div className="border-t border-gray-700/60 pt-3 space-y-2">
                                        <label className="block text-xs text-gray-400">
                                            {t('tts.latent.section', 'Latent生成')}
                                        </label>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <input
                                                type="text"
                                                value={latentVoiceId}
                                                onChange={e => setLatentVoiceId(e.target.value)}
                                                placeholder={t('tts.voices.uploadIdPlaceholder', 'Voice ID（半角英数）')}
                                                className="w-44 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 outline-none focus:border-orange-500"
                                            />
                                            <input
                                                type="text"
                                                value={latentDisplayName}
                                                onChange={e => setLatentDisplayName(e.target.value)}
                                                placeholder={t('tts.latent.displayNamePlaceholder', '表示名')}
                                                className="w-44 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 outline-none focus:border-orange-500"
                                            />
                                            <label className="cursor-pointer max-w-[220px] truncate px-3 py-2 text-sm border border-orange-600/60 text-orange-300 hover:bg-orange-900/30 rounded transition-colors">
                                                {latentAudioFile ? latentAudioFile.name : t('tts.voices.chooseFile', 'ファイルを選択')}
                                                <input
                                                    type="file"
                                                    accept=".wav,audio/wav"
                                                    onChange={e => setLatentAudio(e.target.files?.[0] ?? null)}
                                                    className="hidden"
                                                />
                                            </label>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                                            <span>{t('tts.latent.rangeStart', '開始秒')}</span>
                                            <input
                                                type="number"
                                                min={0}
                                                step={0.1}
                                                value={latentStart}
                                                onChange={e => setLatentStart(e.target.value)}
                                                className="w-20 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 outline-none focus:border-orange-500"
                                            />
                                            <span>{t('tts.latent.rangeEnd', '終了秒（空欄で末尾まで）')}</span>
                                            <input
                                                type="number"
                                                min={0}
                                                step={0.1}
                                                value={latentEnd}
                                                onChange={e => setLatentEnd(e.target.value)}
                                                className="w-20 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 outline-none focus:border-orange-500"
                                            />
                                            {latentRangeSeconds() !== null && (
                                                <span className="text-orange-300">
                                                    {t('tts.latent.rangeTotal', '合計')}: {latentRangeSeconds()!.toFixed(1)}{t('tts.latent.seconds', '秒')}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                                            <span>{t('tts.latent.device', '変換デバイス')}</span>
                                            <select
                                                value={latentDevice}
                                                onChange={e => setLatentDevice(e.target.value)}
                                                className="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 outline-none focus:border-orange-500"
                                            >
                                                <option value="cpu">CPU</option>
                                            </select>
                                            <span>{t('tts.latent.precision', '変換精度')}</span>
                                            <select
                                                value={latentPrecision}
                                                onChange={e => setLatentPrecision(e.target.value)}
                                                className="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 outline-none focus:border-orange-500"
                                            >
                                                <option value="fp32">fp32</option>
                                            </select>
                                            <span>{t('tts.latent.normalizeDb', '音量正規化dB（空欄で無効）')}</span>
                                            <input
                                                type="number"
                                                step={0.5}
                                                value={latentNormDb}
                                                onChange={e => setLatentNormDb(e.target.value)}
                                                className="w-20 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 outline-none focus:border-orange-500"
                                            />
                                        </div>
                                        {droppedLatent === null ? (
                                            <div className="flex flex-wrap items-center gap-2">
                                                <button
                                                    onClick={() => void handleLatentGenerate('register')}
                                                    disabled={!latentVoiceId.trim() || !latentAudioFile || latentBusy}
                                                    className="flex items-center gap-1.5 px-3 py-2 text-sm bg-orange-700 hover:bg-orange-600 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {latentBusy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                                                    {t('tts.latent.generateRegister', 'Latentを生成して登録')}
                                                </button>
                                                <button
                                                    onClick={() => void handleLatentGenerate('download')}
                                                    disabled={!latentAudioFile || latentBusy}
                                                    className="flex items-center gap-1.5 px-3 py-2 text-sm border border-orange-600/60 text-orange-300 hover:bg-orange-900/30 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    <Download size={14} />
                                                    {t('tts.latent.generateDownload', 'Latentを生成してダウンロード')}
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-xs text-orange-300">{droppedLatent.name}</span>
                                                <button
                                                    onClick={() => void handleLatentRegisterExisting()}
                                                    disabled={!latentVoiceId.trim() || latentBusy}
                                                    className="flex items-center gap-1.5 px-3 py-2 text-sm bg-orange-700 hover:bg-orange-600 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {latentBusy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                                                    {t('tts.latent.registerExisting', 'このLatentをVoice登録')}
                                                </button>
                                                <button
                                                    onClick={() => setDroppedLatent(null)}
                                                    disabled={latentBusy}
                                                    className="px-3 py-2 text-sm border border-gray-600 text-gray-300 hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
                                                >
                                                    {t('common.cancel', '取り消し')}
                                                </button>
                                            </div>
                                        )}
                                        <div
                                            onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                                            onDragLeave={() => setIsDragOver(false)}
                                            onDrop={handleLatentDrop}
                                            className={`flex items-center justify-center h-16 border-2 border-dashed rounded text-xs transition-colors ${
                                                isDragOver
                                                    ? 'border-orange-400 bg-orange-900/20 text-orange-200'
                                                    : 'border-gray-600 text-gray-500'
                                            }`}
                                        >
                                            {t('tts.latent.dropHint', 'ここに参照音声（wav）またはLatent（.pt / .pth）をドラッグ&ドロップ')}
                                        </div>
                                        <p className="text-[11px] text-gray-500">
                                            {t('tts.latent.hint', 'Latent変換の入力はwav形式のみ対応。生成済みLatent（.pt / .pth）はそのまま登録できます。')}
                                        </p>
                                    </div>
                                    )}

                                    {/* アップロード（フォーク版接続時はLatentも直接アップロード可能。位置はLatent生成の下） */}
                                    <div className="border-t border-gray-700/60 pt-3 space-y-2">
                                        <label className="block text-xs text-gray-400">
                                            {latentFeaturesAvailable
                                                ? t('tts.voices.uploadDirect', '参照音声・Latentの直接アップロード')
                                                : t('tts.voices.upload', '参照音声のアップロード')}
                                        </label>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <input
                                                type="text"
                                                value={uploadVoiceId}
                                                onChange={e => setUploadVoiceId(e.target.value)}
                                                placeholder={t('tts.voices.uploadIdPlaceholder', 'Voice ID（半角英数）')}
                                                className="w-44 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 outline-none focus:border-orange-500"
                                            />
                                            <label className="cursor-pointer max-w-[220px] truncate px-3 py-2 text-sm border border-orange-600/60 text-orange-300 hover:bg-orange-900/30 rounded transition-colors">
                                                {uploadFile ? uploadFile.name : t('tts.voices.chooseFile', 'ファイルを選択')}
                                                <input
                                                    type="file"
                                                    accept={latentFeaturesAvailable
                                                        ? '.wav,.flac,.mp3,.m4a,.ogg,.opus,.aac,.webm,.pt,.pth,audio/*'
                                                        : '.wav,.flac,.mp3,.m4a,.ogg,.opus,.aac,.webm,audio/*'}
                                                    onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
                                                    className="hidden"
                                                />
                                            </label>
                                            <button
                                                onClick={() => void handleUpload()}
                                                disabled={!uploadVoiceId.trim() || !uploadFile || isUploading || unicodeIdBlocked(uploadVoiceId)}
                                                className="px-4 py-2 text-sm bg-orange-700 hover:bg-orange-600 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {isUploading ? t('tts.voices.uploading', '登録中...') : t('tts.voices.register', '登録')}
                                            </button>
                                        </div>
                                        {unicodeIdBlocked(uploadVoiceId) && (
                                            <p className="text-[11px] text-amber-400">
                                                {t('tts.voices.serverAsciiIdOnly', '接続中のサーバーのVoice IDは英数字・ハイフン・アンダースコアのみ対応です。日本語のVoice IDにはAlSlime対応フォーク版のIrodori-TTS-Serverが必要です。')}
                                            </p>
                                        )}
                                        <p className="text-[11px] text-gray-500">
                                            {latentFeaturesAvailable
                                                ? t('tts.voices.uploadHintDirect', '対応形式: wav / flac / mp3 / m4a / ogg / opus / aac / webm / pt / pth。参照音声はv4-Smallで合計120秒まで。')
                                                : t('tts.voices.uploadHint', '対応形式: wav / flac / mp3 / m4a / ogg / opus / aac / webm。参照音声はv4-Smallで合計120秒まで。')}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* キャラクター割り当てセクション（P2#3: 要件6章・設計04の2章。pink=キャラ系の既存色） */}
                        <div className="border border-pink-600/40 rounded-lg overflow-hidden">
                            <button
                                onClick={toggleCharsSection}
                                className="w-full flex items-center gap-2 px-4 py-3 bg-gray-800/80 hover:bg-gray-800 text-sm font-medium text-pink-300 transition-colors"
                            >
                                {isCharsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                <Users size={16} className="text-pink-400" />
                                {t('tts.charAssign.section', 'キャラクター割り当て')}
                            </button>
                            {isCharsOpen && (
                                <div className="p-4">
                                    {/* キャラクター選択と編集項目は同じ枠内に置く（設計04の2章） */}
                                    <div className="space-y-3 border border-gray-700/60 rounded p-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <label className="text-xs text-gray-400">
                                                {t('tts.charAssign.character', 'キャラクター')}
                                            </label>
                                            {/* 検索付き選択モーダルで選ぶ（数が多くても探せる。選択中はモーダル上でも選択状態で表示） */}
                                            <button
                                                onClick={() => setIsCharPickerOpen(true)}
                                                className="flex items-center gap-2 min-w-[12rem] max-w-full bg-gray-800 border border-gray-700 hover:border-pink-500 text-sm rounded px-3 py-1.5 transition-colors"
                                                title={t('tts.charAssign.selectCharacter', 'キャラクターを選択')}
                                            >
                                                <Search size={13} className="text-gray-500 shrink-0" />
                                                <span className={`truncate ${selectedCharName ? 'text-gray-200' : 'text-gray-500'}`}>
                                                    {selectedCharName || t('tts.charAssign.selectCharacter', 'キャラクターを選択')}
                                                </span>
                                            </button>
                                            {charDirty && <span className="text-xs text-yellow-400">{t('tts.settings.unsaved', '未保存')}</span>}
                                        </div>
                                        {charConfig && (
                                        <div className="space-y-3">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <label className="text-xs text-gray-400">
                                                    {t('tts.charAssign.voice', 'Voice')}
                                                </label>
                                                <button
                                                    onClick={() => {
                                                        if (!voicesLoaded && !voicesLoading) void loadVoices();
                                                        setIsVoicePickerOpen(true);
                                                    }}
                                                    className="flex items-center gap-2 min-w-[12rem] max-w-full bg-gray-800 border border-gray-700 hover:border-pink-500 text-sm rounded px-3 py-1.5 transition-colors"
                                                    title={t('tts.charAssign.selectVoice', 'Voiceを選択')}
                                                >
                                                    <Search size={13} className="text-gray-500 shrink-0" />
                                                    <span className={`truncate ${charConfig.voiceId ? 'text-gray-200' : 'text-gray-500'}`}>
                                                        {charConfig.voiceId || t('tts.charAssign.voiceNone', '（未設定）')}
                                                    </span>
                                                </button>
                                                <button
                                                    onClick={() => void handleCharPreview()}
                                                    disabled={!selectedCharName}
                                                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-pink-300 hover:text-white bg-pink-900/20 hover:bg-pink-800/50 border border-pink-600/40 rounded transition-colors disabled:opacity-50"
                                                >
                                                    {charPreviewing ? <Square size={13} /> : <Play size={13} />}
                                                    <span>{charPreviewing ? t('tts.button.stop', '停止') : t('tts.charAssign.preview', 'このキャラで試聴')}</span>
                                                </button>
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">
                                                    {t('tts.charAssign.voiceDesign', 'VoiceDesignキャプション')}
                                                </label>
                                                <textarea
                                                    value={charConfig.voiceDesignCaption}
                                                    onChange={e => updateCharConfig('voiceDesignCaption', e.target.value)}
                                                    rows={2}
                                                    placeholder={t('tts.charAssign.voiceDesignPlaceholder', '声質の説明（例: 落ち着いた低めの女性の声）')}
                                                    className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 outline-none focus:border-pink-500 resize-y"
                                                />
                                            </div>
                                            <div className="border border-gray-700/60 rounded">
                                                <button
                                                    onClick={() => setIsCfgOverrideOpen(prev => !prev)}
                                                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-gray-800 transition-colors"
                                                >
                                                    {isCfgOverrideOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                    {t('tts.charAssign.cfgOverride', 'キャラ単位のcfg上書き（空欄で全体既定値）')}
                                                </button>
                                                {isCfgOverrideOpen && (
                                                    <div className="flex flex-wrap items-center gap-2 px-3 pb-3 text-xs text-gray-400">
                                                        <span>cfg_scale_caption</span>
                                                        <input
                                                            type="number"
                                                            step={0.1}
                                                            min={0}
                                                            value={charConfig.cfgScaleCaption ?? ''}
                                                            onChange={e => updateCharConfig('cfgScaleCaption', e.target.value.trim() === '' ? null : Number(e.target.value))}
                                                            className="w-20 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 outline-none focus:border-pink-500"
                                                        />
                                                        <span>cfg_scale_speaker</span>
                                                        <input
                                                            type="number"
                                                            step={0.1}
                                                            min={0}
                                                            value={charConfig.cfgScaleSpeaker ?? ''}
                                                            onChange={e => updateCharConfig('cfgScaleSpeaker', e.target.value.trim() === '' ? null : Number(e.target.value))}
                                                            className="w-20 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 outline-none focus:border-pink-500"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex justify-end">
                                                <button
                                                    onClick={() => void handleCharSave()}
                                                    disabled={!charDirty || charSaving}
                                                    className="flex items-center gap-1.5 px-4 py-2 text-sm bg-pink-700 hover:bg-pink-600 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {charSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                                    {t('tts.settings.save', '保存')}
                                                </button>
                                            </div>
                                        </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 読み上げ範囲・ナレーター設定（要件4章: 読み上げ対象の二択と、地の文の読み方） */}
                        <div className="border border-orange-600/40 rounded-lg overflow-hidden">
                            <button
                                onClick={toggleNarratorSection}
                                className="w-full flex items-center gap-2 px-4 py-3 bg-gray-800/80 hover:bg-gray-800 text-sm font-medium text-orange-300 transition-colors"
                            >
                                {isNarratorOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                <Mic size={16} className="text-orange-400" />
                                {t('tts.narrator.section', '読み上げ範囲・ナレーター設定')}
                            </button>
                            {isNarratorOpen && config && (
                                <div className="p-4 space-y-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <label className="text-xs text-gray-400">
                                            {t('tts.readTarget.label', '読み上げ範囲')}
                                        </label>
                                        <select
                                            value={config.readTarget}
                                            onChange={e => void persistConfigPatch({ readTarget: e.target.value as TTSReadTarget })}
                                            className="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 outline-none focus:border-orange-500"
                                        >
                                            <option value="dialogue">{t('tts.readTarget.dialogue', 'セリフのみ')}</option>
                                            <option value="dialogueAndNarration">{t('tts.readTarget.dialogueAndNarration', 'セリフ＋地の文')}</option>
                                        </select>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <label className="text-xs text-gray-400">
                                            {t('tts.responseFormat.label', '音声形式')}
                                        </label>
                                        <select
                                            value={config.responseFormat}
                                            onChange={e => void persistConfigPatch({ responseFormat: e.target.value as TTSResponseFormat })}
                                            className="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 outline-none focus:border-orange-500"
                                        >
                                            <option value="wav">wav</option>
                                            <option value="mp3">mp3</option>
                                        </select>
                                    </div>
                                    <p className="text-[11px] text-gray-500">
                                        {t('tts.responseFormat.hint', 'mp3はIrodori-TTS-Server側にmp3エンコーダー（FFmpeg）が必要です。変更は以後の生成から適用されます。')}
                                    </p>
                                    {/* 間の設定: チャンク間の無音（結合と逐次再生で同じ値）と TURN 間の間（通し再生で待つ）。
                                        入力確定（blur / Enter）で保存する。 */}
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                                        <label className="flex items-center gap-2 text-xs text-gray-400">
                                            {t('tts.gap.chunkSilence', 'チャンク間の無音（秒）')}
                                            <input
                                                type="number"
                                                min={0}
                                                max={10}
                                                step={0.1}
                                                defaultValue={config.chunkSilenceSeconds}
                                                key={`chunk-${config.chunkSilenceSeconds}`}
                                                onBlur={e => {
                                                    const v = Number(e.target.value);
                                                    if (Number.isFinite(v) && v >= 0 && v !== config.chunkSilenceSeconds) void persistConfigPatch({ chunkSilenceSeconds: v });
                                                }}
                                                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                                className="w-20 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 outline-none focus:border-orange-500"
                                            />
                                        </label>
                                        <label className="flex items-center gap-2 text-xs text-gray-400">
                                            {t('tts.gap.turnGap', 'TURN間・応答間の間（秒）')}
                                            <input
                                                type="number"
                                                min={0}
                                                max={10}
                                                step={0.1}
                                                defaultValue={config.turnGapSeconds}
                                                key={`turn-${config.turnGapSeconds}`}
                                                onBlur={e => {
                                                    const v = Number(e.target.value);
                                                    if (Number.isFinite(v) && v >= 0 && v !== config.turnGapSeconds) void persistConfigPatch({ turnGapSeconds: v });
                                                }}
                                                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                                className="w-20 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 outline-none focus:border-orange-500"
                                            />
                                        </label>
                                    </div>
                                    <p className="text-[11px] text-gray-500">
                                        {t('tts.gap.hint', 'チャンク間の無音は結合音声への無音挿入と逐次再生の間隔の両方に使い、以後の生成から適用されます。TURN間・応答間の間は通し再生（全体読み上げ・自動再生・自動継続）で音声の切れ目に空ける時間で、次の再生から適用されます。')}
                                    </p>
                                    <ToggleSwitch
                                        checked={config.narratorEnabled}
                                        onChange={value => void persistConfigPatch({ narratorEnabled: value })}
                                        label={t('tts.narrator.enabled', '地の文ナレーター読み')}
                                        labelPosition="right"
                                        accent="orange"
                                    />
                                    <div className="flex flex-wrap items-center gap-2">
                                        <label className="text-xs text-gray-400">
                                            {t('tts.narrator.voice', 'ナレーター用Voice')}
                                        </label>
                                        <select
                                            value={config.narratorVoiceId}
                                            onChange={e => void persistConfigPatch({ narratorVoiceId: e.target.value })}
                                            className="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 outline-none focus:border-orange-500"
                                        >
                                            <option value="">{t('tts.charAssign.voiceNone', '（未設定）')}</option>
                                            {voices.map(voice => (
                                                <option key={voice.id} value={voice.id}>{voice.id}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <p className="text-[11px] text-gray-500">
                                        {t('tts.narrator.hint', '読み上げ範囲が「セリフ＋地の文」のときの、地の文の読み方の設定です。地の文ナレーター読みがONの場合は地の文をナレーター用Voiceで読み上げます。OFFの場合やナレーター用Voiceが未設定の場合は、そのTURNのキャラクターのVoiceで読み上げます。変更は即時保存されます。')}
                                    </p>
                                    <div className="border-t border-gray-700/60 pt-3 space-y-2">
                                        <ToggleSwitch
                                            checked={config.autoAdvanceEnabled}
                                            onChange={value => void persistConfigPatch({ autoAdvanceEnabled: value })}
                                            label={t('tts.autoAdvance.label', '続きを自動再生')}
                                            labelPosition="right"
                                            accent="orange"
                                        />
                                        <p className="text-[11px] text-gray-500">
                                            {t('tts.autoAdvance.hint', '全体読み上げの通し再生で、応答の区切りを超えて、生成済みの次の音声を続けて再生します。変更は即時保存されます。')}
                                        </p>
                                        <div className="pt-1 space-y-1">
                                            <div className="flex items-center justify-between">
                                                <label className="text-xs text-gray-400">
                                                    {t('tts.volume.label', '再生音量')}
                                                </label>
                                                <span className="text-xs text-gray-300">{Math.round(config.volume * 100)}%</span>
                                            </div>
                                            {/* ドラッグ中はローカル反映のみ、離した時（キー操作後含む）に保存する。 */}
                                            <input
                                                type="range"
                                                min={0}
                                                max={1}
                                                step={0.05}
                                                value={config.volume}
                                                onChange={e => { const volume = Number(e.target.value); setConfig(prev => (prev ? { ...prev, volume } : prev)); }}
                                                onPointerUp={e => void persistConfigPatch({ volume: Number((e.target as HTMLInputElement).value) })}
                                                onKeyUp={e => void persistConfigPatch({ volume: Number((e.target as HTMLInputElement).value) })}
                                                className="w-full accent-orange-500"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 右半分: 文体指示セクション＋読み上げテスト用エリア（設計04の2章。左右半々） */}
                    <div className="w-1/2 shrink-0 border-l border-gray-700 overflow-y-auto custom-scrollbar p-4 space-y-3">
                        {/* 文体指示セクション（要件9.8: Irodori-TTS用文体指示（絵文字）のON/OFF。読み上げテストの上に置く） */}
                        <div className="border border-orange-600/40 rounded-lg overflow-hidden">
                            <button
                                onClick={() => setIsEmojiStyleOpen(prev => !prev)}
                                className="w-full flex items-center gap-2 px-4 py-3 bg-gray-800/80 hover:bg-gray-800 text-sm font-medium text-orange-300 transition-colors"
                            >
                                {isEmojiStyleOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                <Smile size={16} className="text-orange-400" />
                                {t('tts.emojiStyle.section', '文体指示（絵文字による感情表現）')}
                            </button>
                            {isEmojiStyleOpen && config && (
                                <div className="p-4 space-y-3">
                                    <ToggleSwitch
                                        checked={config.emojiStyleEnabled}
                                        onChange={value => void persistConfigPatch({ emojiStyleEnabled: value })}
                                        label={t('tts.emojiStyle.enabled', 'Irodori-TTS用文体指示')}
                                        labelPosition="right"
                                        accent="orange"
                                    />
                                    <p className="text-[11px] text-gray-500">
                                        {t('tts.emojiStyle.hint', '有効にすると、AIが対応絵文字を文へ添えて応答し、読み上げ音声へ感情が乗ります。絵文字は画面表示と画像生成では常に取り除かれ、音声生成にだけ使われます。変更は即時保存されます。')}
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-2 text-sm font-medium text-orange-300 pt-1">
                            <Play size={15} className="text-orange-400" />
                            {t('tts.test.section', '読み上げテスト')}
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">
                                {t('tts.test.text', 'テスト用テキスト')}
                            </label>
                            <textarea
                                value={effectivePreviewText}
                                onChange={e => setPreviewText(e.target.value)}
                                rows={4}
                                className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 outline-none focus:border-orange-500 resize-y"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">
                                {t('tts.test.voice', 'テストする音声')}
                            </label>
                            <select
                                value={testTarget}
                                onChange={e => setTestTarget(e.target.value)}
                                onFocus={() => { if (!voicesLoaded && !voicesLoading) void loadVoices(); }}
                                className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 outline-none focus:border-orange-500"
                            >
                                <option value="">{t('tts.test.selectVoice', '音声を選択')}</option>
                                {selectedCharName && (
                                    <option value="character">
                                        {t('tts.test.selectedCharacter', '選択中のキャラクター')}: {selectedCharName}
                                    </option>
                                )}
                                {voices.map(voice => (
                                    <option key={voice.id} value={voice.id}>{voice.id}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => void handleTestSynthesize()}
                                disabled={!testBusy && (!effectivePreviewText.trim() || !testTarget)}
                                className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${testBusy
                                    ? 'bg-red-800 hover:bg-red-700 text-white'
                                    : 'bg-orange-700 hover:bg-orange-600 text-white'}`}
                            >
                                {testBusy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                                {testBusy ? t('tts.test.cancel', 'キャンセル') : t('tts.test.run', 'テスト')}
                            </button>
                            <button
                                onClick={handleTestReplay}
                                disabled={!testAudioUrl || testBusy}
                                className="flex items-center gap-1.5 px-3 py-2 text-sm border border-orange-600/60 text-orange-300 hover:bg-orange-900/30 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Play size={14} />
                                {t('tts.test.replay', '再生')}
                            </button>
                            {(testBusy || testElapsed > 0) && (
                                <span className="text-xs text-gray-400">{testElapsed.toFixed(1)}{t('tts.latent.seconds', '秒')}</span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            {/* キャラクター選択（検索付き。選択中を選択状態で表示し、開いた時にその位置へスクロール） */}
            <GridSelectionModal
                isOpen={isCharPickerOpen}
                onClose={() => setIsCharPickerOpen(false)}
                title={t('tts.charAssign.selectCharacter', 'キャラクターを選択')}
                searchPlaceholder={t('tts.charAssign.characterSearch', 'キャラクター名で検索')}
                noMatchTemplate={t('tts.search.noMatch', '「{{searchTerm}}」に一致する項目がありません')}
                searchable
                wide
                selectedValue={selectedCharName || undefined}
                options={ttsCharacters.map(c => ({ label: c.name, value: c.name }))}
                onSelect={val => {
                    setIsCharPickerOpen(false);
                    if (val && val !== selectedCharName) void handleCharSelect(val);
                }}
            />
            {/* Voice選択（検索付き。「（未設定）」で解除） */}
            <GridSelectionModal
                isOpen={isVoicePickerOpen}
                onClose={() => setIsVoicePickerOpen(false)}
                title={t('tts.charAssign.selectVoice', 'Voiceを選択')}
                searchPlaceholder={t('tts.voices.searchPlaceholder', 'Voice IDで検索')}
                noMatchTemplate={t('tts.search.noMatch', '「{{searchTerm}}」に一致する項目がありません')}
                searchable
                emptyLabel={t('tts.charAssign.voiceNone', '（未設定）')}
                selectedValue={charConfig?.voiceId || undefined}
                options={voices.map(voice => ({ label: voice.id, value: voice.id }))}
                onSelect={val => {
                    setIsVoicePickerOpen(false);
                    if (charConfig && val !== charConfig.voiceId) updateCharConfig('voiceId', val);
                }}
            />
            <ConfirmDialog
                isOpen={deleteTarget !== null}
                title={t('tts.voices.deleteTitle', 'Voiceの削除')}
                message={`${t('tts.voices.deleteMessage', '次のVoiceを削除します。よろしいですか？')}\n${deleteTarget ?? ''}\n${deleteUsedBy === null
                    ? t('tts.voices.usageChecking', '使用状況を確認中...')
                    : deleteUsedBy.length > 0
                        ? `${t('tts.voices.usedBy', '使用中のキャラクター')}: ${deleteUsedBy.join('、')}`
                        : t('tts.voices.usedByNone', '使用中のキャラクターはいません')}`}
                onYes={() => void handleDelete()}
                onNo={() => setDeleteTarget(null)}
                onCancel={() => setDeleteTarget(null)}
                uiCatalog={uiCatalog}
            />
            {/* サーバー再起動の確認（要件12章: 再起動には確認操作を設ける） */}
            <ConfirmDialog
                isOpen={isRestartConfirmOpen}
                title={t('tts.engine.restartTitle', 'サーバーの再起動')}
                message={t('tts.engine.restartMessage', 'Irodori-TTS-Serverを再起動します。実行中の音声生成は中断されます。よろしいですか？')}
                onYes={() => void handleEngineRestart()}
                onNo={() => setIsRestartConfirmOpen(false)}
                onCancel={() => setIsRestartConfirmOpen(false)}
                uiCatalog={uiCatalog}
            />
        </div>
    );
};
