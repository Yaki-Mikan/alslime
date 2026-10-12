/**
 * 設定の型定義
 */

import { DEFAULT_UI_LANGUAGE } from '../constants/i18n';

export const CHAT_SEND_KEYS = {
    enter: 'enter',
    shiftEnter: 'shiftEnter',
    ctrlEnter: 'ctrlEnter',
} as const;

export type ChatSendKey = typeof CHAT_SEND_KEYS[keyof typeof CHAT_SEND_KEYS];

export const DEFAULT_CHAT_SEND_KEY: ChatSendKey = CHAT_SEND_KEYS.shiftEnter;

export const UI_DESIGNS = ['minimal', 'wa', 'glass'] as const;
export type UIDesign = typeof UI_DESIGNS[number];

export const UI_THEMES = ['dark', 'light', 'system'] as const;
export type UITheme = typeof UI_THEMES[number];

// 会話の本文の字体を「デザインに合わせる」ときの値。
export const FONT_FAMILY_DESIGN = 'design';
// 「システムフォント」を自分で選んだときの値。旧既定値と区別するため別の文字列にしている。
export const FONT_FAMILY_SYSTEM = 'system-ui, sans-serif';
// 旧既定値。字体の設定は画面に効いていなかったため、この値は「デザインに合わせる」として読む。
export const LEGACY_DEFAULT_FONT_FAMILY = 'system-ui, -apple-system, sans-serif';

export interface Settings {
    fontFamily: string; // FONT_FAMILY_DESIGN か font-family の値
    fontSize: number;  // px単位
    lineHeight: number; // 行間 (em単位)
    emptyLineHeight: number;
    collapseEmptyLines: boolean;
    uiDesign: UIDesign;
    theme: UITheme; // 明るさ
    // 背景画像があるときの欄（左の列・会話・右の欄）のガラスの濃さ
    backgroundPanelOpacity: number;
    temperature: number;  // 0.0 〜 2.0
    uiLanguage: string; // UI表示言語
    holidayCalendarEnabled: boolean; // 日本語UI専用: 祝日情報の自動取得とプロンプト反映
    defaultUserName: string; // 会話でのユーザー名の既定値（空なら言語別デフォルト名）
    chatSendKey: ChatSendKey; // チャット入力欄で送信に使うキー

    // デバッグ用：セッション初回応答のみバックアップ
    enableFirstResponseBackup: boolean;
    // デバッグ用：CLI呼び出しごとの未加工stdoutバックアップ（全量）
    enableResponseBackup: boolean;

    // キャラクターアイコン表示サイズ（px）
    characterIconSize: number;
    // アイコンをチャットバブルの左へ置く（アイコンサイズ100px以上でのみ適用）
    characterIconOnBubbleLeft: boolean;

    // セッション内背景画像
    enableBackgroundImage: boolean;
    backgroundImageOpacity: number;
    backgroundImageFit: 'contain' | 'cover';
    backgroundImageScope: 'history' | 'chat';
    backgroundChatInputAreaOpacity: number;
    backgroundChatInputAreaMatchImageOpacity: boolean;
    messageBubbleOpacity: number;
}

/**
 * デフォルト設定
 */
export const DEFAULT_SETTINGS: Settings = {
    fontFamily: FONT_FAMILY_DESIGN,
    fontSize: 14,
    lineHeight: 1.625,
    emptyLineHeight: 1.0,
    collapseEmptyLines: false,
    uiDesign: 'minimal',
    theme: 'dark',
    backgroundPanelOpacity: 0.35,
    temperature: 1.0,
    uiLanguage: DEFAULT_UI_LANGUAGE,
    holidayCalendarEnabled: false,
    defaultUserName: '',
    chatSendKey: DEFAULT_CHAT_SEND_KEY,
    enableFirstResponseBackup: false,
    enableResponseBackup: false,
    characterIconSize: 40,
    characterIconOnBubbleLeft: false,
    enableBackgroundImage: false,
    backgroundImageOpacity: 1.0,
    backgroundImageFit: 'cover',
    backgroundImageScope: 'history',
    backgroundChatInputAreaOpacity: 0.45,
    backgroundChatInputAreaMatchImageOpacity: false,
    messageBubbleOpacity: 0.8,
};

/**
 * 保存値を既定値と合わせ、知らない値を既定へ戻す。
 * 字体の旧既定値は「デザインに合わせる」として読む（これまで画面に効いていなかったため）。
 */
export const normalizeSettings = (raw: Partial<Settings> | null | undefined): Settings => {
    const merged: Settings = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
    if (!merged.fontFamily || merged.fontFamily === LEGACY_DEFAULT_FONT_FAMILY) {
        merged.fontFamily = FONT_FAMILY_DESIGN;
    }
    if (!(UI_DESIGNS as readonly string[]).includes(merged.uiDesign)) {
        merged.uiDesign = DEFAULT_SETTINGS.uiDesign;
    }
    if (!(UI_THEMES as readonly string[]).includes(merged.theme)) {
        merged.theme = DEFAULT_SETTINGS.theme;
    }
    return merged;
};
