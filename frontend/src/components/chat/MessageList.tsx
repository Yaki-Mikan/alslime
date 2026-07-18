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
import { Edit2, RefreshCw, Palette, Loader2, FileText, X, ImageIcon, Clock } from 'lucide-react';
import axiosLib from '../../lib/axios';
import { generateFromChat, getAllImageAttachments, resolveAuthedImageUrl } from '../../api/comfyui';
import type { ImageAttachment } from '../../api/comfyui';
import { FEATURE_ACTION_CHOICE, FEATURE_COMFYUI, isFeatureEnabled } from '../../constants/features';
import { Toast, useToast } from '../common/Toast';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { COMMON_I18N_KEYS, COMMON_TEXT_FALLBACK_JA, MESSAGE_LIST_I18N_KEYS, MESSAGE_LIST_TEXT_FALLBACK_JA } from '../../constants/i18n';

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
    onActiveBackgroundChange?: (url: string | null) => void;
    uiCatalog?: I18NCatalog | null;
    // backend の tier gate（機能フラグ）。Chat が一度だけ取得して配布する
    //（再マウントのたびの /api/system/health 取得をやめる。04調査 中#4）。
    enabledFeatures?: Record<string, boolean> | null;
    // 行動選択肢（支援者向け）。最新応答の選択肢と選択状態（useChat が管理）。
    actionChoices?: string[] | null;
    selectedChoice?: string | null;
    onSelectChoice?: (choice: string | null) => void;
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
}> = ({ iconUrl, defaultIconUrl, characterName, emotion, size = 40 }) => {
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

    // バッジスタイル（サイズに応じて調整）
    const getBadgeStyles = () => {
        if (size <= 40) return 'absolute -bottom-1 -right-1 text-[10px] bg-gray-900 px-1 rounded text-gray-400 border border-gray-700';
        if (size <= 100) return 'absolute bottom-0.5 right-0.5 text-[10px] bg-gray-900/90 px-1 py-0.5 rounded text-gray-300 border border-gray-600';
        if (size <= 200) return 'absolute bottom-1 right-1 text-xs bg-gray-900/90 px-1.5 py-0.5 rounded text-gray-300 border border-gray-600';
        return 'absolute bottom-2 right-2 text-sm bg-gray-900/90 px-2 py-1 rounded text-gray-200 border border-gray-600';
    };

    return (
        <div className="relative group/icon">
            <img
                src={currentUrl}
                alt={`${characterName} - ${emotion}`}
                className={`object-cover ${baseStyles}`}
                style={{ width: `${size}px`, height: `${size}px` }}
                onError={handleError}
            />
            {/* 心情のバッジ */}
            {emotion !== 'default' && (
                <span className={getBadgeStyles()}>
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

/** キャラクターアイコンURL生成（純関数） */
const getCharacterIconUrl = (backendUrl: string, characterName: string, emotion: string): string => {
    if (!backendUrl || !characterName) {
        return '/assets/default/no-image-female.png';
    }
    return `${backendUrl}/images/characters/${encodeURIComponent(characterName)}/images/icons/${emotion}.png`;
};

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

interface MessageItemProps {
    msg: Message;
    isLast: boolean;
    settings: SettingsType;
    /** このメッセージが編集対象の場合のみ非null（親で絞り込み済み） */
    editingState: EditingState | null;
    attachments: ImageAttachment[] | undefined;
    /** このメッセージの画像を生成中か */
    isGenerating: boolean;
    /** いずれかのメッセージで画像生成中か（ボタンdisabled用） */
    generateDisabled: boolean;
    /** ComfyUI 画像生成機能が有効か */
    canUseComfyUI: boolean;
    isLoading: boolean;
    backendUrl: string;
    sessionId?: string;
    /** 背景画像が表示中か（バブルの塗り分けに使用。URL自体には依存させない） */
    hasActiveBackground: boolean;
    onEditStart: (msgId: string, turnIndex: number, content: string) => void;
    onEditCancel: () => void;
    onEditSave: () => void;
    onEditChange: (content: string) => void;
    onRegenerate: () => void;
    onGenerate: (msgId: string) => void;
    onOpenImage: (att: ImageAttachment, msgId?: string) => void;
    onSetRef: (msgId: string, el: HTMLDivElement | null) => void;
    uiCatalog: I18NCatalog | null;
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
    isGenerating,
    generateDisabled,
    canUseComfyUI,
    isLoading,
    backendUrl,
    sessionId,
    hasActiveBackground,
    onEditStart,
    onEditCancel,
    onEditSave,
    onEditChange,
    onRegenerate,
    onGenerate,
    onOpenImage,
    onSetRef,
    uiCatalog
}) => {
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        MESSAGE_LIST_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key
    );
    // パース結果をメモ化: contentが変わらない限り再計算しない
    const { files, text } = React.useMemo(() => parseMessage(msg.content), [msg.content]);

    // agentメッセージのTURN分割と行処理（連続空行まとめ）もメモ化
    const processedTurns = React.useMemo(() => {
        if (msg.role !== 'agent' || !text) return null;
        return parseMultiCharacterResponse(text).map(turn => {
            let lines = turn.content.split(/\r?\n/);
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
    }, [msg.role, text, settings.collapseEmptyLines]);

    return (
        <div
            ref={(el) => msg.id ? onSetRef(msg.id, el) : undefined}
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
                                // 編集モード判定（editingStateは親でこのメッセージ分のみに絞り込み済み）
                                const isEditing = editingState !== null && editingState.turnIndex === turn.index;

                                if (isEditing && editingState) {
                                    return (
                                        <div key={turnIdx} className="w-full max-w-[85%] bg-gray-800 p-3 rounded-lg border border-blue-500/50">
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
                                return (
                                    <div key={turnIdx} className="flex flex-col w-fit max-w-[85%]">
                                        {/* セッション時刻（各TURN個別の絶対時刻） */}
                                        {turnTime && (
                                            <div className="flex items-center gap-1.5 text-sm text-blue-400/80 mb-1 ml-1 font-mono">
                                                <Clock size={14} />
                                                {turnTime.year}/{String(turnTime.month).padStart(2, '0')}/{String(turnTime.day).padStart(2, '0')} {String(turnTime.hour).padStart(2, '0')}:{String(turnTime.minute).padStart(2, '0')}:{String(turnTime.second || 0).padStart(2, '0')}
                                            </div>
                                        )}
                                        {/* キャラクター名ラベル（バブル外、アイコン付き） */}
                                        {turn.character && (() => {
                                            // TURNタグのemotion属性から心情を取得（未指定ならdefault）
                                            const emotion = turn.emotion || 'default';
                                            const iconUrl = getCharacterIconUrl(backendUrl, turn.character, emotion);
                                            const defaultIconUrl = emotion !== 'default'
                                                ? getCharacterIconUrl(backendUrl, turn.character, 'default')
                                                : null;
                                            const iconSize = settings.characterIconSize || 40;

                                            // 小サイズ（40以下）: 横並び、それ以外: 縦並び
                                            if (iconSize > 40) {
                                                return (
                                                    <div className="flex flex-col items-start mb-2">
                                                        <div className="text-base font-bold text-indigo-300 tracking-wide mb-1">
                                                            {turn.character}
                                                        </div>
                                                        <CharacterIconWithFallback
                                                            iconUrl={iconUrl}
                                                            defaultIconUrl={defaultIconUrl}
                                                            characterName={turn.character}
                                                            emotion={emotion}
                                                            size={iconSize}
                                                        />
                                                    </div>
                                                );
                                            }

                                            // 小サイズ（デフォルト）: 横並び
                                            return (
                                                <div className="flex items-center gap-2 mb-1">
                                                    <CharacterIconWithFallback
                                                        iconUrl={iconUrl}
                                                        defaultIconUrl={defaultIconUrl}
                                                        characterName={turn.character}
                                                        emotion={emotion}
                                                        size={iconSize}
                                                    />
                                                    <div className="text-base font-bold text-indigo-300 tracking-wide">
                                                        {turn.character}
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {/* メッセージバブル */}
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
                                    </div>
                                );
                            })}

                            {/* 画像添付サムネイル */}
                            {msg.id && attachments && attachments.length > 0 && (
                                <div className="flex flex-wrap gap-2 ml-1 mt-1">
                                    {attachments.map((att) => (
                                        <AuthImg
                                            key={att.id}
                                            backendUrl={backendUrl}
                                            sessionId={sessionId!}
                                            filename={att.filename}
                                            alt={t(MESSAGE_LIST_I18N_KEYS.generatedImageAlt)}
                                            className="w-24 h-24 object-cover rounded-lg border border-gray-700 cursor-pointer hover:border-purple-500 transition-colors"
                                            onClick={() => onOpenImage(att, msg.id)}
                                        />
                                    ))}
                                </div>
                            )}

                            {/* モデル名と再生成/画像生成ボタン (横並び) */}
                            <div className="flex items-center gap-3 ml-1 mt-[-4px]">
                                {msg.model && (
                                    <div className="text-[10px] text-gray-500">
                                        Generated by {msg.model}
                                    </div>
                                )}
                                {/* 画像生成ボタン */}
                                {canUseComfyUI && msg.id && sessionId && !isLoading && (
                                    <button
                                        onClick={() => onGenerate(msg.id!)}
                                        disabled={generateDisabled}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-purple-400 hover:text-white hover:bg-purple-800/50 rounded-full transition-colors disabled:opacity-40"
                                        title={t(MESSAGE_LIST_I18N_KEYS.imageGenerate)}
                                    >
                                        {isGenerating ? (
                                            <>
                                                <Loader2 size={12} className="animate-spin" />
                                                <span>{t(MESSAGE_LIST_I18N_KEYS.generating)}</span>
                                            </>
                                        ) : (
                                            <>
                                                <Palette size={12} />
                                                <span>{t(MESSAGE_LIST_I18N_KEYS.imageGenerate)}</span>
                                            </>
                                        )}
                                    </button>
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
                            </div>
                        </div>
                    );
                }

                // ユーザーメッセージの編集モード判定（turnIndex=0、editingStateは絞り込み済み）
                const isUserEditing = editingState !== null && editingState.turnIndex === 0;

                if (isUserEditing && editingState) {
                    return (
                        <div className="w-full max-w-[85%] bg-blue-800 p-3 rounded-lg border border-blue-500/50">
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
    onActiveBackgroundChange,
    uiCatalog = null,
    enabledFeatures = null,
    actionChoices = null,
    selectedChoice = null,
    onSelectChoice
}) => {
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        MESSAGE_LIST_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key
    );
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // 画像生成
    const [generatingMsgId, setGeneratingMsgId] = useState<string | null>(null);
    const [imageAttachments, setImageAttachments] = useState<Record<string, ImageAttachment[]>>({});
    const [expandedAttachment, setExpandedAttachment] = useState<ImageAttachment | null>(null);
    const [expandedMsgId, setExpandedMsgId] = useState<string | null>(null);
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
    const [visibleMsgIds, setVisibleMsgIds] = useState<Set<string>>(new Set());
    // メッセージごとの背景画像手動選択（msgId → attachmentのfilename）- sessionId単位でlocalStorageに永続化
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
    const msgElementRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const useChatAreaBackground =
        settings.enableBackgroundImage &&
        (settings.backgroundImageFit ?? 'cover') === 'cover' &&
        (settings.backgroundImageScope ?? 'history') === 'chat';
    const canUseComfyUI = isFeatureEnabled(enabledFeatures, FEATURE_COMFYUI);
    const canUseActionChoice = isFeatureEnabled(enabledFeatures, FEATURE_ACTION_CHOICE);

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

    // IntersectionObserver: 画像付きメッセージの可視判定
    useEffect(() => {
        if (!settings.enableBackgroundImage) {
            setActiveBackgroundUrl(null);
            return;
        }
        const container = containerRef.current;
        if (!container) return;

        const observer = new IntersectionObserver(
            (entries) => {
                setVisibleMsgIds(prev => {
                    const next = new Set(prev);
                    for (const entry of entries) {
                        const msgId = (entry.target as HTMLElement).dataset.msgId;
                        if (!msgId) continue;
                        if (entry.isIntersecting) {
                            next.add(msgId);
                        } else {
                            next.delete(msgId);
                        }
                    }
                    return next;
                });
            },
            { root: container, threshold: 0 }
        );

        // 現在のメッセージ要素を全て監視
        for (const [, el] of msgElementRefs.current) {
            observer.observe(el);
        }

        return () => observer.disconnect();
    }, [settings.enableBackgroundImage, messages, imageAttachments]);

    // 画面中央に最も近い画像付きメッセージを背景に設定
    useEffect(() => {
        if (!settings.enableBackgroundImage || visibleMsgIds.size === 0) {
            setActiveBackgroundUrl(null);
            return;
        }
        const container = containerRef.current;
        if (!container) return;

        const containerRect = container.getBoundingClientRect();
        const containerCenter = containerRect.top + containerRect.height / 2;

        let closestMsgId: string | null = null;
        let closestDistance = Infinity;

        for (const msgId of visibleMsgIds) {
            // このメッセージに画像があるか
            if (!imageAttachments[msgId] || imageAttachments[msgId].length === 0) continue;

            const el = msgElementRefs.current.get(msgId);
            if (!el) continue;

            const rect = el.getBoundingClientRect();
            const msgCenter = rect.top + rect.height / 2;
            const distance = Math.abs(msgCenter - containerCenter);

            if (distance < closestDistance) {
                closestDistance = distance;
                closestMsgId = msgId;
            }
        }

        if (closestMsgId && sessionId) {
            const overrideFilename = backgroundOverrides[closestMsgId];
            const attachments = imageAttachments[closestMsgId];
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
    }, [visibleMsgIds, imageAttachments, settings.enableBackgroundImage, backendUrl, sessionId, backgroundOverrides]);

    // スクロール時に背景を再評価（IntersectionObserverのコールバック外）
    useEffect(() => {
        if (!settings.enableBackgroundImage) return;
        const container = containerRef.current;
        if (!container) return;

        let ticking = false;
        const handleScroll = () => {
            if (!ticking) {
                requestAnimationFrame(() => {
                    // visibleMsgIdsの変更をトリガー（IntersectionObserverが処理）
                    // ただし中央判定の再評価が必要なので、stateを微更新
                    setVisibleMsgIds(prev => new Set(prev));
                    ticking = false;
                });
                ticking = true;
            }
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => container.removeEventListener('scroll', handleScroll);
    }, [settings.enableBackgroundImage]);

    // 画像生成ハンドラ（ジョブキュー方式: submit → ポーリング）
    const handleGenerate = useCallback(async (messageId: string) => {
        // backendUrl は同梱ビルドでは空文字（同一オリジン相対）なのでガード対象にしない
        if (!canUseComfyUI || !sessionId || generatingMsgId) return;
        setGeneratingMsgId(messageId);
        try {
            // ジョブ送信（即座にjobIdが返る）
            const submitted = await generateFromChat(backendUrl, sessionId, messageId);
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
                setGeneratingMsgId(null);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canUseComfyUI, sessionId, backendUrl, generatingMsgId, showToast, uiCatalog]);

    const openExpandedImage = (attachment: ImageAttachment, msgId?: string) => {
        setExpandedAttachment(attachment);
        setExpandedMsgId(msgId || null);
        setShowExpandedPrompt(false);
    };

    const closeExpandedImage = () => {
        setExpandedAttachment(null);
        setShowExpandedPrompt(false);
    };

    // メッセージ要素のref登録コールバック
    const setMsgRef = useCallback((msgId: string, el: HTMLDivElement | null) => {
        if (el) {
            msgElementRefs.current.set(msgId, el);
        } else {
            msgElementRefs.current.delete(msgId);
        }
    }, []);

    // React.memo化したMessageItemに渡すコールバックの参照を安定化する
    // （親の再レンダーで関数が再生成されてもmemoが壊れないようにする）
    const stableOnEditStart = useStableCallback(onEditStart);
    const stableOnEditCancel = useStableCallback(onEditCancel);
    const stableOnEditSave = useStableCallback(onEditSave);
    const stableOnEditChange = useStableCallback(onEditChange);
    const stableOnRegenerate = useStableCallback(onRegenerate);
    const stableOnGenerate = useStableCallback(handleGenerate);
    const stableOnOpenImage = useStableCallback(openExpandedImage);

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
                    isGenerating={generatingMsgId !== null && generatingMsgId === msg.id}
                    generateDisabled={generatingMsgId !== null}
                    canUseComfyUI={canUseComfyUI}
                    isLoading={isLoading}
                    backendUrl={backendUrl}
                    sessionId={sessionId}
                    hasActiveBackground={!!activeBackgroundUrl}
                    onEditStart={stableOnEditStart}
                    onEditCancel={stableOnEditCancel}
                    onEditSave={stableOnEditSave}
                    onEditChange={stableOnEditChange}
                    onRegenerate={stableOnRegenerate}
                    onGenerate={stableOnGenerate}
                    onOpenImage={stableOnOpenImage}
                    onSetRef={setMsgRef}
                    uiCatalog={uiCatalog}
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
                                        const next = { ...prev, [expandedMsgId]: expandedAttachment.filename };
                                        if (sessionId) {
                                            try { localStorage.setItem(`bg-overrides-${sessionId}`, JSON.stringify(next)); } catch {}
                                        }
                                        return next;
                                    });
                                    // 可視判定を再トリガー
                                    setVisibleMsgIds(prev => new Set(prev));
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
                </div>
            )}

            {/* エラー通知トースト */}
            <Toast messages={toastMessages} onDismiss={dismissToast} />
        </div>
    );
};
