/**
 * ManualModal.tsx - アプリ内マニュアル表示
 *
 * 同梱の操作マニュアル（/api/manual が配信する docs/manual の embed）を
 * react-markdown でレンダリングする。初期表示は目次（index.md）。
 * 本文内の .md への相対リンクはモーダル内遷移に変換し、画像の相対パスは
 * 配信 URL へ解決する。外部リンクは新規タブで開く。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, List, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import axios from '../lib/axios';
import { resolveMessage, type I18NCatalog } from '../api/i18n';
import { DEFAULT_UI_LANGUAGE } from '../constants/i18n';

interface ManualModalProps {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiLanguage: string;
    uiCatalog: I18NCatalog | null;
}

// resolveManualPath は現在ファイルのディレクトリ基準で相対 href を解決する
// （例: 現在 ja/01-setup.md・href ../images/ja/x.png → images/ja/x.png）。
const resolveManualPath = (currentPath: string, href: string): string => {
    const stack = currentPath.split('/').slice(0, -1);
    for (const part of href.split('/')) {
        if (part === '' || part === '.') continue;
        if (part === '..') {
            stack.pop();
            continue;
        }
        stack.push(part);
    }
    return stack.join('/');
};

export const ManualModal: React.FC<ManualModalProps> = ({
    isOpen,
    onClose,
    backendUrl,
    uiLanguage,
    uiCatalog,
}) => {
    const t = (key: string, fallback: string) => resolveMessage(uiCatalog, key, fallback);
    const indexPath = uiLanguage === DEFAULT_UI_LANGUAGE ? 'index.md' : 'en/index.md';

    const [currentPath, setCurrentPath] = useState(indexPath);
    const [content, setContent] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const bodyRef = useRef<HTMLDivElement>(null);

    const loadChapter = useCallback(async (path: string) => {
        setIsLoading(true);
        setLoadFailed(false);
        try {
            const response = await axios.get(`${backendUrl}/api/manual/${path}`, { responseType: 'text' });
            setContent(typeof response.data === 'string' ? response.data : String(response.data));
            setCurrentPath(path);
            bodyRef.current?.scrollTo({ top: 0 });
        } catch (error) {
            console.error('Failed to load manual chapter:', error);
            setLoadFailed(true);
        }
        setIsLoading(false);
    }, [backendUrl]);

    // 開いたとき（および UI 言語が変わった後の再オープン時）は目次から始める。
    useEffect(() => {
        if (!isOpen) return;
        loadChapter(indexPath);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, indexPath]);

    if (!isOpen) return null;

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
    };

    const handleLinkClick = (e: React.MouseEvent, href: string | undefined) => {
        if (!href) return;
        if (/^https?:\/\//.test(href)) return; // 外部リンクはアンカーの既定動作（新規タブ）に任せる
        e.preventDefault();
        const [pathPart] = href.split('#');
        if (pathPart.endsWith('.md')) {
            loadChapter(resolveManualPath(currentPath, pathPart));
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={handleBackdropClick}
        >
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-3xl border border-gray-700 overflow-hidden flex flex-col max-h-[90vh]">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 bg-gray-800">
                    <div className="flex items-center gap-2">
                        <BookOpen size={20} className="text-indigo-400" />
                        <h3 className="font-semibold text-gray-100 text-lg">{t('manual.title', '操作マニュアル')}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                        {currentPath !== indexPath && (
                            <button
                                onClick={() => loadChapter(indexPath)}
                                className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-gray-700 rounded text-sm text-gray-300 hover:text-gray-100 transition-colors"
                                title={t('manual.backToIndex', '目次へ戻る')}
                            >
                                <List size={16} />
                                {t('manual.backToIndex', '目次へ戻る')}
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* 本文 */}
                <div ref={bodyRef} className="px-6 py-5 overflow-y-auto custom-scrollbar text-gray-300 text-sm leading-relaxed">
                    {isLoading && (
                        <p className="text-gray-500">{t('manual.loading', '読み込み中...')}</p>
                    )}
                    {loadFailed && !isLoading && (
                        <p className="text-red-400">{t('manual.loadError', 'マニュアルの読み込みに失敗しました。')}</p>
                    )}
                    {!isLoading && !loadFailed && (
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            urlTransform={(url) => url}
                            components={{
                                h1: (props) => <h1 className="text-2xl font-bold text-gray-100 mb-4 pb-2 border-b border-gray-700" {...props} />,
                                h2: (props) => <h2 className="text-xl font-semibold text-gray-100 mt-6 mb-3 pb-1 border-b border-gray-800" {...props} />,
                                h3: (props) => <h3 className="text-lg font-semibold text-gray-200 mt-5 mb-2" {...props} />,
                                h4: (props) => <h4 className="text-base font-semibold text-gray-200 mt-4 mb-2" {...props} />,
                                p: (props) => <p className="my-3" {...props} />,
                                ul: (props) => <ul className="list-disc pl-6 my-3 space-y-1" {...props} />,
                                ol: (props) => <ol className="list-decimal pl-6 my-3 space-y-1" {...props} />,
                                table: (props) => (
                                    <div className="overflow-x-auto my-4">
                                        <table className="w-full text-left border-collapse" {...props} />
                                    </div>
                                ),
                                th: (props) => <th className="border border-gray-700 bg-gray-800 px-3 py-2 text-gray-200" {...props} />,
                                td: (props) => <td className="border border-gray-700 px-3 py-2 align-top" {...props} />,
                                code: (props) => <code className="bg-gray-800 rounded px-1.5 py-0.5 text-indigo-300 text-[0.85em]" {...props} />,
                                pre: (props) => <pre className="bg-gray-800 rounded-lg p-4 overflow-x-auto my-4 text-[0.85em]" {...props} />,
                                blockquote: (props) => <blockquote className="border-l-4 border-gray-600 pl-4 my-3 text-gray-400" {...props} />,
                                hr: () => <hr className="border-gray-700 my-6" />,
                                a: ({ href, children, ...props }) => (
                                    <a
                                        href={href}
                                        onClick={(e) => handleLinkClick(e, href)}
                                        target={href && /^https?:\/\//.test(href) ? '_blank' : undefined}
                                        rel={href && /^https?:\/\//.test(href) ? 'noopener noreferrer' : undefined}
                                        className="text-blue-400 hover:text-blue-300 underline cursor-pointer"
                                        {...props}
                                    >
                                        {children}
                                    </a>
                                ),
                                img: ({ src, alt }) => (
                                    <img
                                        src={typeof src === 'string' && !/^https?:\/\//.test(src)
                                            ? `${backendUrl}/api/manual/${resolveManualPath(currentPath, src)}`
                                            : src}
                                        alt={alt || ''}
                                        className="max-w-full rounded-lg border border-gray-700 my-4"
                                        loading="lazy"
                                    />
                                ),
                            }}
                        >
                            {content}
                        </ReactMarkdown>
                    )}
                </div>
            </div>
        </div>
    );
};
