import axios from '../lib/axios';
import { DEFAULT_UI_LANGUAGE } from '../constants/i18n';

export interface I18NCatalog {
    lang: string;
    defaultLang: string;
    fallbackLang: string;
    messages: Record<string, string>;
}

export interface I18NLanguages {
    defaultLang: string;
    fallbackLang: string;
    languages: string[];
}

// fetchI18NLanguages は backend が認識している利用可能言語を取得する。
export const fetchI18NLanguages = async (backendUrl: string): Promise<I18NLanguages> => {
    const response = await axios.get(`${backendUrl}/api/i18n/languages`);
    return response.data;
};

// fetchI18NCatalog は UI 表示用の辞書を取得する。
export const fetchI18NCatalog = async (backendUrl: string, lang: string): Promise<I18NCatalog> => {
    const uiLanguage = lang || DEFAULT_UI_LANGUAGE;
    const response = await axios.get(`${backendUrl}/api/i18n/${encodeURIComponent(uiLanguage)}`);
    return response.data;
};

// resolveMessage は辞書キーを表示文言へ解決する。未取得・未翻訳時は fallback を使う。
export const resolveMessage = (
    catalog: I18NCatalog | null,
    key: string,
    fallback: string
): string => catalog?.messages?.[key] || fallback;
