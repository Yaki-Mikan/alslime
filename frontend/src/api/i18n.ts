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

// 入力の不備の補足に入る入力欄の識別子を、欄の名前へ直すための辞書キーの接頭辞。
const INPUT_FIELD_LABEL_KEY_PREFIX = 'label.nai.inputField.';

// parseBackendErrorValues は「名前=値; 名前=値」の形の補足を読む。この形でなければ null。
const parseBackendErrorValues = (detail: string): Record<string, string> | null => {
    const values: Record<string, string> = {};
    for (const part of detail.split(';')) {
        const match = /^\s*([A-Za-z][A-Za-z0-9]*)=(.*)$/.exec(part);
        if (!match) return null;
        values[match[1]] = match[2].trim();
    }
    return values;
};

// resolveBackendError は「辞書キー: 補足」の形で届くエラー文字列を表示文言へ解決する。
// キーを文言にし、補足（状態コードや相手先の説明）は括弧で添える。文言に {{名前}} の差し込み口が
// あり、補足が「名前=値; 名前=値」の形のときは、値を差し込む（入力欄の識別子は欄の名前へ直す）。
// 辞書キーで始まらない文字列や未翻訳のキーはそのまま返す。
export const resolveBackendError = (catalog: I18NCatalog | null, raw: string | null | undefined): string => {
    const text = (raw ?? '').trim();
    const match = /^((?:error|warning|message)\.[A-Za-z0-9_.]+?)(?::\s*([\s\S]*))?$/.exec(text);
    if (!match) return text;
    const resolved = catalog?.messages?.[match[1]];
    if (!resolved) return text;
    const detail = (match[2] ?? '').trim();
    if (detail && /\{\{\w+\}\}/.test(resolved)) {
        const values = parseBackendErrorValues(detail);
        if (values) {
            const label = (value: string) => value
                .split(',')
                .map(item => catalog?.messages?.[INPUT_FIELD_LABEL_KEY_PREFIX + item.trim()] ?? item.trim())
                .join(' / ');
            return resolved.replace(/\{\{(\w+)\}\}/g, (slot, name: string) => (name in values ? label(values[name]) : slot));
        }
    }
    return detail ? `${resolved}（${detail}）` : resolved;
};
