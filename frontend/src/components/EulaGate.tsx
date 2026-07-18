import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, Languages } from 'lucide-react';
import axios from '../lib/axios';
import { BACKEND_URL } from '../api/base-url';
import {
    EULA_CONSENT_KEY,
    EULA_FULL_TEXT_EN,
    EULA_FULL_TEXT_JA,
    EULA_TITLE_EN,
    EULA_TITLE_JA,
    EULA_VERSION,
} from '../constants/eula';
import type { EulaConsent } from '../constants/eula';
import {
    APP_I18N_KEYS,
    APP_TEXT_FALLBACK_JA,
    COMMON_I18N_KEYS,
    COMMON_TEXT_FALLBACK_JA,
    DEFAULT_UI_LANGUAGE,
    UI_LANGUAGE_LABELS,
    UI_LANGUAGE_OPTIONS,
} from '../constants/i18n';
import { fetchI18NCatalog, fetchI18NLanguages, resolveMessage } from '../api/i18n';
import type { I18NCatalog } from '../api/i18n';

// EulaGate は利用規約への同意が記録されるまで children（アプリ本体）を表示しない門。
// 同意記録は pwa-settings.json（POST /api/settings のパーシャルマージ）に保存する。
// 規約文面を改定したら EULA_VERSION が変わり、版不一致で再同意を求める。
// 設定取得に失敗した場合も安全側（同意画面表示）に倒す。
// 言語設定は同意画面にもプルダウンを置き、変更は即時反映（辞書切替＋保存）する。

interface EulaGateProps {
    children: ReactNode;
}

type GateStatus = 'loading' | 'needed' | 'accepted';

