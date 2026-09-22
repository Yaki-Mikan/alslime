import { useEffect, useState } from 'react';
import { MODULE_TTS, fetchModulesStatus } from '../api/sponsor';

// TTS 連携モジュールの稼働状態を取り直す間隔。サイドカーは本体起動後に非同期で
// 起動し（ポート報告待ちの上限 15 秒）、異常終了で接続先が外れるため、一度きりの
// 取得では表示と実際の稼働がずれる。
export const TTS_MODULE_STATUS_POLL_INTERVAL_MS = 30_000;

/**
 * useTTSModuleActive は TTS 連携の実体（サイドカー / in-process）の稼働状態を返す。
 *
 * TTS 機能が有効な支援レベルの間だけ、初回・定期・画面の再表示時に取り直す。
 * 取得失敗は安全側の false とする。機能が無効になったとき・破棄時は確認を止める。
 * 返す setter は、画面からのモジュール導入・更新の結果を即時反映するために使う。
 */
export function useTTSModuleActive(backendUrl: string, featureEnabled: boolean) {
    const [active, setActive] = useState(false);
    useEffect(() => {
        if (!featureEnabled) return;
        let disposed = false;
        // 取得ごとの連番。先に始めた取得の応答が後から届いても、新しい状態を上書きしない。
        let latestRequest = 0;
        const refresh = async () => {
            const request = ++latestRequest;
            const isCurrent = () => !disposed && request === latestRequest;
            try {
                const modules = await fetchModulesStatus(backendUrl);
                if (isCurrent()) setActive(modules.some(m => m.id === MODULE_TTS && m.active));
            } catch {
                if (isCurrent()) setActive(false);
            }
        };
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') void refresh();
        };
        void refresh();
        const timer = setInterval(() => void refresh(), TTS_MODULE_STATUS_POLL_INTERVAL_MS);
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            disposed = true;
            clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            // 機能が再び有効になった時に前回の稼働状態を持ち越さない（取り直すまで非表示）。
            setActive(false);
        };
    }, [backendUrl, featureEnabled]);
    return [featureEnabled && active, setActive] as const;
}
