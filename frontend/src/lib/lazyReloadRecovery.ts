import type { MaterialRequest } from '../components/material/MaterialView';
import type { SettingsCategory } from '../components/settings/SettingsView';

const LAZY_RELOAD_RECOVERY_KEY = 'alslime.lazyReloadRecovery';
const LAZY_RELOAD_RECOVERY_VERSION = 1;

export type RecoverableView = 'chat' | 'settings' | 'material';

export interface LazyReloadRecovery {
    version: number;
    sessionId: string | null;
    ssrpSettings: unknown;
    activeView: RecoverableView;
    materialRequest: MaterialRequest | null;
    settingsCategory: SettingsCategory;
    prepareOpen: boolean;
}

const isRecoverableView = (value: unknown): value is RecoverableView => (
    value === 'chat' || value === 'settings' || value === 'material'
);

export const saveLazyReloadRecovery = (state: Omit<LazyReloadRecovery, 'version'>): boolean => {
    try {
        sessionStorage.setItem(LAZY_RELOAD_RECOVERY_KEY, JSON.stringify({
            version: LAZY_RELOAD_RECOVERY_VERSION,
            ...state,
        }));
        return true;
    } catch {
        return false;
    }
};

export const readLazyReloadRecovery = (): LazyReloadRecovery | null => {
    try {
        const raw = sessionStorage.getItem(LAZY_RELOAD_RECOVERY_KEY);
        if (!raw) return null;
        const value = JSON.parse(raw) as Partial<LazyReloadRecovery>;
        if (value.version !== LAZY_RELOAD_RECOVERY_VERSION || !isRecoverableView(value.activeView)) {
            sessionStorage.removeItem(LAZY_RELOAD_RECOVERY_KEY);
            return null;
        }
        return {
            version: value.version,
            sessionId: typeof value.sessionId === 'string' ? value.sessionId : null,
            ssrpSettings: value.ssrpSettings ?? null,
            activeView: value.activeView,
            materialRequest: value.materialRequest ?? null,
            settingsCategory: value.settingsCategory ?? 'general',
            prepareOpen: value.prepareOpen === true,
        };
    } catch {
        return null;
    }
};

export const clearLazyReloadRecovery = (): void => {
    try {
        sessionStorage.removeItem(LAZY_RELOAD_RECOVERY_KEY);
    } catch {
        // 保存先を使えない環境では復旧情報も存在しないため何もしない
    }
};
