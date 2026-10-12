import React from 'react';
import { cn } from '../ui/cn';

export type AppView = 'chat' | 'history' | 'material' | 'settings';

export interface AppNavItem {
    id: AppView;
    label: string;
    icon: React.ReactNode;
    active: boolean;
    onSelect: () => void;
}

interface AppNavProps {
    items: AppNavItem[];
    className?: string;
}

const itemClass = (active: boolean) => cn(
    'app-nav-item flex flex-col items-center justify-center gap-1 rounded-ui-lg text-xs transition-colors',
    'focus-visible:outline-2 focus-visible:outline-accent',
    active ? 'bg-accent-soft text-fg font-semibold' : 'text-fg-muted hover:text-fg hover:bg-surface',
);

/** 広い画面の左の切り替え列。 */
export const NavRail: React.FC<AppNavProps> = ({ items, className }) => (
    <nav className={cn('app-rail flex-col items-center gap-1 w-[76px] shrink-0 py-3.5 border-r border-line bg-[var(--c-rail)]', className)}>
        <img src="/icons/app.png" alt="AlSlime" className="w-8 h-8 mb-4" />
        {items.map(item => (
            <button
                key={item.id}
                type="button"
                onClick={item.onSelect}
                aria-current={item.active ? 'page' : undefined}
                className={cn(itemClass(item.active), 'w-[60px] pt-2 pb-1.5')}
            >
                {item.icon}
                {item.label}
            </button>
        ))}
    </nav>
);

/** 狭い画面の下のタブ。文字を入力している間は隠す（index.css の .app-tabbar）。 */
export const TabBar: React.FC<AppNavProps> = ({ items, className }) => (
    <nav className={cn('app-tabbar justify-around shrink-0 px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] border-t border-line bg-panel', className)}>
        {items.map(item => (
            <button
                key={item.id}
                type="button"
                onClick={item.onSelect}
                aria-current={item.active ? 'page' : undefined}
                className={cn(itemClass(item.active), 'flex-1 max-w-[88px] py-1.5')}
            >
                {item.icon}
                {item.label}
            </button>
        ))}
    </nav>
);
