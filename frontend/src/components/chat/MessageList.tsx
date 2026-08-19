/**
 * MessageList.tsx - メッセージ一覧表示コンポーネント
 * 
 * チャットの履歴を表示するコンポーネント。
 * - ユーザー/エージェントのメッセージ表示
 * - 添付ファイル/参照ファイルの展開表示
 * - メッセージ編集UI
 * - リッチなUI表現（吹き出し、アイコン等）
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { Settings as SettingsType } from '../../types/Settings';
import { parseMultiCharacterResponse } from '../../lib/multiCharacterParser';
import type { Message } from '../../hooks/useChat';
import { Edit2, RefreshCw, Palette, Loader2, FileText, X, ImageIcon, Clock, Trash2, Play, Square, Volume2, Music } from 'lucide-react';
import { useTTSReading, ttsHasFinalAudio, ttsFinalAudioDuration, ttsTurnActiveKey, ttsMessageActiveKey } from './useTTSReading';
import { ConfirmDialog } from '../ConfirmDialog';
import type { TTSPlaylistEntry } from './useTTSReading';
import { getTTSConfig } from '../../api/tts';
import type { TTSAudioIndex } from '../../api/tts';
import type { TTSNotice } from './useTTSReading';
import axiosLib from '../../lib/axios';
import { generateFromChat, getAllImageAttachments, resolveAuthedImageUrl, deleteImageAttachment } from '../../api/comfyui';
import type { ImageAttachment } from '../../api/comfyui';
import { FEATURE_ACTION_CHOICE, FEATURE_COMFYUI, isFeatureEnabled } from '../../constants/features';
import { Toast, useToast } from '../common/Toast';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import {
    COMMON_I18N_KEYS,
    COMMON_TEXT_FALLBACK_JA,
    MESSAGE_LIST_I18N_KEYS,
    MESSAGE_LIST_TEXT_FALLBACK_JA,
} from '../../constants/i18n';
import { resolvePersistedChatMessage } from './messageError';
import {
    buildCharacterImageDirectoryMap,
    resolveCharacterImageDirectory,
} from './characterImagePath';
import {
    buildCharacterIconUrlMap,
    resolveCharacterIconUrl,
    type CharacterIconUrlsByDirectory,
} from './characterIconUrls';
import { authFetch } from '../../lib/authFetch';
import { CHARACTER_IMAGES_UPDATED_EVENT } from '../../lib/characterImageEvents';

interface MessageListProps {
    messages: Message[];
    settings: SettingsType;
    editingState: {
        messageId: string;
        turnIndex: number;
        content: string;
    } | null;
    onEditStart: (msgId: string, turnIndex: number, content: string) => void;
    onEditCancel: () => void;
    onEditSave: () => void;
    onEditChange: (content: string) => void;
    onRegenerate: () => void;
    isLoading: boolean;
    backendUrl?: string;
    sessionId?: string;
    /** セッションで選択中のキャラクター設定ファイルパス。画像の物理保存先解決に使う。 */
    characterPaths?: string[];
    onActiveBackgroundChange?: (url: string | null) => void;
    uiCatalog?: I18NCatalog | null;
    // backend の tier gate（機能フラグ）。Chat が一度だけ取得して配布する
    //（再マウントのたびの /api/system/health 取得をやめる。04調査 中#4）。
    enabledFeatures?: Record<string, boolean> | null;
    // 行動選択肢（支援者向け）。最新応答の選択肢と選択状態（useChat が管理）。
    actionChoices?: string[] | null;
    selectedChoice?: string | null;
    onSelectChoice?: (choice: string | null) => void;
    // TTS 読み上げ（支援者向け）。Tier充足かつ TTS 実体連携済みのときのみ true（Chat が判定）。
    ttsEnabled?: boolean;
    // 読み上げ開始時に同梱する会話設定側VoiceDesign（キーはキャラクター名。Chat が現セッション設定から供給）。
    getTTSPresetVoiceDesign?: () => Record<string, { mode: 'append' | 'replace'; text: string }> | undefined;
    // 文体指示の対応絵文字一覧（Chat が起動時に取得して配布）。表示から常時除去する。
    ttsEmojiList?: string[];
}

/**
 * 認証付き生成画像コンポーネント
 * /api/comfyui/images/* は公開ビルドで Bearer 認証必須のため、<img src> の
 * ブラウザ直接GET（Authorizationヘッダなし）では 401 になり表示できない。
 * axios（認証インターセプタ）で blob を取得し objectURL で表示する。
 */
const AuthImg: React.FC<{
    backendUrl: string;
    sessionId: string;
    filename: string;
    alt: string;
    className?: string;
    onClick?: (e: React.MouseEvent<HTMLImageElement>) => void;
}> = ({ backendUrl, sessionId, filename, alt, className, onClick }) => {
    const [src, setSrc] = useState<string | null>(null);
    useEffect(() => {
        let canceled = false;
        resolveAuthedImageUrl(backendUrl, sessionId, filename)
            .then(url => { if (!canceled) setSrc(url); })
            .catch(() => { /* 取得失敗時はプレースホルダのまま */ });
        return () => { canceled = true; };
    }, [backendUrl, sessionId, filename]);
    if (!src) {
        return <div className={`${className || ''} bg-gray-800/60 animate-pulse`} role="img" aria-label={alt} />;
    }
    return <img src={src} alt={alt} className={className} onClick={onClick} />;
};

/**
 * キャラクターアイコンのフォールバックロジック付きコンポーネント
 * 心情画像→default画像→非表示の順でフォールバック
 * size: 表示サイズ（px）
 */
const CharacterIconWithFallback: React.FC<{
    iconUrl: string;
    defaultIconUrl: string | null;
    characterName: string;
    emotion: string;
    size?: number;  // px単位のサイズ
    /** 心情名の表示を呼び出し側から抑止する（バブル左配置では出さない） */
    hideEmotionBadge?: boolean;
}> = ({ iconUrl, defaultIconUrl, characterName, emotion, size = 40, hideEmotionBadge = false }) => {
    const [currentUrl, setCurrentUrl] = useState(iconUrl);
    const [errorCount, setErrorCount] = useState(0);
    const [isHidden, setIsHidden] = useState(false);

    // iconUrlが変わったらリセット
    useEffect(() => {
        setCurrentUrl(iconUrl);
        setErrorCount(0);
        setIsHidden(false);
    }, [iconUrl]);

    const handleError = () => {
        if (errorCount === 0 && defaultIconUrl) {
            // 1回目のエラー: defaultへフォールバック
            setCurrentUrl(defaultIconUrl);
            setErrorCount(1);
        } else {
            // defaultもない、または2回目のエラー: アイコン非表示
            setIsHidden(true);
        }
    };

    if (isHidden) {
        return null;
    }

    // サイズに応じたスタイル
    const isSmall = size <= 40;
    const baseStyles = isSmall
        ? 'rounded-full border-2 border-indigo-500/50 bg-gray-800'
        : 'rounded-lg border-2 border-indigo-500/50 bg-gray-800';

    // バッジスタイル（サイズに応じて調整）。アイコンの右隣に置くため位置指定は持たせない。
    const getBadgeStyles = () => {
        if (size <= 100) return 'text-[10px] bg-gray-900/90 px-1 py-0.5 rounded text-gray-300 border border-gray-600';
        if (size <= 200) return 'text-xs bg-gray-900/90 px-1.5 py-0.5 rounded text-gray-300 border border-gray-600';
        return 'text-sm bg-gray-900/90 px-2 py-1 rounded text-gray-200 border border-gray-600';
    };

    // 心情バッジはアイコンの右隣、下端に揃えて出す。
    // アイコン小（40px以下）では文字が窮屈になるため出さない。
    const showEmotionBadge = emotion !== 'default' && !isSmall && !hideEmotionBadge;

    return (
        <div className="flex items-end gap-1.5 group/icon">
            <img
                src={currentUrl}
                alt={`${characterName} - ${emotion}`}
                className={`object-cover shrink-0 ${baseStyles}`}
                style={{ width: `${size}px`, height: `${size}px` }}
                onError={handleError}
            />
            {/* 心情のバッジ */}
            {showEmotionBadge && (
                <span className={`whitespace-nowrap ${getBadgeStyles()}`}>
                    {emotion}
                </span>
            )}
        </div>
    );
};

/**
 * メッセージ解析: ファイル参照とテキストを分離、ディレクティブを除去
 * （純関数。結果はMessageItem内でuseMemoによりキャッシュされる）
 */
