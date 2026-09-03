import { useEffect, useState } from 'react';

const WIDE_SCREEN_QUERY = '(min-width: 1024px)';

// matchMedia が使えない環境（テスト等）では広画面扱いにする
const canQuery = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

// 画面幅がPC相当（横並びレイアウトが成立する幅）かどうかを返す
export function useIsWideScreen(): boolean {
    const [isWideScreen, setIsWideScreen] = useState(() =>
        canQuery() ? window.matchMedia(WIDE_SCREEN_QUERY).matches : true
    );
    useEffect(() => {
        if (!canQuery()) return;
        const mql = window.matchMedia(WIDE_SCREEN_QUERY);
        const onChange = (e: MediaQueryListEvent) => setIsWideScreen(e.matches);
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, []);
    return isWideScreen;
}
