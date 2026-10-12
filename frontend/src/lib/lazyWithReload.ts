import React from 'react';

// 版が切り替わった後も開いたままの画面は、もう存在しない古い部品ファイルを取りに行って失敗する。
// 1回だけ自動で再読み込みして新しい版へ切り替える。再読み込みしてもまた失敗したときは
// 繰り返さずにエラーを投げ、受け皿の画面（再読み込みボタン）へ任せる。
const RELOAD_MARK_KEY = 'alslime.lazyReloadAttempted';

type BeforeLazyReload = () => void;
let beforeLazyReload: BeforeLazyReload | null = null;

// 再読み込みが必要になった時点の画面状態を、呼び出し側が同期的に退避する。
// 登録解除時に別の画面が後から登録したハンドラを消さないよう、同一参照だけを解除する。
export function registerBeforeLazyReload(handler: BeforeLazyReload): () => void {
    beforeLazyReload = handler;
    return () => {
        if (beforeLazyReload === handler) beforeLazyReload = null;
    };
}

function hasReloadMark(): boolean {
    try {
        return sessionStorage.getItem(RELOAD_MARK_KEY) !== null;
    } catch {
        return false;
    }
}

// 印を残せない環境で再読み込みすると止まらなくなるため、残せたときだけ true を返す。
function setReloadMark(): boolean {
    try {
        sessionStorage.setItem(RELOAD_MARK_KEY, '1');
        return true;
    } catch {
        return false;
    }
}

function clearReloadMark(): void {
    try {
        sessionStorage.removeItem(RELOAD_MARK_KEY);
    } catch {
        // 消せなくても読み込み自体は成功しているので何もしない
    }
}

export function lazyWithReload<T extends React.ComponentType<any>>(
    factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
    return React.lazy(async () => {
        try {
            const module = await factory();
            clearReloadMark();
            return module;
        } catch (err) {
            if (!hasReloadMark() && setReloadMark()) {
                try {
                    beforeLazyReload?.();
                } catch {
                    // 退避に失敗しても、版不一致からの復旧処理は続ける
                }
                window.location.reload();
                // 再読み込みが始まるまで画面を差し替えない
                return new Promise<never>(() => {});
            }
            throw err;
        }
    });
}