const parseMessage = (content: string | null | undefined) => {
    const safeContent = typeof content === 'string' ? content : '';
    let currentContent = safeContent.replace(/\\n/g, '\n');
    const files: { fileName: string, filePath: string, content: string }[] = [];

    const newRegex = /\[FILE_CONTEXT path="([^"]+)"\]\n([\s\S]*?)\n\[\/FILE_CONTEXT\]/g;
    const oldRegex = /(?:^|\n)(?:以下のファイルを参照してください:\n+)?--- ([^\n]+) ---\n([\s\S]*?)\n---(?:\n|$)/g;
    const combinedRegex = new RegExp(newRegex.source + '|' + oldRegex.source, 'g');

    let text = currentContent.replace(combinedRegex, (_match, p1, p2, p3, p4) => {
        const filePath = p1 || p3;
        const fileContent = p2 || p4;
        if (filePath && fileContent) {
            const fileName = filePath.split(/[/\\]/).pop() || filePath;
            files.push({ fileName, filePath, content: fileContent });
        }
        return '';
    }).trim();

    // ディレクティブパターンを除去（表示時にユーザーに見せない）
    const directivePatterns = [
        // 時刻ディレクティブ（新形式: [CurrentDateTime]タグとその説明文）
        /\[CurrentDateTime\][\s\S]*?\[\/CurrentDateTime\]\nCurrentDateTimeは[\s\S]*?---\s*\n\n/g,
        // 時刻ディレクティブ（新形式: 別パターン - 行末の違いに対応）
        /\[CurrentDateTime\][\s\S]*?\[\/CurrentDateTime\]\n[\s\S]*?禁止されています。\n[\s\S]*?です。\s*\n\n---\s*\n\n/g,
        // 時刻ディレクティブ（新形式: シンプルなパターン - 説明文なしの場合もカバー）
        /\[CurrentDateTime\][^\[]*\[\/CurrentDateTime\]\n[^\[]*?(?:---\s*\n\n|\n\n)/g,
        // 時刻ディレクティブ（旧形式）
        /【重要：現在時刻情報】[\s\S]*?---\s*\n\n/g,
        // 好感度/パラメータディレクティブ
        /【重要：キャラクター感情パラメータ】[\s\S]*?---\s*\n\n/g,
        // 方式Bディレクティブ（新）
        /【ロールプレイ設定ファイル参照】[\s\S]*?設定を混同せず[^。]*。\s*\n\n/g,
        // 方式Bディレクティブ（旧）
        /【キャラクター\/シチュエーション設定ファイル参照】[\s\S]*?設定を混同せず[^。]*。\s*\n\n/g,
        // 複数キャラクター設定ブロック（方式A）
        /【複数キャラクター設定[^】]*】[\s\S]*?設定を混同せず[^。]*。\s*---\s*\n\n/g,
        // シチュエーション設定ブロック（方式A）
        /【シチュエーション設定】[\s\S]*?---\s*\n\n/g,
        // SSRP用: ロールプレイ定義
        /【以下はロールプレイの定義です[^】]*】[\s\S]*?---\s*\n\n/g,
        // SSRP用: 各セクション
        /【世界観設定】[\s\S]*?---\s*\n\n/g,
        /【舞台設定】[\s\S]*?---\s*\n\n/g,
        /【登場キャラクター設定】[\s\S]*?---\s*\n\n/g,
        /【ユーザー設定】[\s\S]*?---\s*\n\n/g,
        // SSRP用: 新形式パラメータブロック（XMLタグ形式）
        /<キャラクター別パラメータ情報>[\s\S]*?<\/キャラクター別パラメータ情報>\s*\n*/g,
        // SSRP用: 旧形式パラメータブロック（後方互換）
        /\[キャラクター別パラメータ情報\][\s\S]*?---\s*\n*/g,
    ];

    for (const pattern of directivePatterns) {
        text = text.replace(pattern, '');
    }

    return { files, text: text.trim() };
};

// キャラクターアイコンURLの決定は characterIconUrls.ts に集約する。
// チャット側で拡張子とキャッシュ更新を独自に組み立てると、
// 会話設定で差し替えた画像が反映されないため。

/**
 * 常に最新の関数を呼ぶ安定参照ラッパー（useEventCallbackパターン）
 * React.memo化した子に渡すコールバックの参照を固定するために使う
 */
function useStableCallback<T extends (...args: any[]) => any>(fn: T): T {
    const ref = useRef(fn);
    useEffect(() => {
        ref.current = fn;
    });
    return useCallback(((...args: any[]) => ref.current(...args)) as T, []);
}

interface EditingState {
    messageId: string;
    turnIndex: number;
    content: string;
}

// stripTTSEmojis は文体指示の対応絵文字を表示用文字列から取り除く（要件9.8の常時除去）。
// 結合絵文字（ゼロ幅接合子連結）が単体絵文字を部分文字列として含むため、長い順に除去する。
const stripTTSEmojis = (text: string, emojis: string[]): string => {
    if (!emojis.length || !text) return text;
    let out = text;
    for (const emoji of [...emojis].sort((a, b) => b.length - a.length)) {
        out = out.split(emoji).join('');
    }
    return out;
};

interface MessageItemProps {
    msg: Message;
    isLast: boolean;
    settings: SettingsType;
    /** このメッセージが編集対象の場合のみ非null（親で絞り込み済み） */
    editingState: EditingState | null;
    attachments: ImageAttachment[] | undefined;
    /** 生成中のTURNキー（`${msgId}::${turnId ?? turnIndex}`）。非生成中はnull */
    generatingKey: string | null;
    /** いずれかのバブルで画像生成中か（ボタンdisabled用） */
    generateDisabled: boolean;
    /** ComfyUI 画像生成機能が有効か */
    canUseComfyUI: boolean;
    isLoading: boolean;
    backendUrl: string;
    sessionId?: string;
    characterImageDirectoryMap: ReadonlyMap<string, string>;
    /** 物理ディレクトリ名→心情ごとのアイコンURL（バックエンド解決済み）。 */
    characterIconUrls: CharacterIconUrlsByDirectory;
    /** 背景画像が表示中か（バブルの塗り分けに使用。URL自体には依存させない） */
    hasActiveBackground: boolean;
    onEditStart: (msgId: string, turnIndex: number, content: string) => void;
    onEditCancel: () => void;
    onEditSave: () => void;
    onEditChange: (content: string) => void;
    onRegenerate: () => void;
    onGenerate: (msgId: string, turnId: string | null, turnIndex: number) => void;
    /** turnKey は画像が属するチャットバブルのキー（`${msgId}::${turnId ?? turnIndex}`）。背景の手動選択に使う */
    onOpenImage: (att: ImageAttachment, msgId?: string, turnKey?: string) => void;
    uiCatalog: I18NCatalog | null;
    /** TTS 読み上げ機能が有効か（Tier充足かつサイドカー/in-process連携済み） */
    ttsEnabled: boolean;
    /** 文体指示の対応絵文字一覧（表示からの常時除去用） */
    ttsEmojiList: string[];
    ttsIndex: TTSAudioIndex | null;
    /** 実行中の読み上げ対象キー（turn:.../msg:...）。非実行中は null */
    ttsActiveKey: string | null;
    ttsCancelling: boolean;
    ttsNotice: TTSNotice | null;
    ttsPlayingFinalKey: string | null;
    /** 通し再生（全体読み上げ・自動継続）の実行中。停止してからでないと他の個別再生は押せない */
    ttsSequenceActive: boolean;
    /** 通し再生で今鳴っている TURN のキー（そのTURNのボタンだけ「停止」として押せる） */
    ttsSequenceCurrentKey: string | null;
    onTTSStart: (messageId: string, turnId?: string) => void;
    onTTSCancel: () => void;
    onTTSPlayFinal: (messageId: string, turnId: string) => void;
    onTTSStopFinal: () => void;
    /** 通し再生の停止（再生中TURNの「停止」ボタン用） */
    onTTSStopPlayback: () => void;
    onTTSDeleteAudio: (messageId: string) => void;
}

/**
 * メッセージ1件の表示コンポーネント
 * React.memo + useMemoにより、メッセージ内容が変わらない限り
 * 重いパース処理（正規表現・TURN分割・行処理）の再実行と再レンダーを回避する
 */
const MessageItem = React.memo<MessageItemProps>(({
    msg,
    isLast,
    settings,
    editingState,
    attachments,
    generatingKey,
    generateDisabled,
    canUseComfyUI,
    isLoading,
    backendUrl,
    sessionId,
    characterImageDirectoryMap,
    characterIconUrls,
    hasActiveBackground,
    onEditStart,
    onEditCancel,
    onEditSave,
    onEditChange,
    onRegenerate,
    onGenerate,
    onOpenImage,
    uiCatalog,
    ttsEnabled,
    ttsEmojiList,
    ttsIndex,
    ttsActiveKey,
    ttsCancelling,
    ttsNotice,
    ttsPlayingFinalKey,
    ttsSequenceActive,
    ttsSequenceCurrentKey,
    onTTSStart,
    onTTSCancel,
    onTTSPlayFinal,
    onTTSStopFinal,
    onTTSStopPlayback,
    onTTSDeleteAudio
}) => {
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        MESSAGE_LIST_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key
    );
    // TTS 文言はインライン fallback 方式（catalog.go の tts.* キー）。
    const tt = (key: string, fallback: string) => resolveMessage(uiCatalog, key, fallback);
    const displayContent = React.useMemo(
        () => resolvePersistedChatMessage(msg, uiCatalog),
        [msg, uiCatalog]
    );

    // パース結果をメモ化: 表示本文が変わらない限り再計算しない
    const { files, text } = React.useMemo(() => parseMessage(displayContent), [displayContent]);

    // agentメッセージのTURN分割と行処理（連続空行まとめ）もメモ化
    const processedTurns = React.useMemo(() => {
        if (msg.role !== 'agent' || !text) return null;
        return parseMultiCharacterResponse(text).map(turn => {
            // 対応絵文字（文体指示）は表示行の生成時にだけ除去する。
            // turn.content 自体は無加工に保つ（編集開始の初期値に使うため、
            // ここで除去すると編集保存で本文から絵文字が消えてしまう）。
            let lines = stripTTSEmojis(turn.content, ttsEmojiList).split(/\r?\n/);
            if (settings.collapseEmptyLines) {
                lines = lines.reduce((acc: string[], line) => {
                    const isEmptyLine = line.trim() === '';
                    const lastWasEmpty = acc.length > 0 && acc[acc.length - 1].trim() === '';
                    if (isEmptyLine && lastWasEmpty) {
                        return acc; // 連続空行をスキップ
                    }
                    return [...acc, line];
                }, []);
            }
            return { turn, lines };
        });
    }, [msg.role, text, settings.collapseEmptyLines, ttsEmojiList]);

    // 添付画像を表示先TURNへ解決する（turnId優先→turnIndex→未照合は末尾表示）。
    const { attachmentsByTurn, unresolvedAttachments } = React.useMemo(() => {
        const byTurn = new Map<number, ImageAttachment[]>();
        const unresolved: ImageAttachment[] = [];
        for (const att of attachments ?? []) {
            let resolved: number | null = null;
            if (att.turnId && processedTurns) {
                const hit = processedTurns.find(pt => pt.turn.turnId === att.turnId);
                if (hit) resolved = hit.turn.index;
            }
            if (resolved === null && typeof att.turnIndex === 'number' && processedTurns) {
                const hit = processedTurns.find(pt => pt.turn.index === att.turnIndex);
                if (hit) resolved = hit.turn.index;
            }
            if (resolved === null) {
                unresolved.push(att);
            } else {
                byTurn.set(resolved, [...(byTurn.get(resolved) ?? []), att]);
            }
        }
        return { attachmentsByTurn: byTurn, unresolvedAttachments: unresolved };
    }, [attachments, processedTurns]);

    // TURNへ照合できなかった添付は末尾TURN扱い（背景の手動選択キーも末尾TURNへ揃える）
    const lastTurnKey = React.useMemo(() => {
        if (!msg.id || !processedTurns || processedTurns.length === 0) return undefined;
        const last = processedTurns[processedTurns.length - 1].turn;
        return `${msg.id}::${last.turnId ?? last.index}`;
    }, [msg.id, processedTurns]);

    return (
        <div
            data-msg-id={msg.id}
            className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} relative z-[1]`}
        >
            {/* ファイル参照 (バブル外) */}
            {files.length > 0 && (
                <div className={`flex flex-col gap-2 mb-2 w-full max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    {files.map((file, idx) => (
                        <div key={idx} className="bg-gray-900/50 border border-gray-700 rounded-lg overflow-hidden w-fit max-w-full shadow-sm">
                            <details className="group">
                                <summary className="px-3 py-2 text-xs text-gray-400 cursor-pointer hover:bg-gray-800 flex items-center gap-2 select-none">
                                    <FileText size={14} className="text-blue-400 shrink-0" />
                                    <span className="font-medium text-gray-300 group-open:text-white">{file.fileName}</span>
                                    <span className="text-gray-600 ml-auto text-[10px] truncate max-w-[200px]">{file.filePath}</span>
                                </summary>
                                <div className="p-3 bg-gray-950/80 border-t border-gray-700/50 overflow-x-auto">
                                    <div className="text-xs font-mono text-gray-300 leading-normal w-full flex flex-col">
                                        {file.content.split(/\r?\n/).map((line, lineIdx) => (
                                            <div
                                                key={lineIdx}
                                                className="min-h-[1.25em] w-full break-all whitespace-pre-wrap"
                                                style={{ wordBreak: 'break-all', overflowWrap: 'break-word' }}
                                            >
                                                {line || ' '}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </details>
                        </div>
                    ))}
                </div>
            )}

            {/* メッセージ本文 */}
            {text && (() => {
                // agentメッセージの場合、複数キャラクター形式をパース（パース済み）
                if (msg.role === 'agent' && processedTurns) {
                    return (
                        <div className="flex flex-col gap-3 w-full">
                            {processedTurns.map(({ turn, lines }, turnIdx) => {
                                // 背景画像判定用のバブル識別キー（生成中キーと同じ規約）
                                const turnKey = msg.id ? `${msg.id}::${turn.turnId ?? turn.index}` : undefined;
                                // 編集モード判定（editingStateは親でこのメッセージ分のみに絞り込み済み）
                                const isEditing = editingState !== null && editingState.turnIndex === turn.index;

                                if (isEditing && editingState) {
                                    return (
                                        <div
                                            key={turnIdx}
                                            data-turn-key={turnKey}
                                            data-msg-id={msg.id}
                                            data-turn-id={turn.turnId ?? undefined}
                                            data-turn-index={turn.index}
                                            className="w-full max-w-[85%] bg-gray-800 p-3 rounded-lg border border-blue-500/50"
                                        >
                                            <textarea
                                                className="w-full bg-gray-900 text-white p-3 rounded border border-gray-700 focus:border-blue-500 outline-none resize-none font-sans text-sm leading-relaxed"
                                                value={editingState.content}
                                                onChange={(e) => onEditChange(e.target.value)}
                                                rows={Math.max(3, editingState.content.split('\n').length)}
                                                autoFocus
                                            />
                                            <div className="flex justify-end gap-2 mt-2">
                                                <button
                                                    onClick={onEditCancel}
                                                    className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                                                >
                                                    {t(COMMON_I18N_KEYS.cancel)}
                                                </button>
                                                <button
                                                    onClick={onEditSave}
                                                    className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors flex items-center gap-1"
                                                >
                                                    {t(COMMON_I18N_KEYS.save)}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                }

                                // 各TURNの時刻: turnTimes[turnIdx]を優先、無ければsessionTimeにフォールバック（後方互換）
                                const turnTime = msg.turnTimes?.[turnIdx] ?? msg.sessionTime;
                                const emotion = turn.emotion || 'default';
                                const iconSize = settings.characterIconSize || 40;
                                // アイコンをバブル左へ置くのは 100px 以上のときだけ。
                                // 小サイズでは横幅を取られてバブルが潰れるため適用しない。
                                const iconOnBubbleLeft = !!settings.characterIconOnBubbleLeft && iconSize >= 100;

                                const timeLabel = turnTime ? (
                                    <div className="flex items-center gap-1.5 text-sm text-blue-400/80 mb-1 ml-1 font-mono">
                                        <Clock size={14} />
                                        {turnTime.year}/{String(turnTime.month).padStart(2, '0')}/{String(turnTime.day).padStart(2, '0')} {String(turnTime.hour).padStart(2, '0')}:{String(turnTime.minute).padStart(2, '0')}:{String(turnTime.second || 0).padStart(2, '0')}
                                    </div>
                                ) : null;

                                // このバブルが生成中かどうか（スピナー表示用）
                                const isTurnGenerating = generatingKey !== null && generatingKey === `${msg.id}::${turn.turnId ?? turn.index}`;
                                // このTURNに紐づく生成画像（バブル直下へ表示）
                                const turnAttachments = attachmentsByTurn.get(turn.index);
                                const turnAttachmentRow = msg.id && turnAttachments && turnAttachments.length > 0 ? (
                                    <div className="flex flex-wrap gap-2 ml-1 mt-1">
                                        {turnAttachments.map((att) => (
                                            <AuthImg
                                                key={att.id}
                                                backendUrl={backendUrl}
                                                sessionId={sessionId!}
                                                filename={att.filename}
                                                alt={t(MESSAGE_LIST_I18N_KEYS.generatedImageAlt)}
                                                className="w-24 h-24 object-cover rounded-lg border border-gray-700 cursor-pointer hover:border-purple-500 transition-colors"
                                                onClick={() => onOpenImage(att, msg.id, turnKey)}
                                            />
                                        ))}
                                    </div>
                                ) : null;

                                const characterName = turn.character;
                                const characterIcon = characterName ? (() => {
                                    const imageDirectory = resolveCharacterImageDirectory(characterName, characterImageDirectoryMap);
                                    const iconUrlsForCharacter = characterIconUrls[imageDirectory];
                                    const iconUrl = resolveCharacterIconUrl(backendUrl, imageDirectory, emotion, iconUrlsForCharacter);
                                    const defaultIconUrl = emotion !== 'default'
                                        ? resolveCharacterIconUrl(backendUrl, imageDirectory, 'default', iconUrlsForCharacter)
                                        : null;
                                    return (
                                        <CharacterIconWithFallback
                                            iconUrl={iconUrl}
                                            defaultIconUrl={defaultIconUrl}
                                            characterName={characterName}
                                            emotion={emotion}
                                            size={iconSize}
                                            hideEmotionBadge={iconOnBubbleLeft}
                                        />
                                    );
                                })() : null;

                                const characterNameLabel = characterName ? (
                                    <div className="text-base font-bold text-indigo-300 tracking-wide">
                                        {characterName}
                                    </div>
                                ) : null;

                                const bubble = (
                                        <div
                                            className={`group relative p-4 rounded-xl shadow-md border transition-all ${turn.character
                                                ? 'border-indigo-600/40 text-gray-100'
                                                : 'border-gray-700 text-gray-200'
                                            }`}
                                            style={{
                                                backgroundColor: turn.character
                                                    ? `rgba(30, 27, 75, ${hasActiveBackground ? (settings.messageBubbleOpacity ?? 0.8) : 0.85})`
                                                    : `rgba(31, 41, 55, ${hasActiveBackground ? (settings.messageBubbleOpacity ?? 0.8) : 0.85})`,
                                            }}
                                        >

                                            {/* 編集ボタン（モバイル: 常時表示、デスクトップ: ホバー時表示） */}
                                            <button
                                                onClick={() => onEditStart(msg.id!, turn.index, turn.content)}
                                                className="absolute top-2 right-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white"
                                                title={t(MESSAGE_LIST_I18N_KEYS.editThisMessage)}
                                            >
                                                <Edit2 size={12} />
                                            </button>

                                            <div
                                                className="whitespace-pre-wrap leading-relaxed"
                                                style={{
                                                    fontSize: `${settings.fontSize}px`,
                                                    lineHeight: settings.lineHeight || 1.625
                                                }}
                                            >
                                                {lines.map((line, idx) => {
                                                    const isEmpty = line.trim() === '';
                                                    return (
                                                        <div
                                                            key={idx}
                                                            style={{
                                                                height: isEmpty ? `${settings.emptyLineHeight}em` : 'auto',
                                                                minHeight: isEmpty ? '0' : '1em',
                                                                lineHeight: isEmpty ? '0' : (settings.lineHeight || 1.625)
                                                            }}
                                                        >
                                                            {isEmpty ? <br /> : (line || ' ')}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                );

                                // TURN毎の読み上げ・再生ボタン（要件9.3。作成済みは再作成へ切替、再生ボタンは作成済みのみ）
                                const ttsTurnButtons = (() => {
                                    if (!ttsEnabled || !msg.id || !turn.turnId || !sessionId || isLoading) return null;
                                    const turnActiveKey = ttsTurnActiveKey(msg.id, turn.turnId);
                                    const isTurnReading = ttsActiveKey === turnActiveKey;
                                    const hasAudio = ttsHasFinalAudio(ttsIndex, msg.id, turn.turnId);
                                    const audioDuration = ttsFinalAudioDuration(ttsIndex, msg.id, turn.turnId);
                                    const isFinalPlaying = ttsPlayingFinalKey === turnActiveKey;
                                    const noticeHere = ttsNotice !== null && ttsNotice.targetKey === turnActiveKey;
                                    // 同一応答内の相互排他（要件9.7）: 他の実行中は開始できない。
                                    const otherActive = ttsActiveKey !== null && !isTurnReading;
                                    return (
                                        <>
                                            {noticeHere && (
                                                <span className="text-[11px] text-red-300">
                                                    {tt(`tts.skip.${ttsNotice.reason}`, tt('tts.skip.generic', '読み上げできませんでした'))}
                                                </span>
                                            )}
                                            {hasAudio && (() => {
                                                // 通し再生中: 今鳴っているTURNのボタンだけ「停止」として押せる。他は停止するまで押せない。
                                                const isSequencePlayingHere = ttsSequenceActive && ttsSequenceCurrentKey === turnActiveKey;
                                                const showStop = isFinalPlaying || isSequencePlayingHere;
                                                const lockedBySequence = ttsSequenceActive && !isSequencePlayingHere;
                                                return (
                                                <button
                                                    onClick={() => {
                                                        if (isSequencePlayingHere) onTTSStopPlayback();
                                                        else if (isFinalPlaying) onTTSStopFinal();
                                                        else onTTSPlayFinal(msg.id!, turn.turnId!);
                                                    }}
                                                    disabled={lockedBySequence}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-orange-300 hover:text-white bg-orange-900/20 hover:bg-orange-800/50 border border-orange-600/40 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                    title={lockedBySequence
                                                        ? tt('tts.button.playLockedBySequence', '全体再生中は停止してから操作できます')
                                                        : showStop ? tt('tts.button.stop', '停止') : tt('tts.button.play', '再生')}
                                                >
                                                    {showStop ? <Square size={14} /> : <Play size={14} />}
                                                    <span>{showStop ? tt('tts.button.stop', '停止') : tt('tts.button.play', '再生')}</span>
                                                    {audioDuration && (
                                                        <span className="text-orange-400/70">{audioDuration}</span>
                                                    )}
                                                </button>
                                                );
                                            })()}
                                            <button
                                                onClick={() => isTurnReading ? onTTSCancel() : onTTSStart(msg.id!, turn.turnId!)}
                                                disabled={otherActive || (isTurnReading && ttsCancelling)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-orange-300 hover:text-white bg-orange-900/20 hover:bg-orange-800/50 border border-orange-600/40 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                title={isTurnReading
                                                    ? tt('tts.button.cancel', 'キャンセル')
                                                    : hasAudio ? tt('tts.button.recreate', '再作成') : tt('tts.button.read', '読み上げ')}
                                            >
                                                {isTurnReading ? (
                                                    <Loader2 size={14} className="animate-spin" />
                                                ) : hasAudio ? (
                                                    // 「再作成」は言葉で伝わるので、アイコンは何を作り直すか（音声）を示す♪にする
                                                    <Music size={14} />
                                                ) : (
                                                    <Volume2 size={14} />
                                                )}
                                                <span>{isTurnReading
                                                    ? (ttsCancelling ? tt('tts.button.cancelling', 'キャンセル中...') : tt('tts.button.cancel', 'キャンセル'))
                                                    : hasAudio ? tt('tts.button.recreate', '再作成') : tt('tts.button.read', '読み上げ')}</span>
                                            </button>
                                        </>
                                    );
                                })();

                                // 画像生成ボタン（TURN毎。バブル直下に文字ラベル付きで常時表示。timeLabelの有無とは独立）
                                const generateButtonRow = (canUseComfyUI || ttsTurnButtons !== null) && msg.id && sessionId && !isLoading ? (
                                    <div className="mt-1.5 flex justify-end items-center gap-1.5">
                                        {ttsTurnButtons}
                                        {canUseComfyUI && (
                                            <button
                                                onClick={() => onGenerate(msg.id!, turn.turnId, turn.index)}
                                                disabled={generateDisabled}
                                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-purple-300 hover:text-white bg-purple-900/20 hover:bg-purple-800/50 border border-purple-600/40 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                title={t(MESSAGE_LIST_I18N_KEYS.imageGenerate)}
                                            >
                                                {isTurnGenerating ? (
                                                    <Loader2 size={14} className="animate-spin" />
                                                ) : (
                                                    <Palette size={14} />
                                                )}
                                                <span>{t(MESSAGE_LIST_I18N_KEYS.imageGenerate)}</span>
                                            </button>
                                        )}
                                    </div>
                                ) : null;

                                // アイコンをバブル左へ置く配置。アイコンとバブルの下端を揃える。
                                if (iconOnBubbleLeft && characterName) {
                                    return (
                                        <div
                                            key={turnIdx}
                                            data-turn-key={turnKey}
                                            data-msg-id={msg.id}
                                            data-turn-id={turn.turnId ?? undefined}
                                            data-turn-index={turn.index}
                                            className="flex flex-col w-fit max-w-[85%]"
                                        >
                                            {timeLabel}
                                            <div className="flex items-end gap-2">
                                                <div className="shrink-0">{characterIcon}</div>
                                                <div className="flex flex-col min-w-0">
                                                    <div className="mb-1">{characterNameLabel}</div>
                                                    {bubble}
                                                </div>
                                            </div>
                                            {generateButtonRow}
                                            {turnAttachmentRow}
                                        </div>
                                    );
                                }

                                return (
                                    <div
                                        key={turnIdx}
                                        data-turn-key={turnKey}
                                        data-msg-id={msg.id}
                                        data-turn-id={turn.turnId ?? undefined}
                                        data-turn-index={turn.index}
                                        className="flex flex-col w-fit max-w-[85%]"
                                    >
                                        {/* セッション時刻（各TURN個別の絶対時刻） */}
                                        {timeLabel}
                                        {/* キャラクター名ラベル（バブル外、アイコン付き） */}
                                        {characterName && (
                                            iconSize > 40 ? (
                                                // 大サイズ: キャラ名の下にアイコン
                                                <div className="flex flex-col items-start mb-2">
                                                    <div className="mb-1">{characterNameLabel}</div>
                                                    {characterIcon}
                                                </div>
                                            ) : (
                                                // 小サイズ（デフォルト）: 横並び
                                                <div className="flex items-center gap-2 mb-1">
                                                    {characterIcon}
                                                    {characterNameLabel}
                                                </div>
                                            )
                                        )}

                                        {/* メッセージバブル */}
                                        {bubble}
                                        {generateButtonRow}
                                        {turnAttachmentRow}
                                    </div>
                                );
                            })}

                            {/* 画像添付サムネイル（TURNへ照合できなかった分: 旧データ・編集でTURN消失分） */}
                            {msg.id && unresolvedAttachments.length > 0 && (
                                <div className="flex flex-wrap gap-2 ml-1 mt-1">
                                    {unresolvedAttachments.map((att) => (
                                        <AuthImg
                                            key={att.id}
                                            backendUrl={backendUrl}
                                            sessionId={sessionId!}
                                            filename={att.filename}
                                            alt={t(MESSAGE_LIST_I18N_KEYS.generatedImageAlt)}
                                            className="w-24 h-24 object-cover rounded-lg border border-gray-700 cursor-pointer hover:border-purple-500 transition-colors"
                                            onClick={() => onOpenImage(att, msg.id, lastTurnKey)}
                                        />
                                    ))}
                                </div>
                            )}

                            {/* モデル名と再生成・1応答全体読み上げボタン (横並び。画像生成ボタンはTURN毎のバブル内へ移設) */}
                            <div className="flex items-center gap-3 ml-1 mt-[-4px]">
                                {msg.model && (
                                    <div className="text-[10px] text-gray-500">
                                        Generated by {msg.model}
                                    </div>
                                )}
                                {isLast && !isLoading && (
                                    <button
                                        onClick={onRegenerate}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-full transition-colors"
                                        title={t(MESSAGE_LIST_I18N_KEYS.regenerate)}
                                    >
                                        <RefreshCw size={12} />
                                        <span>{t(MESSAGE_LIST_I18N_KEYS.regenerate)}</span>
                                    </button>
                                )}
                                {ttsEnabled && msg.id && sessionId && !isLoading && (() => {
                                    const messageKey = ttsMessageActiveKey(msg.id);
                                    const isMessageReading = ttsActiveKey === messageKey;
                                    const otherActive = ttsActiveKey !== null && !isMessageReading;
                                    const noticeHere = ttsNotice !== null && ttsNotice.targetKey === messageKey;
                                    const hasAnyAudio = ttsIndex !== null
                                        && Object.values(ttsIndex.entries).some(entry => entry.messageId === msg.id);
                                    return (
                                        <>
                                            {noticeHere && (
                                                <span className="text-[11px] text-red-300">
                                                    {tt(`tts.skip.${ttsNotice.reason}`, tt('tts.skip.generic', '読み上げできませんでした'))}
                                                </span>
                                            )}
                                            <button
                                                onClick={() => isMessageReading ? onTTSCancel() : onTTSStart(msg.id!)}
                                                disabled={otherActive || (isMessageReading && ttsCancelling)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-orange-300 hover:text-white hover:bg-orange-900/30 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                title={isMessageReading ? tt('tts.button.cancel', 'キャンセル') : tt('tts.button.readAll', '全体読み上げ')}
                                            >
                                                {isMessageReading ? (
                                                    <Loader2 size={12} className="animate-spin" />
                                                ) : (
                                                    <Volume2 size={12} />
                                                )}
                                                <span>{isMessageReading
                                                    ? (ttsCancelling ? tt('tts.button.cancelling', 'キャンセル中...') : tt('tts.button.cancel', 'キャンセル'))
                                                    : tt('tts.button.readAll', '全体読み上げ')}</span>
                                            </button>
                                            {hasAnyAudio && (
                                                <button
                                                    onClick={() => onTTSDeleteAudio(msg.id!)}
                                                    disabled={ttsActiveKey !== null}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-orange-300 hover:text-white hover:bg-orange-900/30 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                    title={tt('tts.button.deleteAudio', '音声を削除')}
                                                >
                                                    <Trash2 size={12} />
                                                    <span>{tt('tts.button.deleteAudio', '音声を削除')}</span>
                                                </button>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>
                        </div>
                    );
                }

                // ユーザーメッセージの編集モード判定（turnIndex=0、editingStateは絞り込み済み）
                const isUserEditing = editingState !== null && editingState.turnIndex === 0;

                if (isUserEditing && editingState) {
                    return (
                        <div
                            data-turn-key={msg.id ? `${msg.id}::0` : undefined}
                            data-msg-id={msg.id}
                            className="w-full max-w-[85%] bg-blue-800 p-3 rounded-lg border border-blue-500/50"
                        >
                            <textarea
                                className="w-full bg-gray-900 text-white p-3 rounded border border-gray-700 focus:border-blue-500 outline-none resize-none font-sans text-sm leading-relaxed"
                                value={editingState.content}
                                onChange={(e) => onEditChange(e.target.value)}
                                rows={Math.max(3, editingState.content.split('\n').length)}
                                autoFocus
                            />
                            <div className="flex justify-end gap-2 mt-2">
                                <button
                                    onClick={onEditCancel}
                                    className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                                >
                                    {t(COMMON_I18N_KEYS.cancel)}
                                </button>
                                <button
                                    onClick={onEditSave}
                                    className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors flex items-center gap-1"
                                >
                                    {t(COMMON_I18N_KEYS.save)}
                                </button>
                            </div>
                        </div>
                    );
                }

                return (
                    <div
                        data-turn-key={msg.id ? `${msg.id}::0` : undefined}
                        data-msg-id={msg.id}
                        className="group relative p-4 rounded-xl max-w-[85%] shadow-md border border-blue-500/40 text-gray-100"
                        style={{
                            backgroundColor: `rgba(30, 58, 138, ${hasActiveBackground ? (settings.messageBubbleOpacity ?? 0.8) : 0.7})`,
                        }}
                    >
                        {/* ユーザーメッセージ編集ボタン（モバイル: 常時表示、デスクトップ: ホバー時表示） */}
                        <button
                            onClick={() => onEditStart(msg.id!, 0, text)}
                            className="absolute top-2 right-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity p-1 hover:bg-white/20 rounded text-white/60 hover:text-white"
                            title={t(MESSAGE_LIST_I18N_KEYS.editThisMessage)}
                        >
                            <Edit2 size={12} />
                        </button>
                        <div
                            className="whitespace-pre-wrap leading-relaxed"
                            style={{
                                fontSize: `${settings.fontSize}px`,
                                lineHeight: settings.lineHeight || 1.625
                            }}
                        >
                            {text}
                        </div>
                    </div>
                );
            })()}
        </div>
    );
});
MessageItem.displayName = 'MessageItem';

export const MessageList: React.FC<MessageListProps> = ({
    messages,
    settings,
    editingState,
    onEditStart,
    onEditCancel,
    onEditSave,
    onEditChange,
    onRegenerate,
    isLoading,
    backendUrl = '',
    sessionId,
    characterPaths = [],
    onActiveBackgroundChange,
    uiCatalog = null,
    enabledFeatures = null,
    actionChoices = null,
    selectedChoice = null,
    ttsEnabled = false,
    ttsEmojiList = [],
    getTTSPresetVoiceDesign,
    onSelectChoice
}) => {
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        MESSAGE_LIST_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key
    );
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const characterImageDirectoryMap = React.useMemo(
        () => buildCharacterImageDirectoryMap(characterPaths),
        [characterPaths]
    );
    // 画像を取得すべき物理ディレクトリ名。参照が毎回変わると再取得が止まらないため
    // 並びを固定したキーに畳んでから配列へ戻す。
    const characterImageDirectoriesKey = React.useMemo(
        () => Array.from(new Set(characterImageDirectoryMap.values())).sort().join('\n'),
        [characterImageDirectoryMap]
    );
    // 物理ディレクトリ名→心情ごとのアイコンURL。
    // 拡張子の実在解決とハッシュ付与はバックエンドの /api/characters/{name}/images に任せる。
    const [characterIconUrls, setCharacterIconUrls] = useState<CharacterIconUrlsByDirectory>({});
    // 画像管理側での差し替え通知を受けてアイコンURLを取り直すための再取得キー
    const [iconRefreshKey, setIconRefreshKey] = useState(0);

    useEffect(() => {
        const handler = () => setIconRefreshKey(k => k + 1);
        window.addEventListener(CHARACTER_IMAGES_UPDATED_EVENT, handler);
        return () => window.removeEventListener(CHARACTER_IMAGES_UPDATED_EVENT, handler);
    }, []);

    useEffect(() => {
        // backendUrl の空文字は同一オリジン（Go 同梱フロント）を意味するため、
        // 未設定扱いにして取得を止めない。
        const directories = characterImageDirectoriesKey ? characterImageDirectoriesKey.split('\n') : [];
        if (directories.length === 0) {
            setCharacterIconUrls({});
            return;
        }

        let cancelled = false;
        (async () => {
            const entries = await Promise.all(directories.map(async (directory) => {
                try {
                    const response = await authFetch(
                        `${backendUrl}/api/characters/${encodeURIComponent(directory)}/images`
                    );
                    const data = await response.json();
                    if (!data?.success) return null;
                    return [directory, buildCharacterIconUrlMap(data.data?.images)] as const;
                } catch (error) {
                    console.error('[MessageList] Failed to fetch character icon URLs:', directory, error);
                    return null;
                }
            }));
            if (cancelled) return;

            const next: CharacterIconUrlsByDirectory = {};
            for (const entry of entries) {
                if (entry) next[entry[0]] = entry[1];
            }
            setCharacterIconUrls(next);
        })();

        return () => { cancelled = true; };
    }, [characterImageDirectoriesKey, backendUrl, iconRefreshKey]);

    // 画像生成
    // 生成中バブルのキー（`${msgId}::${turnId ?? turnIndex}`）。セッション内同時1件を維持。
    const [generatingKey, setGeneratingKey] = useState<string | null>(null);
    const [imageAttachments, setImageAttachments] = useState<Record<string, ImageAttachment[]>>({});
    const [expandedAttachment, setExpandedAttachment] = useState<ImageAttachment | null>(null);
    const [expandedMsgId, setExpandedMsgId] = useState<string | null>(null);
    // 拡大表示中の画像が属するバブルキー（背景の手動選択をTURN単位で保存するため）
    const [expandedTurnKey, setExpandedTurnKey] = useState<string | null>(null);
    // 拡大表示中の画像の削除確認モーダル表示・削除実行中
    const [confirmingDeleteImage, setConfirmingDeleteImage] = useState(false);
    const [deletingImage, setDeletingImage] = useState(false);
    const [showExpandedPrompt, setShowExpandedPrompt] = useState(false);
    // アンマウント後のポーリング継続・setState を止めるフラグ（04調査 中#3）。
    const disposedRef = useRef(false);
    useEffect(() => {
        disposedRef.current = false;
        return () => { disposedRef.current = true; };
    }, []);

    // トースト通知
    const { messages: toastMessages, showToast, dismissToast } = useToast();

    // 背景画像用state
    const [activeBackgroundUrl, setActiveBackgroundUrl] = useState<string | null>(null);
    // 可視中のチャットバブル（TURN）キー集合（`${msgId}::${turnId ?? turnIndex}`）
    const [visibleTurnKeys, setVisibleTurnKeys] = useState<Set<string>>(new Set());
    // バブルごとの背景画像手動選択（turnKey → attachmentのfilename。旧データはmsgIdキー）- sessionId単位でlocalStorageに永続化
    const [backgroundOverrides, setBackgroundOverrides] = useState<Record<string, string>>({});

    // sessionId変更時にlocalStorageから背景オーバーライドを読み込む
    useEffect(() => {
        if (!sessionId) {
            setBackgroundOverrides({});
            return;
        }
        try {
            const stored = localStorage.getItem(`bg-overrides-${sessionId}`);
            setBackgroundOverrides(stored ? JSON.parse(stored) : {});
        } catch {
            setBackgroundOverrides({});
        }
    }, [sessionId]);
    const containerRef = useRef<HTMLDivElement>(null);
    const useChatAreaBackground =
        settings.enableBackgroundImage &&
        (settings.backgroundImageFit ?? 'cover') === 'cover' &&
        (settings.backgroundImageScope ?? 'history') === 'chat';
    const canUseComfyUI = isFeatureEnabled(enabledFeatures, FEATURE_COMFYUI);
    const canUseActionChoice = isFeatureEnabled(enabledFeatures, FEATURE_ACTION_CHOICE);
    // TTS 読み上げの実行状態（開始・ポーリング・逐次再生・キャンセル・作成済み索引）。
    const tts = useTTSReading(backendUrl, sessionId ?? null, ttsEnabled, getTTSPresetVoiceDesign);
    // Sticky 停止ボタンの表示設定（tts_config.json の stopButtonEnabled）。
    // マウント時と再生開始時に読み、トグル変更は次の再生開始時に追随する。
    const [stopButtonVisible, setStopButtonVisible] = useState(false);
    // 応答単位の音声削除の確認対象（messageId。null は非表示）。
    const [ttsDeleteTarget, setTtsDeleteTarget] = useState<string | null>(null);
    useEffect(() => {
        if (!ttsEnabled) {
            setStopButtonVisible(false);
            return;
        }
        let disposed = false;
        getTTSConfig(backendUrl)
            .then(cfg => { if (!disposed) setStopButtonVisible(cfg.stopButtonEnabled); })
            .catch(() => { /* 未接続時は非表示のまま */ });
        return () => { disposed = true; };
    }, [ttsEnabled, backendUrl]);

    // 自動読み上げ（要件4章: 応答受信の正常完了時に1応答全体の生成を自動開始。
    // 生成のみで自動再生はしない）。isLoading の true→false 遷移で待ちフラグを立て、
    // 履歴再読み込みで最後の agent メッセージへ ID が付いた時点で一度だけ発火する。
    // エラー応答・ユーザーの次送信・セッション切替ではフラグを破棄する。
    const autoReadArmedRef = useRef(false);
    const prevTtsLoadingRef = useRef(isLoading);
    useEffect(() => {
        if (prevTtsLoadingRef.current && !isLoading) {
            autoReadArmedRef.current = true;
        }
        prevTtsLoadingRef.current = isLoading;
    }, [isLoading]);
    useEffect(() => {
        autoReadArmedRef.current = false;
    }, [sessionId]);
    useEffect(() => {
        if (!autoReadArmedRef.current || !ttsEnabled) return;
        const last = messages[messages.length - 1];
        if (!last) return;
        if (last.role !== 'agent' || last.errorType) {
            autoReadArmedRef.current = false;
            return;
        }
        if (!last.id) return; // 履歴再読み込みによる ID 付与を待つ（フラグ維持）
        autoReadArmedRef.current = false;
        const messageId = last.id;
        void (async () => {
            try {
                // トグルはドロワー等で随時変わるため、発火のたびに現在値を確認する。
                const cfg = await getTTSConfig(backendUrl);
                if (!cfg.autoReadEnabled) return;
                if (!cfg.autoReadPlaybackEnabled) {
                    // 既定: 生成のみ（自動再生なし）。
                    void tts.start(messageId, undefined, { playback: false });
                    return;
                }
                // 「応答時に音声も再生する」ON: 生成を始めつつ全体読み上げと同じ通し再生へ入る
                //（生成の確定を待ってから始める。先頭TURNの生成待ち判定を誤らせないため）。
                setStopButtonVisible(cfg.stopButtonEnabled);
                await tts.start(messageId, undefined, { playback: false });
                tts.startSequence(messageId, buildTTSPlaylist(), cfg.autoAdvanceEnabled);
            } catch (error) {
                console.error('[MessageList] auto read config check failed:', error);
            }
        })();
        // tts.start / startSequence は useCallback 済み。messages の更新（ID付与）を発火契機にする。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages, ttsEnabled, backendUrl]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(scrollToBottom, [messages]);

    useEffect(() => {
        onActiveBackgroundChange?.(useChatAreaBackground ? activeBackgroundUrl : null);
        return () => onActiveBackgroundChange?.(null);
    }, [activeBackgroundUrl, onActiveBackgroundChange, useChatAreaBackground]);

    // セッション変更時に添付画像を読み込む
    useEffect(() => {
        if (!sessionId) return;
        if (!canUseComfyUI) {
            setImageAttachments({});
            return;
        }
        (async () => {
            try {
                const all = await getAllImageAttachments(backendUrl, sessionId);
                setImageAttachments(all);
            } catch { /* 無視 */ }
        })();
    }, [sessionId, backendUrl, canUseComfyUI]);

    // IntersectionObserver: チャットバブル（TURN）の可視判定
    useEffect(() => {
        if (!settings.enableBackgroundImage) {
            setActiveBackgroundUrl(null);
            return;
        }
        const container = containerRef.current;
        if (!container) return;

        const observer = new IntersectionObserver(
            (entries) => {
                setVisibleTurnKeys(prev => {
                    const next = new Set(prev);
                    for (const entry of entries) {
                        const turnKey = (entry.target as HTMLElement).dataset.turnKey;
                        if (!turnKey) continue;
                        if (entry.isIntersecting) {
                            next.add(turnKey);
                        } else {
                            next.delete(turnKey);
                        }
                    }
                    return next;
                });
            },
            { root: container, threshold: 0 }
        );

        // 現在のバブル要素を全て監視
        for (const el of container.querySelectorAll('[data-turn-key]')) {
            observer.observe(el);
        }

        return () => observer.disconnect();
    }, [settings.enableBackgroundImage, messages, imageAttachments]);

    // 画面中央に最も近いチャットバブル（TURN）を基準に背景を設定。
    // 中央バブルに画像がなければ、メッセージ境界を越えて上のバブルへ遡り、
    // 最初に画像を持つバブルの画像を表示する（下方向へは探さない）。
    useEffect(() => {
        if (!settings.enableBackgroundImage || visibleTurnKeys.size === 0) {
            setActiveBackgroundUrl(null);
            return;
        }
        const container = containerRef.current;
        if (!container) return;

        const containerRect = container.getBoundingClientRect();
        const containerCenter = containerRect.top + containerRect.height / 2;

        // DOM順の全バブル要素（遡りは画面外のバブルも対象にするため全量を取る）
        const turnEls = Array.from(container.querySelectorAll<HTMLElement>('[data-turn-key]'));

        // 添付をバブルへ解決（縮小表示側と同じ優先順: turnId → turnIndex → 末尾TURN）
        const turnElsByMsg = new Map<string, HTMLElement[]>();
        for (const el of turnEls) {
            const msgId = el.dataset.msgId;
            if (!msgId) continue;
            turnElsByMsg.set(msgId, [...(turnElsByMsg.get(msgId) ?? []), el]);
        }
        const attachmentsByTurnKey = new Map<string, ImageAttachment[]>();
        for (const [msgId, atts] of Object.entries(imageAttachments)) {
            const els = turnElsByMsg.get(msgId);
            if (!els || els.length === 0) continue;
            for (const att of atts) {
                let target: HTMLElement | undefined;
                if (att.turnId) target = els.find(e => e.dataset.turnId === att.turnId);
                if (!target && typeof att.turnIndex === 'number') {
                    target = els.find(e => e.dataset.turnIndex === String(att.turnIndex));
                }
                // 両方未照合は旧データ（末尾TURN扱い。縮小表示の末尾配置と揃える）
                if (!target) target = els[els.length - 1];
                const key = target.dataset.turnKey;
                if (!key) continue;
                attachmentsByTurnKey.set(key, [...(attachmentsByTurnKey.get(key) ?? []), att]);
            }
        }

        // 可視バブルのうち中央に最も近いもの（画像の有無は問わない）
        let centerIdx = -1;
        let closestDistance = Infinity;
        for (let i = 0; i < turnEls.length; i++) {
            const key = turnEls[i].dataset.turnKey;
            if (!key || !visibleTurnKeys.has(key)) continue;
            const rect = turnEls[i].getBoundingClientRect();
            const distance = Math.abs(rect.top + rect.height / 2 - containerCenter);
            if (distance < closestDistance) {
                closestDistance = distance;
                centerIdx = i;
            }
        }

        // 中央バブルから上方向へ遡り、最初に画像を持つバブルを採用
        let targetEl: HTMLElement | null = null;
        for (let i = centerIdx; i >= 0; i--) {
            const key = turnEls[i].dataset.turnKey;
            if (key && (attachmentsByTurnKey.get(key)?.length ?? 0) > 0) {
                targetEl = turnEls[i];
                break;
            }
        }

        const targetKey = targetEl?.dataset.turnKey;
        if (targetKey && sessionId) {
            const attachments = attachmentsByTurnKey.get(targetKey)!;
            // 手動選択はバブルキー優先、旧形式（msgId単位）へフォールバック
            const targetMsgId = targetEl?.dataset.msgId;
            const overrideFilename = backgroundOverrides[targetKey]
                ?? (targetMsgId ? backgroundOverrides[targetMsgId] : undefined);
            const targetAtt = overrideFilename
                ? attachments.find(a => a.filename === overrideFilename) || attachments[0]
                : attachments[0];
            // 認証付き取得（<img> と同じ理由で直URLは公開ビルドで401になる）。
            // 非同期解決のため、依存変化後の遅延反映は canceled フラグで捨てる。
            let canceled = false;
            resolveAuthedImageUrl(backendUrl, sessionId, targetAtt.filename)
                .then(url => { if (!canceled) setActiveBackgroundUrl(url); })
                .catch(() => { /* 取得失敗時は現在の背景を維持 */ });
            return () => { canceled = true; };
        } else {
            setActiveBackgroundUrl(null);
        }
    }, [visibleTurnKeys, imageAttachments, settings.enableBackgroundImage, backendUrl, sessionId, backgroundOverrides]);

    // スクロール時に背景を再評価（IntersectionObserverのコールバック外）
    useEffect(() => {
        if (!settings.enableBackgroundImage) return;
        const container = containerRef.current;
        if (!container) return;

        let ticking = false;
        const handleScroll = () => {
            if (!ticking) {
                requestAnimationFrame(() => {
                    // visibleTurnKeysの変更をトリガー（IntersectionObserverが処理）
                    // ただし中央判定の再評価が必要なので、stateを微更新
                    setVisibleTurnKeys(prev => new Set(prev));
                    ticking = false;
                });
                ticking = true;
            }
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => container.removeEventListener('scroll', handleScroll);
    }, [settings.enableBackgroundImage]);

    // 画像生成ハンドラ（ジョブキュー方式: submit → ポーリング）
    // turnId / turnIndex は押下されたチャットバブル（TURN）の指定（turnId優先）。
    const handleGenerate = useCallback(async (messageId: string, turnId: string | null, turnIndex: number) => {
        // backendUrl は同梱ビルドでは空文字（同一オリジン相対）なのでガード対象にしない
        if (!canUseComfyUI || !sessionId || generatingKey) return;
        setGeneratingKey(`${messageId}::${turnId ?? turnIndex}`);
        try {
            // ジョブ送信（即座にjobIdが返る）
            const submitted = await generateFromChat(backendUrl, sessionId, messageId, turnId, turnIndex);
            const jobId = submitted.jobId;
            console.log('[Frontend] Image-generate job submitted:', jobId);

            // ポーリング（最大5分、2秒間隔）
            const maxAttempts = 150;
            let attempts = 0;
            while (attempts < maxAttempts) {
                await new Promise(r => setTimeout(r, 2000));
                // アンマウント後はポーリングを打ち切る（04調査 中#3）。
                if (disposedRef.current) return;
                let statusData: any;
                try {
                    const statusRes = await axiosLib.get(`${backendUrl}/api/chat/status/${jobId}`);
                    statusData = statusRes.data;
                } catch {
                    attempts++;
                    continue;
                }
                const { status, imageAttachment, error } = statusData;
                if (status === 'completed') {
                    if (imageAttachment) {
                        setImageAttachments(prev => ({
                            ...prev,
                            [messageId]: [...(prev[messageId] || []), imageAttachment],
                        }));
                    }
                    return;
                } else if (status === 'error') {
                    console.error('[Frontend] Image-generate job failed:', error);
                    showToast(error || t(MESSAGE_LIST_I18N_KEYS.imageGenerateFailed));
                    return;
                } else if (status === 'canceled') {
                    // キャンセル済みジョブはタイムアウトまで回さず即終了する（04調査 中#3）。
                    console.log('[Frontend] Image-generate job canceled:', jobId);
                    return;
                }
                attempts++;
            }
            showToast(t(MESSAGE_LIST_I18N_KEYS.imageGenerateTimeout));
        } catch (e: any) {
            // 409: 既に処理中 → 重複扱い（何もしない）
            if (e.response?.status === 409) {
                console.log('[Frontend] Image-generate already in progress');
                return;
            }
            console.error('[Frontend] Image-generate request failed:', e);
            if (!disposedRef.current) {
                showToast(e.message || t(MESSAGE_LIST_I18N_KEYS.imageGenerateError));
            }
        } finally {
            if (!disposedRef.current) {
                setGeneratingKey(null);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canUseComfyUI, sessionId, backendUrl, generatingKey, showToast, uiCatalog]);

    const openExpandedImage = (attachment: ImageAttachment, msgId?: string, turnKey?: string) => {
        setExpandedAttachment(attachment);
        setExpandedMsgId(msgId || null);
        setExpandedTurnKey(turnKey || null);
        setShowExpandedPrompt(false);
    };

    const closeExpandedImage = () => {
        setExpandedAttachment(null);
        setShowExpandedPrompt(false);
        setConfirmingDeleteImage(false);
    };

    // 拡大表示中の画像を削除（確認モーダルからの実行）
    const handleDeleteExpandedImage = async () => {
        if (!sessionId || !expandedMsgId || !expandedAttachment || deletingImage) return;
        const msgId = expandedMsgId;
        const attachmentId = expandedAttachment.id;
        setDeletingImage(true);
        try {
            await deleteImageAttachment(backendUrl, sessionId, msgId, attachmentId);
            // 一覧から除去（背景はimageAttachments変更で自動再評価される）
            setImageAttachments(prev => {
                const rest = (prev[msgId] ?? []).filter(a => a.id !== attachmentId);
                const next = { ...prev };
                if (rest.length === 0) {
                    delete next[msgId];
                } else {
                    next[msgId] = rest;
                }
                return next;
            });
            closeExpandedImage();
        } catch (e: any) {
            console.error('[Frontend] Image-attachment delete failed:', e);
            showToast(t(MESSAGE_LIST_I18N_KEYS.deleteImageFailed));
        } finally {
            setDeletingImage(false);
        }
    };

    // React.memo化したMessageItemに渡すコールバックの参照を安定化する
    // （親の再レンダーで関数が再生成されてもmemoが壊れないようにする）
    const stableOnEditStart = useStableCallback(onEditStart);
    const stableOnEditCancel = useStableCallback(onEditCancel);
    const stableOnEditSave = useStableCallback(onEditSave);
    const stableOnEditChange = useStableCallback(onEditChange);
    const stableOnRegenerate = useStableCallback(onRegenerate);
    const stableOnGenerate = useStableCallback(handleGenerate);
    const stableOnOpenImage = useStableCallback(openExpandedImage);
    // 1応答全体の読み上げ（P3拡張）: 生成を開始しつつ（生成済み・音声未紐づけTURNは
    // サーバー側スキップ）、応答ひと塊の先頭TURNから通し再生する。全部生成済みで
    // ジョブが立たない場合も通し再生は開始する。TURN単位は従来どおり。
    const buildTTSPlaylist = React.useCallback((): TTSPlaylistEntry[] =>
        messages
            .filter(m => m.role === 'agent' && m.id)
            .map(m => ({
                messageId: m.id!,
                turnIds: parseMultiCharacterResponse(m.content)
                    .map(turn => turn.turnId)
                    .filter((id): id is string => Boolean(id)),
            })), [messages]);

    const handleTTSStart = (messageId: string, turnId?: string) => {
        if (turnId) {
            void tts.start(messageId, turnId);
            return;
        }
        void (async () => {
            let autoAdvance = false;
            try {
                const cfg = await getTTSConfig(backendUrl);
                autoAdvance = cfg.autoAdvanceEnabled;
                setStopButtonVisible(cfg.stopButtonEnabled);
            } catch {
                // 設定が読めなくても既定値で再生は続行する。
            }
            // 生成開始の確定を待ってから通し再生へ入る。待たないと先頭TURNの
            // 生成待ち判定がジョブ参照の空を「音声なし確定」と誤読してスキップする。
            await tts.start(messageId, undefined, { playback: false });
            tts.startSequence(messageId, buildTTSPlaylist(), autoAdvance);
        })();
    };
    const stableOnTTSStart = useStableCallback(handleTTSStart);
    const stableOnTTSCancel = useStableCallback(tts.cancel);
    // 個別TURNの再生（要件14.1「続きを自動再生」）: トグルONならそのTURNから通し再生に
    // 入り、後続の生成済み音声（応答の区切りを跨いで）を続けて再生する。OFFは1本だけ。
    const handleTTSPlayFinal = (messageId: string, turnId: string) => {
        void (async () => {
            let autoAdvance = false;
            try {
                const cfg = await getTTSConfig(backendUrl);
                autoAdvance = cfg.autoAdvanceEnabled;
                setStopButtonVisible(cfg.stopButtonEnabled);
            } catch {
                // 設定が読めなくても1本再生は続行する。
            }
            if (autoAdvance) {
                tts.startSequence(messageId, buildTTSPlaylist(), true, turnId);
            } else {
                tts.playFinal(messageId, turnId);
            }
        })();
    };
    const stableOnTTSPlayFinal = useStableCallback(handleTTSPlayFinal);
    const stableOnTTSStopFinal = useStableCallback(tts.stopFinal);
    const stableOnTTSStopPlayback = useStableCallback(tts.stopPlayback);
    const stableOnTTSDeleteAudio = useStableCallback((messageId: string) => setTtsDeleteTarget(messageId));

    return (
        <div ref={containerRef} className="flex-1 overflow-y-auto p-4 space-y-4 relative">
            {/* 背景画像 */}
            {!useChatAreaBackground && activeBackgroundUrl && (
                <div
                    className="fixed pointer-events-none z-0"
                    style={{
                        top: containerRef.current?.getBoundingClientRect().top ?? 0,
                        left: containerRef.current?.getBoundingClientRect().left ?? 0,
                        width: containerRef.current?.offsetWidth ?? '100%',
                        height: containerRef.current?.offsetHeight ?? '100%',
                    }}
                >
                    <img
                        src={activeBackgroundUrl}
                        alt=""
                        className={`w-full h-full ${(settings.backgroundImageFit ?? 'cover') === 'cover' ? 'object-cover' : 'object-contain'}`}
                        style={{ opacity: settings.backgroundImageOpacity ?? 1.0 }}
                    />
                </div>
            )}
            {messages.map((msg, i) => (
                <MessageItem
                    key={msg.id ?? `idx-${i}`}
                    msg={msg}
                    isLast={i === messages.length - 1}
                    settings={settings}
                    editingState={editingState && msg.id && editingState.messageId === msg.id ? editingState : null}
                    attachments={msg.id ? imageAttachments[msg.id] : undefined}
                    generatingKey={generatingKey}
                    generateDisabled={generatingKey !== null}
                    canUseComfyUI={canUseComfyUI}
                    isLoading={isLoading}
                    backendUrl={backendUrl}
                    sessionId={sessionId}
                    characterImageDirectoryMap={characterImageDirectoryMap}
                    characterIconUrls={characterIconUrls}
                    hasActiveBackground={!!activeBackgroundUrl}
                    onEditStart={stableOnEditStart}
                    onEditCancel={stableOnEditCancel}
                    onEditSave={stableOnEditSave}
                    onEditChange={stableOnEditChange}
                    onRegenerate={stableOnRegenerate}
                    onGenerate={stableOnGenerate}
                    onOpenImage={stableOnOpenImage}
                    uiCatalog={uiCatalog}
                    ttsEnabled={ttsEnabled}
                    ttsEmojiList={ttsEmojiList}
                    ttsIndex={tts.index}
                    ttsActiveKey={tts.activeKey}
                    ttsCancelling={tts.cancelling}
                    ttsNotice={tts.notice}
                    ttsPlayingFinalKey={tts.playingFinalKey}
                    ttsSequenceActive={tts.sequenceActive}
                    ttsSequenceCurrentKey={tts.sequenceCurrentKey}
                    onTTSStart={stableOnTTSStart}
                    onTTSCancel={stableOnTTSCancel}
                    onTTSPlayFinal={stableOnTTSPlayFinal}
                    onTTSStopFinal={stableOnTTSStopFinal}
                    onTTSStopPlayback={stableOnTTSStopPlayback}
                    onTTSDeleteAudio={stableOnTTSDeleteAudio}
                />
            ))}

            {/* 行動選択肢（支援者向け）: 最新のAI応答直下に表示。選択して送信すると
                その行動を取ったとしてAIへ返る。「その他」は選択解除＝通常の自由入力。 */}
            {canUseActionChoice && !isLoading && actionChoices && actionChoices.length > 0 && (
                <div className="relative z-[1] max-w-3xl mr-auto pl-11 space-y-2">
                    <div className="text-xs text-gray-400">{t(MESSAGE_LIST_I18N_KEYS.actionChoiceTitle)}</div>
                    <div className="flex flex-col gap-2">
                        {actionChoices.map((choice, i) => (
                            <button
                                key={`choice-${i}`}
                                onClick={() => onSelectChoice?.(selectedChoice === choice ? null : choice)}
                                className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                                    selectedChoice === choice
                                        ? 'bg-blue-600/30 border-blue-500 text-blue-100'
                                        : 'bg-gray-900/60 border-gray-700 text-gray-200 hover:border-blue-500 hover:text-white'
                                }`}
                            >
                                {choice}
                            </button>
                        ))}
                        <button
                            onClick={() => onSelectChoice?.(null)}
                            className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                                selectedChoice === null
                                    ? 'bg-gray-700/50 border-gray-500 text-gray-100'
                                    : 'bg-gray-900/60 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
                            }`}
                        >
                            {t(MESSAGE_LIST_I18N_KEYS.actionChoiceOther)}
                        </button>
                    </div>
                </div>
            )}
            <div ref={messagesEndRef} />

            {/* 再生停止ボタン（P3拡張: Tier充足×TTS連携済み×停止ボタン設定ON×再生中のみ。
                押下で再生だけ止める（生成ジョブは継続）。一覧末尾に sticky で張り付き、
                チャット入力欄のすぐ上に常時見える。地は他の浮きボタンと同じ暗いガラス地で、
                縁・文字・アイコンだけ赤にして読み上げ系（オレンジ）と見分ける。
                h-0 の常設ラッパーで space-y-4 のガタつきを避ける。 */}
            <div className="sticky bottom-0 z-40 h-0 flex justify-end pointer-events-none">
                {ttsEnabled && stopButtonVisible && (tts.sequenceActive || tts.playingFinalKey !== null) && (
                    <button
                        onClick={() => tts.stopPlayback()}
                        className="pointer-events-auto -translate-y-full flex items-center gap-1.5 px-4 py-2.5 text-sm bg-gray-900/90 border border-red-500/60 text-red-300 hover:bg-red-900/40 rounded-full shadow-lg transition-colors"
                        title={resolveMessage(uiCatalog, 'tts.button.stopPlayback', '再生を停止')}
                    >
                        <Square size={14} />
                        {resolveMessage(uiCatalog, 'tts.button.stopPlayback', '再生を停止')}
                    </button>
                )}
            </div>

            {/* 応答単位の音声削除の確認ダイアログ（要件10章。確認操作はフロント側の責務） */}
            <ConfirmDialog
                isOpen={ttsDeleteTarget !== null}
                title={resolveMessage(uiCatalog, 'tts.deleteAudio.confirmTitle', '生成音声の削除')}
                message={resolveMessage(uiCatalog, 'tts.deleteAudio.confirmMessage', 'この応答の生成音声を削除しますか？')}
                onYes={() => {
                    const target = ttsDeleteTarget;
                    setTtsDeleteTarget(null);
                    if (target) {
                        void tts.deleteMessageAudio(target).then(ok => {
                            // 削除の失敗は無音で流さず、その場で知らせる。
                            if (!ok) showToast(resolveMessage(uiCatalog, 'tts.deleteAudio.failed', '音声を削除できませんでした'));
                        });
                    }
                }}
                onNo={() => setTtsDeleteTarget(null)}
                onCancel={() => setTtsDeleteTarget(null)}
                uiCatalog={uiCatalog}
            />

            {/* 画像拡大表示モーダル */}
            {expandedAttachment && sessionId && (
                <div
                    className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 cursor-pointer"
                    onClick={closeExpandedImage}
                >
                    <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
                        {/* 背景に設定ボタン */}
                        {settings.enableBackgroundImage && expandedMsgId && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setBackgroundOverrides(prev => {
                                        // TURN単位のキーで保存（旧データのmsgIdキーは読み取り時にフォールバック参照）
                                        const next = { ...prev, [expandedTurnKey ?? expandedMsgId]: expandedAttachment.filename };
                                        if (sessionId) {
                                            try { localStorage.setItem(`bg-overrides-${sessionId}`, JSON.stringify(next)); } catch {}
                                        }
                                        return next;
                                    });
                                    // 可視判定を再トリガー
                                    setVisibleTurnKeys(prev => new Set(prev));
                                    closeExpandedImage();
                                }}
                                className="p-2 rounded-lg bg-gray-950/80 border border-gray-700 text-gray-200 hover:text-white hover:border-blue-500 transition-colors"
                                title={t(MESSAGE_LIST_I18N_KEYS.setAsBackground)}
                            >
                                <ImageIcon size={18} />
                            </button>
                        )}
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowExpandedPrompt(prev => !prev);
                            }}
                            className="p-2 rounded-lg bg-gray-950/80 border border-gray-700 text-gray-200 hover:text-white hover:border-purple-500 transition-colors"
                            title={t(MESSAGE_LIST_I18N_KEYS.showPositivePrompt)}
                        >
                            <FileText size={18} />
                        </button>
                        {/* 削除ボタン（削除にはメッセージIDが必要） */}
                        {expandedMsgId && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setConfirmingDeleteImage(true);
                                }}
                                className="p-2 rounded-lg bg-gray-950/80 border border-gray-700 text-gray-200 hover:text-white hover:border-red-500 transition-colors"
                                title={t(MESSAGE_LIST_I18N_KEYS.deleteImage)}
                            >
                                <Trash2 size={18} />
                            </button>
                        )}
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                closeExpandedImage();
                            }}
                            className="p-2 rounded-lg bg-gray-950/80 border border-gray-700 text-gray-200 hover:text-white hover:border-red-500 transition-colors"
                            title={t(MESSAGE_LIST_I18N_KEYS.close)}
                        >
                            <X size={18} />
                        </button>
                    </div>
                    <AuthImg
                        backendUrl={backendUrl}
                        sessionId={sessionId!}
                        filename={expandedAttachment.filename}
                        alt={t(MESSAGE_LIST_I18N_KEYS.expandedImageAlt)}
                        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    />
                    {showExpandedPrompt && (
                        <div
                            className="absolute top-16 right-4 z-30 w-[min(560px,calc(100vw-2rem))] max-h-[70vh] overflow-auto rounded-lg border border-gray-700 bg-gray-950/95 shadow-2xl p-4 cursor-default"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between gap-3 mb-3">
                                <h3 className="text-sm font-semibold text-gray-100">{t(MESSAGE_LIST_I18N_KEYS.positivePrompt)}</h3>
                                <button
                                    onClick={() => setShowExpandedPrompt(false)}
                                    className="p-1 text-gray-500 hover:text-white transition-colors"
                                    title={t(MESSAGE_LIST_I18N_KEYS.close)}
                                >
                                    <X size={16} />
                                </button>
                            </div>
                            <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-200 font-mono">
                                {expandedAttachment.resolvedPrompt?.positive || t(MESSAGE_LIST_I18N_KEYS.noSavedPositivePrompt)}
                            </pre>
                        </div>
                    )}
                    {/* 削除確認モーダル */}
                    {confirmingDeleteImage && (
                        <div
                            className="absolute inset-0 z-40 flex items-center justify-center bg-black/60"
                            onClick={(e) => {
                                e.stopPropagation();
                                setConfirmingDeleteImage(false);
                            }}
                        >
                            <div
                                className="bg-gray-900 border border-gray-700 rounded-xl p-5 w-[min(90vw,360px)] shadow-2xl cursor-default"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="text-white font-bold mb-2">{t(MESSAGE_LIST_I18N_KEYS.deleteImageConfirmTitle)}</div>
                                <div className="text-sm text-gray-300 mb-4">{t(MESSAGE_LIST_I18N_KEYS.deleteImageConfirmMessage)}</div>
                                <div className="flex justify-end gap-2">
                                    <button
                                        onClick={() => setConfirmingDeleteImage(false)}
                                        className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                                    >
                                        {t(COMMON_I18N_KEYS.cancel)}
                                    </button>
                                    <button
                                        onClick={handleDeleteExpandedImage}
                                        disabled={deletingImage}
                                        className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-500 text-white rounded transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {deletingImage ? (
                                            <Loader2 size={12} className="animate-spin" />
                                        ) : (
                                            <Trash2 size={12} />
                                        )}
                                        {t(COMMON_I18N_KEYS.delete)}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* エラー通知トースト */}
            <Toast messages={toastMessages} onDismiss={dismissToast} />
        </div>
    );
};
