/**
 * TagJudgeWorkflowDrawerPanel.tsx - クイック設定のタグ判定・ワークフロー設定パネル
 *
 * クイック設定の欄の中で開閉するパネルの器（デフォルト閉）。開いた時に
 * TagJudgeWorkflowPanel をマウントして設定を読み込むため、
 * 閉→開で他画面での変更を拾う。クイック設定の欄は閉じても中身を捨てないため、
 * パネルを開いたまま欄を閉じて開き直した場合も拾えるよう、欄の開閉状態を
 * active で受け取り、開くたびに中身を再マウントする。
 * 表示条件（支援者機能・モジュール連携）は Chat 側で判定して渡す。
 */

import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Workflow } from 'lucide-react';
import { TagJudgeWorkflowPanel } from './TagJudgeWorkflowPanel';
import type { BackendSelection } from './BackendTabs';
import { createComfyUIText } from './i18n';
import type { I18NCatalog } from '../../api/i18n';

interface Props {
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    // クイック設定の欄が開いているか。true になるたびに中身を再マウントして設定を読み直す（未指定なら常に有効）。
    active?: boolean;
    // 画像生成バックエンドの選択が確定するたびに親へ通知する（残高パネルの表示切替用）。
    onBackendChange?: (selection: BackendSelection) => void;
}

export const TagJudgeWorkflowDrawerPanel: React.FC<Props> = ({ backendUrl, uiCatalog = null, active = true, onBackendChange }) => {
    const { SECTION_NAMES } = createComfyUIText(uiCatalog);
    const [isOpen, setIsOpen] = useState(false);
    // 欄が開くたびに増やし、開いたままのパネル中身を再マウントさせる
    const [mountKey, setMountKey] = useState(0);
    useEffect(() => {
        if (active) setMountKey((k) => k + 1);
    }, [active]);

    return (
        <div className="border border-line-strong rounded-lg overflow-hidden bg-surface">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-fg hover:bg-surface-2 transition-colors text-left"
            >
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Workflow size={14} className="text-accent" />
                <span>{SECTION_NAMES.TAG_JUDGE_GENERATION_SETTINGS}</span>
            </button>
            {isOpen && (
                <div className="p-3 border-t border-line-strong">
                    <TagJudgeWorkflowPanel
                        key={mountKey}
                        backendUrl={backendUrl}
                        uiCatalog={uiCatalog}
                        showHeading={false}
                        stacked
                        showBackendTabs
                        onBackendChange={onBackendChange}
                    />
                </div>
            )}
        </div>
    );
};
