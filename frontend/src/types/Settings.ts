/**
 * 設定の型定義
 */

import { DEFAULT_UI_LANGUAGE } from '../constants/i18n';

export interface Settings {
    fontFamily: string;
    fontSize: number;  // px単位
    lineHeight: number; // 行間 (em単位)
    emptyLineHeight: number;
    collapseEmptyLines: boolean;
    theme: 'dark' | 'light';
    temperature: number;  // 0.0 〜 2.0
    uiLanguage: string; // UI表示言語
    holidayCalendarEnabled: boolean; // 日本語UI専用: 祝日情報の自動取得とプロンプト反映
    defaultUserName: string; // 会話でのユーザー名の既定値（空なら言語別デフォルト名）

    // デバッグ用：セッション初回応答のみバックアップ
    enableFirstResponseBackup: boolean;
    // デバッグ用：レスポンス受信直後のセッションファイルバックアップ（全量）
    enableResponseBackup: boolean;

    // キャラクターアイコン表示サイズ（px）
    characterIconSize: number;

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
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: 14,
    lineHeight: 1.625,
    emptyLineHeight: 1.0,
    collapseEmptyLines: false,
    theme: 'dark',
    temperature: 1.0,
    uiLanguage: DEFAULT_UI_LANGUAGE,
    holidayCalendarEnabled: false,
    defaultUserName: '',
    enableFirstResponseBackup: false,
    enableResponseBackup: false,
    characterIconSize: 40,
    enableBackgroundImage: false,
    backgroundImageOpacity: 1.0,
    backgroundImageFit: 'cover',
    backgroundImageScope: 'history',
    backgroundChatInputAreaOpacity: 0.45,
    backgroundChatInputAreaMatchImageOpacity: false,
    messageBubbleOpacity: 0.8,
};
