import axios from '../lib/axios';
import { DEFAULT_UI_LANGUAGE, TEXT_PATTERN_FALLBACK_JA, TEXT_PATTERN_I18N_KEYS } from '../constants/i18n';

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

// fillPattern は区切り・括弧の型（TEXT_PATTERN_I18N_KEYS）の {{名前}} へ値を差し込む。
const fillPattern = (catalog: I18NCatalog | null, key: string, values: Record<string, string>): string =>
    resolveMessage(catalog, key, TEXT_PATTERN_FALLBACK_JA[key])
        .replace(/\{\{(\w+)\}\}/g, (slot, name: string) => (name in values ? values[name] : slot));

/** 名前や項目を並べる（日本語は「・」区切り）。 */
export const joinNames = (catalog: I18NCatalog | null, names: string[]): string =>
    names.join(resolveMessage(catalog, TEXT_PATTERN_I18N_KEYS.nameSeparator, TEXT_PATTERN_FALLBACK_JA[TEXT_PATTERN_I18N_KEYS.nameSeparator]));

/** 文の中で項目を列挙する（日本語は「、」区切り）。 */
export const joinList = (catalog: I18NCatalog | null, items: string[]): string =>
    items.join(resolveMessage(catalog, TEXT_PATTERN_I18N_KEYS.listSeparator, TEXT_PATTERN_FALLBACK_JA[TEXT_PATTERN_I18N_KEYS.listSeparator]));

/** 「名前：値」の形にする。 */
export const formatLabelValue = (catalog: I18NCatalog | null, label: string, value: string): string =>
    fillPattern(catalog, TEXT_PATTERN_I18N_KEYS.labelValue, { label, value });

/** 文に括弧書きの補足を添える。 */
export const formatWithNote = (catalog: I18NCatalog | null, text: string, note: string): string =>
    fillPattern(catalog, TEXT_PATTERN_I18N_KEYS.withNote, { text, note });

/** 対になる二つ（AI とモデルなど）を一続きに並べる。 */
export const formatPair = (catalog: I18NCatalog | null, first: string, second: string): string =>
    fillPattern(catalog, TEXT_PATTERN_I18N_KEYS.pair, { first, second });

/** 親と子（接続先とモデルなど）を階層として並べる。 */
export const formatNested = (catalog: I18NCatalog | null, parent: string, child: string): string =>
    fillPattern(catalog, TEXT_PATTERN_I18N_KEYS.nested, { parent, child });

/** 別々の情報二つを斜線で区切って並べる。 */
export const formatSlashPair = (catalog: I18NCatalog | null, first: string, second: string): string =>
    fillPattern(catalog, TEXT_PATTERN_I18N_KEYS.slash, { first, second });

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
    return detail ? formatWithNote(catalog, resolved, detail) : resolved;
};
