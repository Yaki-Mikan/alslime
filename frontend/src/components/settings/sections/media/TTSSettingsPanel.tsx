/**
 * TTSSettingsPanel.tsx - 設定画面「画像生成・読み上げ」の読み上げ
 *
 * 接続（接続先・API キー・待ち時間）、エンジンの管理、声の登録（一覧・試聴・削除・参照音声からの登録）、
 * 読み上げ方（範囲・ナレーター・間）、絵文字による感情表現。
 * 接続の項目は下書きを持ち、設定画面の保存の帯から保存する。ほかの項目はその場で保存する。
 * part='voices' のときは声の登録と読み上げテストだけを出す（素材づくりの声のタブ）。設定画面では出さない。
 * キャラごとの声の紐づけは、素材づくりのキャラのタブにある。
 */
import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { subscribeConfigFilesChanged } from '../../../../lib/configFilesChanged';
import { ChevronDown, ChevronRight, Cpu, Download, Loader2, Mic, Play, Plug, Smile, Square, Trash2, Upload, Wand2 } from 'lucide-react';
import { useIsWideScreen } from '../../../../hooks/useIsWideScreen';
import { deleteTTSVoice, encodeTTSLatent, fetchTTSHealth, fetchTTSRuntimeModels, fetchTTSRuntimeProfiles, fetchTTSVoices, getTTSCharacterConfig, getTTSConfig, getTTSServerCapabilities, previewTTS, restartTTSRuntime, saveTTSConfig, setTTSRuntimeModel, setTTSRuntimeProfile, testTTSConnection, unloadTTSRuntimeModel, uploadTTSVoice } from '../../../../api/tts';
import type { TTSConfig, TTSConnectionTestResult, TTSReadTarget, TTSResponseFormat, TTSRuntimeModel, TTSRuntimeProfilesResult, TTSRuntimeState, TTSServerCapabilitiesResult, TTSVoice } from '../../../../api/tts';
import { getCharacterTags } from '../../../../api/files';
import type { CharacterTagInfo } from '../../../../api/files';
import { fetchCharacterVoiceSummary } from '../../../../api/material';
import { resolveMessage, type I18NCatalog } from '../../../../api/i18n';
import { ConfirmDialog } from '../../../ConfirmDialog';
import { ToggleSwitch } from '../../../common/ToggleSwitch';
import type { SectionHandle } from '../sectionTypes';

// 読み上げテストで「キャラの声」を選んだときの値の頭（後ろにキャラのフォルダ名が続く）
const CHARACTER_TEST_PREFIX = 'character:';

interface Props {
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    // 表示しているか。true になったときに設定を読む
    active: boolean;
    // 接続の項目に保存していない変更があるかを知らせる
    onDirtyChange?: (dirty: boolean) => void;
    // 設定画面の保存の帯から保存・元に戻すを呼ぶ口
    handleRef?: React.Ref<SectionHandle>;
    // 出す区画。settings＝設定画面（声の登録以外）、voices＝素材づくりの声のタブ（声の登録だけ）
    part?: 'settings' | 'voices';
}

