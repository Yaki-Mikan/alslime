/**
 * 日付時刻設定の型定義
 * 
 * 会話設定メニューの日付時刻設定グループで使用する型を定義
 */

// 日付時刻値（年月日時分秒）
export interface DateTimeValue {
    year: number;
    month: number;  // 1-12
    day: number;    // 1-31
    hour: number;   // 0-23
    minute: number; // 0-59
    second?: number; // 0-59（省略時0扱い。UnifiedSessionTimeと整合）
}

// インクリメント値
export interface IncrementValues {
    years?: number;
    months?: number;
    days?: number;
    hours: number;
    minutes: number;
    seconds?: number;
}

// インクリメント設定
export interface IncrementSettings {
    enabled: boolean;
    detailMode: boolean;  // 詳細モード（年月日時分秒）
    values: IncrementValues;
    nextIncrement?: IncrementValues;  // 次回のインクリメント量（編集可能）
}

// 日付時刻設定の状態
export interface DateTimeSettingsState {
    enabled: boolean;
    mode: 'current' | 'fixed';
    fixedDateTime: DateTimeValue;
    useTodayDate: boolean;  // 「日付を今日にする」トグル
    increment: IncrementSettings;
    currentSessionTime?: DateTimeValue;  // セッション中の現在時刻（最後に履歴へ残ったバブルの絶対時刻）
    totalElapsedDays?: number;  // 累積経過日数（小数点以下含む。つきあいの長さ連動の経過量バッファ）
    /** つきあいの長さをセッション経過時刻と連動させるか（ON時のみtotalElapsedDaysを累積・relationshipDurationへ加算） */
    linkRelationshipToElapsed?: boolean;
    updatedAt?: string;  // 最終更新日時（ISO 8601形式）
}

// 日付時刻プリセット（日付時刻の値のみ）
export interface DateTimePreset {
    name: string;
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
}

// 時刻設定グループプリセット（全設定値を含む）
export interface DateTimeGroupPreset {
    name: string;
    enabled: boolean;
    mode: 'current' | 'fixed';
    fixedDateTime: DateTimeValue;
    useTodayDate: boolean;
    increment: IncrementSettings;  // nextIncrementも含む（IncrementSettingsの一部。B7対応）
    /** つきあいの長さ連動（B7: グループプリセットでも保存・復元する） */
    linkRelationshipToElapsed?: boolean;
}

/**
 * デフォルト設定を生成する（新規セッション用）。
 * fixedDateTimeはモジュール読込時刻に固着させず、呼び出し毎に「今」を評価する（B5: 化石化除去）。
 */
export function getDefaultDateTimeSettings(): DateTimeSettingsState {
    const now = new Date();
    return {
        enabled: false,
        mode: 'current',
        fixedDateTime: {
            year: now.getFullYear(),
            month: now.getMonth() + 1,
            day: now.getDate(),
            hour: now.getHours(),
            minute: now.getMinutes(),
            second: 0
        },
        useTodayDate: false,
        increment: {
            enabled: false,
            detailMode: false,
            values: {
                hours: 0,
                minutes: 0
            }
        }
    };
}

/**
 * @deprecated モジュール読込時刻が固着するため使用しない（B5）。getDefaultDateTimeSettings() を呼ぶこと。
 * 後方互換のため残置。fixedDateTimeは便宜上0埋め（実値はgetDefaultDateTimeSettings()が動的生成）。
 */
export const DEFAULT_DATETIME_SETTINGS: DateTimeSettingsState = {
    enabled: false,
    mode: 'current',
    fixedDateTime: { year: 2000, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
    useTodayDate: false,
    increment: {
        enabled: false,
        detailMode: false,
        values: {
            hours: 0,
            minutes: 0
        }
    }
};

// ユーティリティ: DateTimeValueをDateオブジェクトに変換
export function dateTimeValueToDate(dtv: DateTimeValue): Date {
    return new Date(dtv.year, dtv.month - 1, dtv.day, dtv.hour, dtv.minute, dtv.second);
}

// ユーティリティ: DateオブジェクトをDateTimeValueに変換
export function dateToDateTimeValue(date: Date): DateTimeValue {
    return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: date.getHours(),
        minute: date.getMinutes(),
        second: date.getSeconds()
    };
}

// ユーティリティ: 無効な日付を自動補正
export function validateAndCorrectDate(dtv: DateTimeValue): DateTimeValue {
    // Dateオブジェクトを通すことで自動補正される
    const date = new Date(dtv.year, dtv.month - 1, dtv.day, dtv.hour, dtv.minute, dtv.second);
    return dateToDateTimeValue(date);
}
