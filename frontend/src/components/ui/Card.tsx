import React from 'react';
import { cn } from './cn';

/** 面。区切りは枠を重ねず、面の明るさで表す。 */
export const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => (
    <div className={cn('rounded-ui-lg bg-surface border border-line', className)}>{children}</div>
);

/** 区切りの見出し（小さく、字間を空ける）。 */
export const SectionTitle: React.FC<{ className?: string; children: React.ReactNode; action?: React.ReactNode }> = ({ className, children, action }) => (
    <div className={cn('flex items-center justify-between gap-2 mt-6 mb-2 first:mt-0', className)}>
        <h3 className="font-head text-xs font-bold tracking-wider text-fg-muted">{children}</h3>
        {action}
    </div>
);

interface SettingRowProps {
    title: React.ReactNode;
    description?: React.ReactNode;
    /** 右側の操作（選択欄・スイッチ・ボタン） */
    children: React.ReactNode;
    /** 操作を右寄せの固定幅にせず、中身の幅にする */
    compactControl?: boolean;
    className?: string;
}

/** 設定の1行：名前と説明を左、操作を右に置く。狭い画面では操作を下へ回す。 */
export const SettingRow: React.FC<SettingRowProps> = ({ title, description, children, compactControl = false, className }) => (
    <div className={cn('flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-5 gap-y-2 px-4 py-3 border-b border-line last:border-b-0', className)}>
        {/* 名前の側に最低限の幅を持たせ、操作と並べて収まらないときは操作を下へ回す */}
        <div className="min-w-0 flex-1 basis-48">
            <div className="text-sm font-semibold text-fg">{title}</div>
            {description && <div className="text-xs text-fg-muted mt-0.5">{description}</div>}
        </div>
        <div className={cn('flex items-center justify-end gap-2 max-w-full', compactControl ? 'shrink-0' : 'w-full sm:w-64 sm:shrink-0')}>{children}</div>
    </div>
);

/** 設定の行をまとめる面。 */
export const SettingRows: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => (
    <div className={cn('rounded-ui-lg bg-surface border border-line', className)}>{children}</div>
);
