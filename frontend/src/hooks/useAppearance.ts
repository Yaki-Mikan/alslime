import { useEffect } from 'react';
import { FONT_FAMILY_DESIGN, type Settings, type UIDesign, type UITheme } from '../types/Settings';

// index.html の先当て処理と同じキー。値の正本は API 側の設定で、ここは起動直後のちらつき対策の写し。
export const APPEARANCE_STORAGE_KEY = 'alslime.appearance';

const DARK_QUERY = '(prefers-color-scheme: dark)';

// しっぽり明朝の読み込み用 CSS は約300KBあるため、使うときだけ読み込む（一度読めば以降は不要）。
let serifFontRequested = false;
const ensureSerifFont = () => {
    if (serifFontRequested) return;
    serifFontRequested = true;
    void import('../styles/fonts/shippori-mincho.css');
};

const usesSerifFont = (design: UIDesign, fontFamily: string) =>
    design !== 'minimal' || fontFamily.includes('Shippori Mincho');

export type ResolvedMode = 'dark' | 'light';

export const resolveMode = (theme: UITheme): ResolvedMode => {
    if (theme === 'light' || theme === 'dark') return theme;
    if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
    return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
};

const applyThemeColorMeta = () => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) return;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--c-bg').trim();
    if (bg) meta.content = bg;
};

const applyDesignAndMode = (design: UIDesign, theme: UITheme) => {
    const root = document.documentElement;
    root.dataset.design = design;
    root.dataset.mode = resolveMode(theme);
    applyThemeColorMeta();
};

const rememberAppearance = (design: UIDesign, theme: UITheme) => {
    try {
        localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ design, theme }));
    } catch {
        // 保存できない環境（プライベートブラウズ等）では先当てが効かないだけ
    }
};

type AppearanceSettings = Pick<Settings, 'uiDesign' | 'theme' | 'fontFamily' | 'uiLanguage'>;

/**
 * 設定のデザイン・明るさ・本文の字体・表示言語を画面全体へ当てる。
 * 明るさが「端末に合わせる」のときは、端末側の切り替えを監視して追従する。
 */
export function useAppearance({ uiDesign, theme, fontFamily, uiLanguage }: AppearanceSettings) {
    useEffect(() => {
        applyDesignAndMode(uiDesign, theme);
        rememberAppearance(uiDesign, theme);
        if (theme !== 'system' || !window.matchMedia) return;
        const media = window.matchMedia(DARK_QUERY);
        const onChange = () => applyDesignAndMode(uiDesign, theme);
        media.addEventListener('change', onChange);
        return () => media.removeEventListener('change', onChange);
    }, [uiDesign, theme]);

    useEffect(() => {
        if (usesSerifFont(uiDesign, fontFamily ?? '')) ensureSerifFont();
    }, [uiDesign, fontFamily]);

    useEffect(() => {
        const style = document.documentElement.style;
        if (fontFamily && fontFamily !== FONT_FAMILY_DESIGN) {
            style.setProperty('--ff-read-user', fontFamily);
        } else {
            style.removeProperty('--ff-read-user');
        }
    }, [fontFamily]);

    useEffect(() => {
        if (uiLanguage) document.documentElement.lang = uiLanguage;
    }, [uiLanguage]);
}