export function EulaGate({ children }: EulaGateProps) {
    const [status, setStatus] = useState<GateStatus>('loading');
    const [checkedAge, setCheckedAge] = useState(false);
    const [checkedExternalAI, setCheckedExternalAI] = useState(false);
    const [checkedAsIs, setCheckedAsIs] = useState(false);
    const [showFullText, setShowFullText] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(false);

    // 言語設定（同意画面でも切替可能。変更は即時反映する）
    const [uiLanguage, setUILanguage] = useState(DEFAULT_UI_LANGUAGE);
    const [uiCatalog, setUICatalog] = useState<I18NCatalog | null>(null);
    const [uiLanguageOptions, setUILanguageOptions] = useState(UI_LANGUAGE_OPTIONS);

    const t = (key: string) =>
        resolveMessage(uiCatalog, key, APP_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key);

    const loadCatalog = async (lang: string) => {
        try {
            const catalog = await fetchI18NCatalog(BACKEND_URL, lang);
            setUICatalog(catalog);
        } catch (err) {
            console.error('[EULA] Failed to load UI catalog:', err);
            setUICatalog(null);
        }
    };

    useEffect(() => {
        const checkConsent = async () => {
            try {
                const response = await axios.get(`${BACKEND_URL}/api/settings`);
                const consent = response.data?.[EULA_CONSENT_KEY] as EulaConsent | undefined;
                const savedLanguage = (response.data?.uiLanguage as string) || DEFAULT_UI_LANGUAGE;
                setUILanguage(savedLanguage);
                if (savedLanguage !== DEFAULT_UI_LANGUAGE) {
                    await loadCatalog(savedLanguage);
                }
                setStatus(consent?.version === EULA_VERSION ? 'accepted' : 'needed');
            } catch (err) {
                console.error('[EULA] Failed to load consent state:', err);
                setStatus('needed');
            }
            try {
                const languages = await fetchI18NLanguages(BACKEND_URL);
                setUILanguageOptions(languages.languages.map(lang => ({
                    value: lang,
                    label: UI_LANGUAGE_LABELS[lang] || lang,
                })));
            } catch (err) {
                setUILanguageOptions(UI_LANGUAGE_OPTIONS);
                console.error('[EULA] Failed to fetch UI languages:', err);
            }
        };
        checkConsent();
    }, []);

    // 言語変更は即時反映: 表示辞書を切り替え、設定へも保存する
    // （祝日カレンダーは日本語UI専用のため、他言語では無効化して保存する）。
    const handleLanguageChange = async (lang: string) => {
        setUILanguage(lang);
        await loadCatalog(lang);
        try {
            const updates: Record<string, unknown> = { uiLanguage: lang };
            if (lang !== DEFAULT_UI_LANGUAGE) {
                updates.holidayCalendarEnabled = false;
            }
            await axios.post(`${BACKEND_URL}/api/settings`, updates);
        } catch (err) {
            console.error('[EULA] Failed to save UI language:', err);
        }
    };

    const allChecked = checkedAge && checkedExternalAI && checkedAsIs;

    const handleAgree = async () => {
        if (!allChecked || saving) return;
        setSaving(true);
        setSaveError(false);
        try {
            const consent: EulaConsent = {
                version: EULA_VERSION,
                acceptedAt: new Date().toISOString(),
            };
            await axios.post(`${BACKEND_URL}/api/settings`, { [EULA_CONSENT_KEY]: consent });
            setStatus('accepted');
        } catch (err) {
            console.error('[EULA] Failed to save consent:', err);
            setSaveError(true);
        } finally {
            setSaving(false);
        }
    };

    if (status === 'accepted') {
        return <>{children}</>;
    }

    if (status === 'loading') {
        return (
            <div className="h-screen flex items-center justify-center bg-gray-900 text-white">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400 mx-auto mb-4"></div>
                    <p className="text-gray-400">{t(COMMON_I18N_KEYS.loading)}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4 overflow-y-auto">
            <div className="bg-gray-800 p-8 rounded-2xl shadow-xl max-w-lg w-full space-y-6 my-auto">
                <div className="flex justify-center">
                    <img src="/icons/app-192.png" alt="AlSlime" className="w-20 h-20" />
                </div>
                <h1 className="text-2xl font-bold text-center">{t(APP_I18N_KEYS.eulaTitle)}</h1>

                {/* 言語設定（変更は即時反映） */}
                <div className="flex items-center gap-2">
                    <Languages size={16} className="text-blue-400 shrink-0" />
                    <div className="relative flex-1">
                        <select
                            value={uiLanguage}
                            onChange={(e) => handleLanguageChange(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500 appearance-none cursor-pointer hover:bg-gray-700 pr-8"
                        >
                            {uiLanguageOptions.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                    </div>
                </div>

                <p className="text-gray-300 text-sm">{t(APP_I18N_KEYS.eulaIntro)}</p>

                <div className="space-y-3 text-left">
                    <label className="flex items-start gap-3 cursor-pointer text-sm text-gray-200">
                        <input
                            type="checkbox"
                            checked={checkedAge}
                            onChange={(e) => setCheckedAge(e.target.checked)}
                            className="mt-1 w-4 h-4 shrink-0 accent-blue-500"
                        />
                        <span>{t(APP_I18N_KEYS.eulaCheckAge)}</span>
                    </label>
                    <label className="flex items-start gap-3 cursor-pointer text-sm text-gray-200">
                        <input
                            type="checkbox"
                            checked={checkedExternalAI}
                            onChange={(e) => setCheckedExternalAI(e.target.checked)}
                            className="mt-1 w-4 h-4 shrink-0 accent-blue-500"
                        />
                        <span>{t(APP_I18N_KEYS.eulaCheckExternalAI)}</span>
                    </label>
                    <label className="flex items-start gap-3 cursor-pointer text-sm text-gray-200">
                        <input
                            type="checkbox"
                            checked={checkedAsIs}
                            onChange={(e) => setCheckedAsIs(e.target.checked)}
                            className="mt-1 w-4 h-4 shrink-0 accent-blue-500"
                        />
                        <span>{t(APP_I18N_KEYS.eulaCheckAsIs)}</span>
                    </label>
                </div>

                <button
                    onClick={() => setShowFullText((v) => !v)}
                    className="text-sm text-blue-400 hover:text-blue-300 underline"
                >
                    {showFullText ? t(APP_I18N_KEYS.eulaHideFull) : t(APP_I18N_KEYS.eulaReadFull)}
                </button>

                {showFullText && (
                    <div className="bg-gray-900 rounded-lg p-4 max-h-64 overflow-y-auto text-left">
                        {/* 規約の正文は日本語版。日本語以外のUIでは en 版全文＋日本語版優先の注記を表示する */}
                        {uiLanguage !== DEFAULT_UI_LANGUAGE && (
                            <p className="text-xs text-amber-300 mb-2">{t(APP_I18N_KEYS.eulaJaPrevails)}</p>
                        )}
                        <h2 className="text-sm font-bold mb-2">
                            {uiLanguage === DEFAULT_UI_LANGUAGE ? EULA_TITLE_JA : EULA_TITLE_EN}
                        </h2>
                        <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
                            {uiLanguage === DEFAULT_UI_LANGUAGE ? EULA_FULL_TEXT_JA : EULA_FULL_TEXT_EN}
                        </pre>
                    </div>
                )}

                {saveError && (
                    <div className="text-red-400 text-sm bg-red-900/20 p-3 rounded-lg">
                        {t(APP_I18N_KEYS.eulaSaveFailed)}
                    </div>
                )}

                <button
                    onClick={handleAgree}
                    disabled={!allChecked || saving}
                    className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
                >
                    {t(APP_I18N_KEYS.eulaAgree)}
                </button>
            </div>
        </div>
    );
}