export const TTSSettingsPanel: React.FC<Props> = ({
    backendUrl,
    uiCatalog = null,
    active,
    onDirtyChange,
    handleRef,
    part = 'settings',
}) => {
    const t = (key: string, fallback: string) => resolveMessage(uiCatalog, key, fallback);

    const isWideScreen = useIsWideScreen();
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
    const [isVoicesOpen, setIsVoicesOpen] = useState(part === 'voices');
    const [voices, setVoices] = useState<TTSVoice[]>([]);
    const [voicesLoading, setVoicesLoading] = useState(false);
    // 登録Voice一覧の開閉（既定は閉）と検索。数百件規模になりうるため、開いた時だけ
    // 描画し、検索で絞り込み、10件分程度の高さを上限にスクロールさせる。
    const [isVoiceListOpen, setIsVoiceListOpen] = useState(false);
    const [voiceSearch, setVoiceSearch] = useState('');
    const [voicesLoaded, setVoicesLoaded] = useState(false);
    // 直近に登録したVoice ID（音声アップロード・Latent登録の直後に試聴できるよう一覧の上に出す）。
    const [recentVoiceId, setRecentVoiceId] = useState<string | null>(null);
    // 読み上げテストと試聴で読み上げる文。null は未編集（表示時にカタログの既定文へ解決する）
    const [previewText, setPreviewText] = useState<string | null>(null);
    const effectivePreviewText = previewText ?? t('tts.voicePanel.previewText', 'こんにちは。音声のテストです。');
    // 読み上げテスト（声のタブ）。実行中の再押下はリクエスト中断でキャンセル
    const [testTarget, setTestTarget] = useState('');
    const [testBusy, setTestBusy] = useState(false);
    const [testElapsed, setTestElapsed] = useState(0);
    const [testAudioUrl, setTestAudioUrl] = useState<string | null>(null);
    const testAbortRef = useRef<AbortController | null>(null);
    const testTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
    // 文体指示（絵文字）セクション（要件9.8: トグルは設定画面と準備・調整欄の両方へ配置）。
    const [isEmojiStyleOpen, setIsEmojiStyleOpen] = useState(false);
    // 声の削除のときに、その声を使っているキャラを調べるためのキャラ一覧
    const [ttsCharacters, setTtsCharacters] = useState<CharacterTagInfo[]>([]);
    // 設定を読めなかった（刷新前と同じく、読めなかったことを出す）
    const [configLoadFailed, setConfigLoadFailed] = useState(false);
    // 声を紐づけてあるキャラ（読み上げテストで、そのキャラの紐づけの設定で試すため）
    const [voiceCharacters, setVoiceCharacters] = useState<{ dirName: string; name: string }[]>([]);
    const loadVoiceCharacters = async () => {
        const [summary, tags] = await Promise.all([
            fetchCharacterVoiceSummary(backendUrl),
            getCharacterTags().catch(() => ({ characters: [] as CharacterTagInfo[] })),
        ]);
        const nameByDir = new Map<string, string>();
        for (const c of tags.characters) if (!nameByDir.has(c.dirName)) nameByDir.set(c.dirName, c.name);
        setVoiceCharacters((summary ?? [])
            .filter(s => s.voiceId)
            .map(s => ({ dirName: s.dirName, name: nameByDir.get(s.dirName) ?? s.dirName })));
    };
    // 設定ファイルが増えた・消えた・書き換わったら、控えておいたキャラ一覧を捨てる（次に使うときに読み直す）
    useEffect(() => subscribeConfigFilesChanged(() => setTtsCharacters([])), []);

    // 開くたびに設定を読み直す（閉じている間の外部変更を拾う）。
    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        (async () => {
            try {
                const cfg = await getTTSConfig(backendUrl);
                if (cancelled) return;
                setConfig(cfg);
                setConfigLoadFailed(false);
                setApiKeyInput('');
                setClearApiKey(false);
                setIsDirty(false);
            } catch (error) {
                console.error('[TTSSettingsPanel] config load failed:', error);
                if (!cancelled) setConfigLoadFailed(true);
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
    }, [active, backendUrl]);

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
            console.error('[TTSSettingsPanel] engine info load failed:', error);
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
            console.error('[TTSSettingsPanel] model load failed:', error);
            showEngineNotice(t('tts.engine.loadFailed', 'モデルを読み込めませんでした'));
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
            console.error('[TTSSettingsPanel] model unload failed:', error);
            showEngineNotice(t('tts.engine.unloadFailed', 'モデルをメモリから解放できませんでした'));
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
            console.error('[TTSSettingsPanel] profile apply failed:', error);
            showEngineNotice(t('tts.engine.profileApplyFailed', '動作モードを適用できませんでした'));
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

    const handleSave = async (): Promise<boolean> => {
        if (!config || isSaving) return false;
        setIsSaving(true);
        try {
            const { apiKeySet: _apiKeySet, ...rest } = config;
            void _apiKeySet;
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
                return true;
            }
            showNotice(t('tts.settings.saveFailed', '保存に失敗しました'));
            return false;
        } catch (error) {
            console.error('[TTSSettingsPanel] config save failed:', error);
            showNotice(t('tts.settings.saveFailed', '保存に失敗しました'));
            return false;
        } finally {
            setIsSaving(false);
        }
    };

    // 接続の項目の変更を設定画面へ知らせ、保存の帯からの保存・元に戻すを受け持つ
    useEffect(() => {
        onDirtyChange?.(isDirty);
    }, [isDirty, onDirtyChange]);
    useImperativeHandle(handleRef, () => ({
        save: async () => (!isDirty || (await handleSave()) ? [] : [t('tts.settings.connectionSection', '接続設定')]),
        revert: () => {
            getTTSConfig(backendUrl).then(cfg => {
                setConfig(cfg);
                setApiKeyInput('');
                setClearApiKey(false);
                setIsDirty(false);
            }).catch(() => {});
        },
    }));

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
            console.error('[TTSSettingsPanel] connection test failed:', error);
            setTestResult({
                success: false,
                message: t('tts.connection.requestFailed', 'Irodori-TTS Server との接続を確認できませんでした'),
                checks: {},
            });
        } finally {
            setIsTesting(false);
        }
    };

    const loadVoices = async (): Promise<TTSVoice[] | null> => {
        setVoicesLoading(true);
        try {
            const list = await fetchTTSVoices(backendUrl);
            setVoices(list);
            setVoicesLoaded(true);
            return list;
        } catch (error) {
            console.error('[TTSSettingsPanel] voices load failed:', error);
            showNotice(t('tts.voices.loadFailed', 'Voice一覧の取得に失敗しました'));
            return null;
        } finally {
            setVoicesLoading(false);
        }
    };

    // 登録前のVoice ID集合。一覧未読込なら取得して基準にする（失敗時は空扱い）。
    const snapshotVoiceIds = async (): Promise<Set<string>> => {
        if (voicesLoaded) return new Set(voices.map(voice => voice.id));
        try {
            return new Set((await fetchTTSVoices(backendUrl)).map(voice => voice.id));
        } catch {
            return new Set();
        }
    };

    // 登録前後の一覧差分から新規Voice IDを特定して「直近の登録音声」に控える。
    // 差分が取れない（同名上書き等）場合は入力したIDを使う。
    const markRecentVoice = (before: Set<string>, after: TTSVoice[] | null, fallback: string) => {
        const added = after?.find(voice => !before.has(voice.id));
        const id = added?.id ?? fallback.trim();
        setRecentVoiceId(id || null);
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
            console.error('[TTSSettingsPanel] preview failed:', error);
            setPreviewingId(null);
            showNotice(t('tts.voices.previewFailed', '試聴に失敗しました'));
        }
    };

    const handleUpload = async () => {
        if (!uploadVoiceId.trim() || !uploadFile || isUploading) return;
        setIsUploading(true);
        try {
            const before = await snapshotVoiceIds();
            const newId = uploadVoiceId.trim();
            await uploadTTSVoice(backendUrl, newId, uploadFile);
            setUploadVoiceId('');
            setUploadFile(null);
            showNotice(t('tts.voices.uploaded', 'Voiceを登録しました'));
            markRecentVoice(before, await loadVoices(), newId);
        } catch (error) {
            console.error('[TTSSettingsPanel] voice upload failed:', error);
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
                console.error('[TTSSettingsPanel] voice usage check failed:', error);
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
            if (recentVoiceId === target) setRecentVoiceId(null);
            await loadVoices();
        } catch (error) {
            console.error('[TTSSettingsPanel] voice delete failed:', error);
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

    // 読み上げテスト。実行中にもう一度押すと中断する
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
            // キャラの声を選んだときは、そのキャラの紐づけの設定（声・声の説明・細かい設定）で読む
            const body = testTarget.startsWith(CHARACTER_TEST_PREFIX)
                ? { text: effectivePreviewText, characterName: testTarget.slice(CHARACTER_TEST_PREFIX.length) }
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
                console.error('[TTSSettingsPanel] test synthesize failed:', error);
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

    // 作ったテスト音声をもう一度聞く
    const handleTestReplay = () => {
        if (!testAudioUrl) return;
        stopPreview();
        const audio = new Audio(testAudioUrl);
        previewAudioRef.current = audio;
        void audio.play();
    };

    // 声のタブでは、開いたときに声の一覧を読む
    useEffect(() => {
        if (part !== 'voices' || !active || voicesLoaded || voicesLoading) return;
        void loadVoices();
        // 一覧の読み込みは開いたときに一度だけ
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [part, active, voicesLoaded]);

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
            const before = mode === 'register' ? await snapshotVoiceIds() : new Set<string>();
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
                markRecentVoice(before, await loadVoices(), latentVoiceId);
            }
        } catch (error) {
            console.error('[TTSSettingsPanel] latent encode failed:', error);
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
            const before = await snapshotVoiceIds();
            await encodeTTSLatent(backendUrl, { ...latentParams(), file: droppedLatent, mode: 'register' });
            showNotice(t('tts.latent.registered', 'LatentをVoiceとして登録しました'));
            setDroppedLatent(null);
            markRecentVoice(before, await loadVoices(), latentVoiceId);
        } catch (error) {
            console.error('[TTSSettingsPanel] latent register failed:', error);
            showNotice(t('tts.latent.failed', 'Latent変換に失敗しました'));
        } finally {
            setLatentBusy(false);
        }
    };

    // グローバル設定の一部項目（ナレーター設定）は即時保存する（persistFormat 方式）。
    const persistConfigPatch = async (patch: Partial<TTSConfig>) => {
        if (!config) return;
        setConfig(prev => (prev ? { ...prev, ...patch } : prev));
        try {
            const { apiKeySet: _apiKeySet, ...rest } = config;
            void _apiKeySet;
            await saveTTSConfig(backendUrl, { ...rest, ...patch, apiKey: '', clearApiKey: false });
        } catch (error) {
            console.error('[TTSSettingsPanel] config patch save failed:', error);
        }
    };

    const toggleNarratorSection = () => {
        setIsNarratorOpen(prev => {
            const next = !prev;
            if (next && !voicesLoaded && !voicesLoading) void loadVoices();
            return next;
        });
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
            showNotice(t('tts.latent.dropUnsupported', '.wav、.pt、.pth のいずれかのファイルをドラッグ＆ドロップしてください。'));
        }
    };

    if (!active) return null;

    // 接続テスト結果からサーバー情報の要点を取り出す（health 応答は Irodori-TTS の生 JSON）。
    const health = (testResult?.health ?? null) as { model?: { id?: string }; runtime?: { loaded?: boolean; loading?: boolean }; voices?: { files?: number } } | null;

    return (
        <div>
            {notice && <p className="mb-3 text-xs text-accent">{notice}</p>}
            {part === 'settings' && configLoadFailed && !config && (
                <p className="mb-3 text-xs text-danger">{t('tts.drawer.loadFailed', '設定を読み込めませんでした')}</p>
            )}
            {/* 声のタブでは、広い画面は左に声の登録・右に読み上げテスト、狭い画面は縦に積む */}
            <div className={part === 'voices' ? 'grid gap-4 lg:grid-cols-2 items-start' : 'space-y-4'}>
                        {part === 'settings' && (<>
                        {/* 接続設定セクション */}
                        <div className="border border-line-strong rounded-lg overflow-hidden">
                            <button
                                onClick={() => setIsConnectionOpen(prev => !prev)}
                                className="w-full flex items-center gap-2 px-4 py-3 bg-surface hover:bg-surface text-sm font-medium text-accent transition-colors"
                            >
                                {isConnectionOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                <Plug size={16} className="text-accent" />
                                {t('tts.settings.connectionSection', '接続設定')}
                            </button>
                            {isConnectionOpen && config && (
                                <div className="p-4 space-y-4">
                                    <div>
                                        <label className="block text-xs text-fg-muted mb-1">
                                            {t('tts.settings.connectionUrl', 'エンドポイントURL')}
                                        </label>
                                        <div className={isWideScreen ? 'flex items-center gap-2' : 'flex flex-col gap-2'}>
                                            <input
                                                type="text"
                                                value={config.connectionUrl}
                                                onChange={e => updateConfig('connectionUrl', e.target.value)}
                                                placeholder="http://127.0.0.1:8088"
                                                className="flex-1 w-full min-w-0 bg-surface border border-line-strong text-fg text-sm rounded px-3 py-2 outline-none focus:border-accent"
                                            />
                                            <button
                                                onClick={handleConnectionTest}
                                                disabled={isTesting}
                                                className="shrink-0 px-4 py-2 text-sm bg-accent hover:brightness-110 text-on-accent rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {isTesting ? t('tts.connection.testing', '確認中...') : t('tts.connection.test', '接続を確認')}
                                            </button>
                                        </div>
                                        <p className="mt-1 text-xs text-fg-muted">
                                            {t('tts.settings.connectionUrlHint', 'Irodori-TTS-Server の接続先。別PC上のサーバーも指定できます。')}
                                        </p>
                                        {testResult && (
                                            <div className="mt-2 space-y-2 text-sm border border-line-strong rounded p-3">
                                                <div className={testResult.success ? 'text-ok' : 'text-danger'}>
                                                    {testResult.success
                                                        ? t('tts.connection.ok', '接続できました')
                                                        : t('tts.connection.failed', '接続できませんでした')}
                                                </div>
                                                <div className="text-xs text-fg-muted space-y-1">
                                                    {(['health', 'models', 'voices'] as const).map(key => (
                                                        <div key={key} className="flex items-center gap-2">
                                                            <span className={testResult.checks[key] ? 'text-ok' : 'text-danger'}>
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
                                                    <div className="text-xs text-fg-muted border-t border-line-strong pt-2 space-y-0.5">
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
                                        <label className="block text-xs text-fg-muted mb-1">
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
                                            className="w-full bg-surface border border-line-strong text-fg text-sm rounded px-3 py-2 outline-none focus:border-accent"
                                        />
                                        {config.apiKeySet && (
                                            <label className="mt-1.5 flex items-center gap-2 text-xs text-fg-muted cursor-pointer select-none">
                                                <input
                                                    type="checkbox"
                                                    checked={clearApiKey}
                                                    onChange={e => {
                                                        setClearApiKey(e.target.checked);
                                                        if (e.target.checked) setApiKeyInput('');
                                                        setIsDirty(true);
                                                    }}
                                                    className="accent-accent"
                                                />
                                                <span>{t('tts.settings.clearApiKey', '保存時に API キーを削除する')}</span>
                                            </label>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-xs text-fg-muted mb-1">
                                            {t('tts.settings.connectTimeout', '接続タイムアウト（秒）')}
                                        </label>
                                        <input
                                            type="number"
                                            min={1}
                                            max={60}
                                            value={config.connectTimeoutSeconds}
                                            onChange={e => updateConfig('connectTimeoutSeconds', Number(e.target.value))}
                                            className="w-24 bg-surface border border-line-strong text-fg text-sm rounded px-3 py-2 outline-none focus:border-accent"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 文体指示（Irodori-TTS 用の絵文字による感情表現の ON/OFF）。刷新前と同じく接続設定のすぐ下に置く */}
                        <div className="border border-line-strong rounded-lg overflow-hidden">
                            <button
                                onClick={() => setIsEmojiStyleOpen(prev => !prev)}
                                className="w-full flex items-center gap-2 px-4 py-3 bg-surface hover:bg-surface text-sm font-medium text-accent transition-colors"
                            >
                                {isEmojiStyleOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                <Smile size={16} className="text-accent" />
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
                                    <p className="text-xs text-fg-muted">
                                        {t('tts.emojiStyle.hint', '有効にすると、AIが対応絵文字を文へ添えて応答し、読み上げ音声へ感情が乗ります。絵文字は画面表示と画像生成では常に取り除かれ、音声生成にだけ使われます。変更は即時保存されます。')}
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* エンジン管理セクション（P3#5: モデル選択・ロード／オフロード・プロファイル・再起動。要件8章）。
                            runtime系API 対応サーバー（燈版）と判定できたときだけセクションごと表示する。 */}
                        {engineSupported === true && (
                        <div className="border border-line-strong rounded-lg overflow-hidden">
                            <button
                                onClick={toggleEngineSection}
                                className="w-full flex items-center gap-2 px-4 py-3 bg-surface hover:bg-surface text-sm font-medium text-accent transition-colors"
                            >
                                {isEngineOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                <Cpu size={16} className="text-accent" />
                                {t('tts.engine.section', 'エンジン管理')}
                            </button>
                            {isEngineOpen && (
                                <div className="p-4 space-y-3">
                                    {engineBusy && engineModels.length === 0 && (
                                        <div className="flex items-center gap-2 text-xs text-fg-muted">
                                            <Loader2 size={14} className="animate-spin" />
                                            {t('tts.drawer.loading', '設定を読み込み中...')}
                                        </div>
                                    )}
                                    {engineModels.length > 0 && (
                                        <>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <label className="text-xs text-fg-muted">
                                                    {t('tts.engine.model', 'モデル')}
                                                </label>
                                                <select
                                                    value={engineModelSel}
                                                    onChange={e => setEngineModelSel(e.target.value)}
                                                    className="min-w-0 max-w-full bg-surface border border-line-strong text-fg text-sm rounded px-2 py-1.5 outline-none focus:border-accent"
                                                >
                                                    {engineModels.map(model => (
                                                        <option key={model.checkpoint} value={model.checkpoint}>{model.name}</option>
                                                    ))}
                                                </select>
                                                <button
                                                    onClick={() => void loadEngineInfo()}
                                                    disabled={engineBusy}
                                                    className="px-2 py-1 text-xs border border-line-strong rounded text-fg-muted hover:bg-surface-2 transition-colors disabled:opacity-50"
                                                >
                                                    {t('tts.voices.reload', '再読込')}
                                                </button>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <button
                                                    onClick={() => void handleEngineModelLoad()}
                                                    disabled={engineBusy || !engineModelSel}
                                                    className="flex items-center gap-1.5 px-3 py-2 text-sm bg-accent hover:brightness-110 text-on-accent rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {engineBusy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                                                    {t('tts.engine.load', '選択モデルをロード')}
                                                </button>
                                                <button
                                                    onClick={() => void handleEngineUnload()}
                                                    disabled={engineBusy}
                                                    className="px-3 py-2 text-sm border border-accent/60 text-accent hover:bg-accent-soft rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {t('tts.engine.unload', 'オフロード')}
                                                </button>
                                                <span className="text-xs text-fg-muted">
                                                    {engineRuntime.loading
                                                        ? t('tts.connection.stateLoading', 'ロード中')
                                                        : engineRuntime.loaded
                                                            ? t('tts.connection.stateLoaded', 'ロード済み')
                                                            : t('tts.connection.stateUnloaded', '未ロード')}
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2 border-t border-line-strong pt-3">
                                                <label className="text-xs text-fg-muted">
                                                    {t('tts.engine.profile', '動作モード')}
                                                </label>
                                                <select
                                                    value={engineProfileSel}
                                                    onChange={e => setEngineProfileSel(e.target.value)}
                                                    className="bg-surface border border-line-strong text-fg text-sm rounded px-2 py-1.5 outline-none focus:border-accent"
                                                >
                                                    {(engineProfiles?.profiles ?? []).map(profile => (
                                                        <option key={profile.id} value={profile.id}>{t(`tts.engine.profileLabel.${profile.id}`, profile.label)}</option>
                                                    ))}
                                                </select>
                                                <button
                                                    onClick={() => void handleEngineProfileApply()}
                                                    disabled={engineBusy || !engineProfileSel}
                                                    className="px-3 py-2 text-sm bg-accent hover:brightness-110 text-on-accent rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {t('tts.engine.applyProfile', '適用')}
                                                </button>
                                                {engineProfiles && (
                                                    <span className="text-xs text-fg-muted">
                                                        {t('tts.engine.activeProfile', '稼働中')}: {engineProfiles.activeProfile || t('tts.charAssign.voiceNone', '（未設定）')}
                                                    </span>
                                                )}
                                            </div>
                                            {engineProfiles?.restartRequired && (
                                                <p className="text-xs text-warn">
                                                    {t('tts.engine.restartRequired', '設定の反映にはサーバーの再起動が必要です。')}
                                                </p>
                                            )}
                                            <div className="border-t border-line-strong pt-3">
                                                <button
                                                    onClick={() => setIsRestartConfirmOpen(true)}
                                                    disabled={engineBusy}
                                                    className="px-3 py-2 text-sm border border-danger text-danger hover:bg-danger/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {t('tts.engine.restart', 'サーバーを再起動')}
                                                </button>
                                            </div>
                                        </>
                                    )}
                                    {engineNotice && (
                                        <p className="text-xs text-accent">{engineNotice}</p>
                                    )}
                                </div>
                            )}
                        </div>
                        )}

                        </>)}

                        {part === 'voices' && (
                        /* ボイス管理セクション（P2#1: 一覧・試聴・削除・アップロード） */
                        <div className="border border-line-strong rounded-lg overflow-hidden">
                            <button
                                onClick={toggleVoicesSection}
                                className="w-full flex items-center gap-2 px-4 py-3 bg-surface hover:bg-surface text-sm font-medium text-accent transition-colors"
                            >
                                {isVoicesOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                <Mic size={16} className="text-accent" />
                                {t('tts.voices.section', 'ボイス登録・管理')}
                            </button>
                            {isVoicesOpen && (
                                <div className="p-4 space-y-4">
                                    {/* 直近の登録音声（登録直後に一覧から探さず試聴するための1件表示） */}
                                    <div className="space-y-1.5">
                                        <span className="block text-xs text-fg-muted">{t('tts.voices.recent', '直近の登録音声')}</span>
                                        {recentVoiceId ? (
                                            <div className="flex items-center gap-2 px-3 py-2 bg-surface border border-line-strong rounded">
                                                <span className="text-sm text-fg truncate">{recentVoiceId}</span>
                                                <button
                                                    onClick={() => void handlePreview(recentVoiceId)}
                                                    className="ml-auto shrink-0 flex items-center gap-1.5 px-2.5 py-1 text-xs text-accent hover:text-fg bg-accent-soft hover:bg-accent-soft border border-line-strong rounded transition-colors"
                                                    title={previewingId === recentVoiceId ? t('tts.button.stop', '停止') : t('tts.voices.preview', '試聴')}
                                                >
                                                    {previewingId === recentVoiceId ? <Square size={13} /> : <Play size={13} />}
                                                    <span>{previewingId === recentVoiceId ? t('tts.button.stop', '停止') : t('tts.voices.preview', '試聴')}</span>
                                                </button>
                                            </div>
                                        ) : (
                                            <p className="text-xs text-fg-muted px-1">{t('tts.voices.recentNone', 'なし')}</p>
                                        )}
                                    </div>
                                    <div className="space-y-1.5">
                                        {/* 見出し行＝開閉ボタン（既定は閉。数百件規模でも開くまで一覧を描画しない） */}
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => setIsVoiceListOpen(prev => !prev)}
                                                className="flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg transition-colors"
                                            >
                                                {isVoiceListOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                <span>{t('tts.voices.list', '登録Voice一覧')}</span>
                                                {voicesLoaded && (
                                                    <span className="text-fg-muted">({voices.length})</span>
                                                )}
                                            </button>
                                            <button
                                                onClick={() => void loadVoices()}
                                                disabled={voicesLoading}
                                                className="ml-auto px-2 py-1 text-xs border border-line-strong rounded text-fg-muted hover:bg-surface-2 transition-colors disabled:opacity-50"
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
                                                        className="w-full bg-surface border border-line-strong text-fg text-sm rounded px-3 py-1.5 outline-none focus:border-accent"
                                                    />
                                                    {voicesLoading ? (
                                                        <div className="flex items-center gap-2 text-xs text-fg-muted px-1 py-2">
                                                            <Loader2 size={14} className="animate-spin" />
                                                            {t('tts.voices.loading', '読込中...')}
                                                        </div>
                                                    ) : voices.length === 0 ? (
                                                        <p className="text-xs text-fg-muted px-1 py-2">
                                                            {t('tts.voices.empty', '登録Voiceがありません。Irodori-TTSへの接続と登録状況を確認してください。')}
                                                        </p>
                                                    ) : filtered.length === 0 ? (
                                                        <p className="text-xs text-fg-muted px-1 py-2">
                                                            {t('tts.voices.searchNoMatch', '検索に一致するVoiceがありません')}
                                                        </p>
                                                    ) : (
                                                        <>
                                                            {query && (
                                                                <p className="text-xs text-fg-muted px-1">
                                                                    {filtered.length} / {voices.length}
                                                                </p>
                                                            )}
                                                            {/* 10件分程度（1行約38px＋間隔）を上限に、超えた分は縦スクロール */}
                                                            <div className="max-h-[27.5rem] overflow-y-auto custom-scrollbar space-y-1.5 pr-1">
                                                                {filtered.map(voice => (
                                                                    <div key={voice.id} className="flex items-center gap-2 px-3 py-2 bg-surface border border-line-strong rounded">
                                                                        <span className="text-sm text-fg truncate">{voice.id}</span>
                                                                        <button
                                                                            onClick={() => void handlePreview(voice.id)}
                                                                            className="ml-auto shrink-0 flex items-center gap-1.5 px-2.5 py-1 text-xs text-accent hover:text-fg bg-accent-soft hover:bg-accent-soft border border-line-strong rounded transition-colors"
                                                                            title={previewingId === voice.id ? t('tts.button.stop', '停止') : t('tts.voices.preview', '試聴')}
                                                                        >
                                                                            {previewingId === voice.id ? <Square size={13} /> : <Play size={13} />}
                                                                            <span>{previewingId === voice.id ? t('tts.button.stop', '停止') : t('tts.voices.preview', '試聴')}</span>
                                                                        </button>
                                                                        <button
                                                                            onClick={() => openDeleteConfirm(voice.id)}
                                                                            className="shrink-0 p-1.5 text-fg-muted hover:text-danger hover:bg-danger/10 rounded transition-colors"
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
                                    <div className="border-t border-line-strong pt-3 space-y-2">
                                        <label className="block text-xs text-fg-muted">
                                            {t('tts.latent.section', 'Latent生成')}
                                        </label>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <input
                                                type="text"
                                                value={latentVoiceId}
                                                onChange={e => setLatentVoiceId(e.target.value)}
                                                placeholder={t('tts.voices.uploadIdPlaceholder', 'Voice ID（半角英数）')}
                                                className="w-44 bg-surface border border-line-strong text-fg text-sm rounded px-3 py-2 outline-none focus:border-accent"
                                            />
                                            <input
                                                type="text"
                                                value={latentDisplayName}
                                                onChange={e => setLatentDisplayName(e.target.value)}
                                                placeholder={t('tts.latent.displayNamePlaceholder', '表示名')}
                                                className="w-44 bg-surface border border-line-strong text-fg text-sm rounded px-3 py-2 outline-none focus:border-accent"
                                            />
                                            <label className="cursor-pointer max-w-[220px] truncate px-3 py-2 text-sm border border-accent/60 text-accent hover:bg-accent-soft rounded transition-colors">
                                                {latentAudioFile ? latentAudioFile.name : t('tts.voices.chooseFile', 'ファイルを選択')}
                                                <input
                                                    type="file"
                                                    accept=".wav,audio/wav"
                                                    onChange={e => setLatentAudio(e.target.files?.[0] ?? null)}
                                                    className="hidden"
                                                />
                                            </label>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                                            <span>{t('tts.latent.rangeStart', '開始秒')}</span>
                                            <input
                                                type="number"
                                                min={0}
                                                step={0.1}
                                                value={latentStart}
                                                onChange={e => setLatentStart(e.target.value)}
                                                className="w-20 bg-surface border border-line-strong text-fg text-sm rounded px-2 py-1.5 outline-none focus:border-accent"
                                            />
                                            <span>{t('tts.latent.rangeEnd', '終了秒（空欄で末尾まで）')}</span>
                                            <input
                                                type="number"
                                                min={0}
                                                step={0.1}
                                                value={latentEnd}
                                                onChange={e => setLatentEnd(e.target.value)}
                                                className="w-20 bg-surface border border-line-strong text-fg text-sm rounded px-2 py-1.5 outline-none focus:border-accent"
                                            />
                                            {latentRangeSeconds() !== null && (
                                                <span className="text-accent">
                                                    {t('tts.latent.rangeTotal', '合計')}: {latentRangeSeconds()!.toFixed(1)}{t('tts.latent.seconds', '秒')}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                                            <span>{t('tts.latent.device', '変換デバイス')}</span>
                                            <select
                                                value={latentDevice}
                                                onChange={e => setLatentDevice(e.target.value)}
                                                className="bg-surface border border-line-strong text-fg text-sm rounded px-2 py-1.5 outline-none focus:border-accent"
                                            >
                                                <option value="cpu">CPU</option>
                                            </select>
                                            <span>{t('tts.latent.precision', '変換精度')}</span>
                                            <select
                                                value={latentPrecision}
                                                onChange={e => setLatentPrecision(e.target.value)}
                                                className="bg-surface border border-line-strong text-fg text-sm rounded px-2 py-1.5 outline-none focus:border-accent"
                                            >
                                                <option value="fp32">fp32</option>
                                            </select>
                                            <span>{t('tts.latent.normalizeDb', '音量正規化dB（空欄で無効）')}</span>
                                            <input
                                                type="number"
                                                step={0.5}
                                                value={latentNormDb}
                                                onChange={e => setLatentNormDb(e.target.value)}
                                                className="w-20 bg-surface border border-line-strong text-fg text-sm rounded px-2 py-1.5 outline-none focus:border-accent"
                                            />
                                        </div>
                                        {droppedLatent === null ? (
                                            <div className="flex flex-wrap items-center gap-2">
                                                <button
                                                    onClick={() => void handleLatentGenerate('register')}
                                                    disabled={!latentVoiceId.trim() || !latentAudioFile || latentBusy}
                                                    className="flex items-center gap-1.5 px-3 py-2 text-sm bg-accent hover:brightness-110 text-on-accent rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {latentBusy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                                                    {t('tts.latent.generateRegister', 'Latentを生成して登録')}
                                                </button>
                                                <button
                                                    onClick={() => void handleLatentGenerate('download')}
                                                    disabled={!latentAudioFile || latentBusy}
                                                    className="flex items-center gap-1.5 px-3 py-2 text-sm border border-accent/60 text-accent hover:bg-accent-soft rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    <Download size={14} />
                                                    {t('tts.latent.generateDownload', 'Latentを生成してダウンロード')}
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-xs text-accent">{droppedLatent.name}</span>
                                                <button
                                                    onClick={() => void handleLatentRegisterExisting()}
                                                    disabled={!latentVoiceId.trim() || latentBusy}
                                                    className="flex items-center gap-1.5 px-3 py-2 text-sm bg-accent hover:brightness-110 text-on-accent rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {latentBusy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                                                    {t('tts.latent.registerExisting', 'このLatentをVoice登録')}
                                                </button>
                                                <button
                                                    onClick={() => setDroppedLatent(null)}
                                                    disabled={latentBusy}
                                                    className="px-3 py-2 text-sm border border-line-strong text-fg-muted hover:bg-surface-2 rounded transition-colors disabled:opacity-50"
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
                                                    ? 'border-accent bg-accent-soft text-fg'
                                                    : 'border-line-strong text-fg-muted'
                                            }`}
                                        >
                                            {t('tts.latent.dropHint', '参照音声（.wav）または Latent ファイル（.pt、.pth）をドラッグ＆ドロップしてください。')}
                                        </div>
                                        <p className="text-xs text-fg-muted">
                                            {t('tts.latent.hint', 'Latent への変換には .wav 形式の参照音声を使用します。作成済みの Latent ファイル（.pt、.pth）は変換せずに登録します。')}
                                        </p>
                                    </div>
                                    )}

                                    {/* アップロード（フォーク版接続時はLatentも直接アップロード可能。位置はLatent生成の下） */}
                                    <div className="border-t border-line-strong pt-3 space-y-2">
                                        <label className="block text-xs text-fg-muted">
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
                                                className="w-44 bg-surface border border-line-strong text-fg text-sm rounded px-3 py-2 outline-none focus:border-accent"
                                            />
                                            <label className="cursor-pointer max-w-[220px] truncate px-3 py-2 text-sm border border-accent/60 text-accent hover:bg-accent-soft rounded transition-colors">
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
                                                className="px-4 py-2 text-sm bg-accent hover:brightness-110 text-on-accent rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {isUploading ? t('tts.voices.uploading', '登録中...') : t('tts.voices.register', '登録')}
                                            </button>
                                        </div>
                                        {unicodeIdBlocked(uploadVoiceId) && (
                                            <p className="text-xs text-warn">
                                                {t('tts.voices.serverAsciiIdOnly', '接続中のサーバーのVoice IDは英数字・ハイフン・アンダースコアのみ対応です。日本語のVoice IDにはAlSlime対応フォーク版のIrodori-TTS-Serverが必要です。')}
                                            </p>
                                        )}
                                        <p className="text-xs text-fg-muted">
                                            {latentFeaturesAvailable
                                                ? t('tts.voices.uploadHintDirect', '対応形式: wav / flac / mp3 / m4a / ogg / opus / aac / webm / pt / pth。参照音声はv4-Smallで合計120秒まで。')
                                                : t('tts.voices.uploadHint', '対応形式: wav / flac / mp3 / m4a / ogg / opus / aac / webm。参照音声はv4-Smallで合計120秒まで。')}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                        )}

                        {/* 読み上げテスト（声のタブ）。文章は声の一覧の試聴にも使う */}
                        {part === 'voices' && (
                        <div className="border border-line-strong rounded-lg p-4 space-y-3">
                            <div className="flex items-center gap-2 text-sm font-medium text-accent">
                                <Play size={15} className="text-accent" />
                                {t('tts.test.section', '読み上げテスト')}
                            </div>
                            <div>
                                <label className="block text-xs text-fg-muted mb-1" htmlFor="tts-test-text">
                                    {t('tts.test.text', 'テスト用テキスト')}
                                </label>
                                <textarea
                                    id="tts-test-text"
                                    value={effectivePreviewText}
                                    onChange={e => setPreviewText(e.target.value)}
                                    rows={4}
                                    className="w-full bg-surface border border-line-strong text-fg text-sm rounded px-3 py-2 outline-none focus:border-accent resize-y"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-fg-muted mb-1" htmlFor="tts-test-voice">
                                    {t('tts.test.voice', 'テストする音声')}
                                </label>
                                <select
                                    id="tts-test-voice"
                                    value={testTarget}
                                    onChange={e => setTestTarget(e.target.value)}
                                    onFocus={() => {
                                        if (!voicesLoaded && !voicesLoading) void loadVoices();
                                        // 紐づけは別の画面で変わるので、開くたびに読み直す
                                        void loadVoiceCharacters();
                                    }}
                                    className="w-full bg-surface border border-line-strong text-fg text-sm rounded px-2 py-1.5 outline-none focus:border-accent"
                                >
                                    <option value="">{t('tts.test.selectVoice', '音声を選択')}</option>
                                    {voiceCharacters.length > 0 && (
                                        <optgroup label={t('tts.test.characterVoices', 'キャラの声')}>
                                            {voiceCharacters.map(c => (
                                                <option key={c.dirName} value={`${CHARACTER_TEST_PREFIX}${c.dirName}`}>{c.name}</option>
                                            ))}
                                        </optgroup>
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
                                        ? 'bg-danger hover:brightness-110 text-on-accent'
                                        : 'bg-accent hover:brightness-110 text-on-accent'}`}
                                >
                                    {testBusy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                                    {testBusy ? t('tts.test.cancel', 'キャンセル') : t('tts.test.run', 'テスト')}
                                </button>
                                <button
                                    onClick={handleTestReplay}
                                    disabled={!testAudioUrl || testBusy}
                                    className="flex items-center gap-1.5 px-3 py-2 text-sm border border-accent text-accent hover:bg-accent-soft rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Play size={14} />
                                    {t('tts.test.replay', '再生')}
                                </button>
                                {(testBusy || testElapsed > 0) && (
                                    <span className="text-xs text-fg-muted">{testElapsed.toFixed(1)}{t('tts.latent.seconds', '秒')}</span>
                                )}
                            </div>
                        </div>
                        )}

                        {part === 'settings' && (<>
                        {/* 読み上げ範囲・ナレーター設定（要件4章: 読み上げ対象の二択と、地の文の読み方） */}
                        <div className="border border-line-strong rounded-lg overflow-hidden">
                            <button
                                onClick={toggleNarratorSection}
                                className="w-full flex items-center gap-2 px-4 py-3 bg-surface hover:bg-surface text-sm font-medium text-accent transition-colors"
                            >
                                {isNarratorOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                <Mic size={16} className="text-accent" />
                                {t('tts.narrator.section', '読み上げ範囲・ナレーター設定')}
                            </button>
                            {isNarratorOpen && config && (
                                <div className="p-4 space-y-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <label className="text-xs text-fg-muted">
                                            {t('tts.readTarget.label', '読み上げ範囲')}
                                        </label>
                                        <select
                                            value={config.readTarget}
                                            onChange={e => void persistConfigPatch({ readTarget: e.target.value as TTSReadTarget })}
                                            className="bg-surface border border-line-strong text-fg text-sm rounded px-2 py-1.5 outline-none focus:border-accent"
                                        >
                                            <option value="dialogue">{t('tts.readTarget.dialogue', 'セリフのみ')}</option>
                                            <option value="dialogueAndNarration">{t('tts.readTarget.dialogueAndNarration', 'セリフ＋地の文')}</option>
                                        </select>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <label className="text-xs text-fg-muted">
                                            {t('tts.responseFormat.label', '音声形式')}
                                        </label>
                                        <select
                                            value={config.responseFormat}
                                            onChange={e => void persistConfigPatch({ responseFormat: e.target.value as TTSResponseFormat })}
                                            className="bg-surface border border-line-strong text-fg text-sm rounded px-2 py-1.5 outline-none focus:border-accent"
                                        >
                                            <option value="wav">wav</option>
                                            <option value="mp3">mp3</option>
                                        </select>
                                    </div>
                                    <p className="text-xs text-fg-muted">
                                        {t('tts.responseFormat.hint', 'mp3はIrodori-TTS-Server側にmp3エンコーダー（FFmpeg）が必要です。変更は以後の生成から適用されます。')}
                                    </p>
                                    {/* 間の設定: チャンク間の無音（結合と逐次再生で同じ値）と TURN 間の間（通し再生で待つ）。
                                        入力確定（blur / Enter）で保存する。 */}
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                                        <label className="flex items-center gap-2 text-xs text-fg-muted">
                                            {t('tts.gap.chunkSilence', '発言の分け目の無音（秒）')}
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
                                                className="w-20 bg-surface border border-line-strong text-fg text-sm rounded px-2 py-1.5 outline-none focus:border-accent"
                                            />
                                        </label>
                                        <label className="flex items-center gap-2 text-xs text-fg-muted">
                                            {t('tts.gap.turnGap', '発言・応答間の無音（秒）')}
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
                                                className="w-20 bg-surface border border-line-strong text-fg text-sm rounded px-2 py-1.5 outline-none focus:border-accent"
                                            />
                                        </label>
                                    </div>
                                    <p className="text-xs text-fg-muted">
                                        {t('tts.gap.hint', '「発言の分け目の無音」は、長い発言を分けて作った音声どうしの間の長さです。変更内容は、以後に生成する音声へ適用されます。「発言・応答間の無音」は、全体読み上げ、自動再生、自動継続における音声間の間隔です。変更内容は次回の再生から適用されます。')}
                                    </p>
                                    <ToggleSwitch
                                        checked={config.narratorEnabled}
                                        onChange={value => void persistConfigPatch({ narratorEnabled: value })}
                                        label={t('tts.narrator.enabled', '地の文ナレーター読み')}
                                        labelPosition="right"
                                        accent="orange"
                                    />
                                    <div className="flex flex-wrap items-center gap-2">
                                        <label className="text-xs text-fg-muted">
                                            {t('tts.narrator.voice', 'ナレーター用Voice')}
                                        </label>
                                        <select
                                            value={config.narratorVoiceId}
                                            onChange={e => void persistConfigPatch({ narratorVoiceId: e.target.value })}
                                            className="bg-surface border border-line-strong text-fg text-sm rounded px-2 py-1.5 outline-none focus:border-accent"
                                        >
                                            <option value="">{t('tts.charAssign.voiceNone', '（未設定）')}</option>
                                            {/* 保存済みの Voice が一覧に無い（サーバーで消えた・未接続など）ときも、未設定に見えないよう選択肢に残す */}
                                            {config.narratorVoiceId && !voices.some(voice => voice.id === config.narratorVoiceId) && (
                                                <option value={config.narratorVoiceId}>
                                                    {t('tts.narrator.voiceNotInList', '{{name}}（Voice一覧に無い）').split('{{name}}').join(config.narratorVoiceId)}
                                                </option>
                                            )}
                                            {voices.map(voice => (
                                                <option key={voice.id} value={voice.id}>{voice.id}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <p className="text-xs text-fg-muted">
                                        {t('tts.narrator.hint', '読み上げ範囲が「セリフ＋地の文」の場合に、地の文へ使用する音声を設定します。この設定を有効にすると、地の文にはナレーター用の音声が使用されます。無効の場合、またはナレーター用の音声が未設定の場合は、その発言を行ったキャラクターの音声が使用されます。変更内容は自動的に保存されます。')}
                                    </p>
                                    <div className="border-t border-line-strong pt-3 space-y-2">
                                        <ToggleSwitch
                                            checked={config.autoAdvanceEnabled}
                                            onChange={value => void persistConfigPatch({ autoAdvanceEnabled: value })}
                                            label={t('tts.autoAdvance.label', '続きを自動再生')}
                                            labelPosition="right"
                                            accent="orange"
                                        />
                                        <p className="text-xs text-fg-muted">
                                            {t('tts.autoAdvance.hint', '全体読み上げの通し再生で、応答の区切りを超えて、生成済みの次の音声を続けて再生します。変更は即時保存されます。')}
                                        </p>
                                        <div className="pt-1 space-y-1">
                                            <div className="flex items-center justify-between">
                                                <label className="text-xs text-fg-muted">
                                                    {t('tts.volume.label', '再生音量')}
                                                </label>
                                                <span className="text-xs text-fg-muted">{Math.round(config.volume * 100)}%</span>
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
                                                className="w-full accent-accent"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        </>)}
                </div>

            {part === 'settings' && (
            <div className="mt-4">
                        <p className="text-xs text-fg-muted">{t('settings.media.characterVoices', '声の登録は「素材づくり」の声のタブ、キャラごとの声の紐づけはキャラのタブで行います')}</p>
            </div>
            )}
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
