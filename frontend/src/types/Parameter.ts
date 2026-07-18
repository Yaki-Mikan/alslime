/**
 * パラメータ外部入力化機能 - 型定義（フロントエンド）
 */

// 多言語対応のローカライズ文字列型
export interface LocalizedString {
    ja: string;
    en?: string;
}

// 要素タイプ
export type ElementType =
    | 'slider'
    | 'dropdown'
    | 'text'
    | 'textarea'
    | 'toggle'
    | 'composite';

// 表示条件
export interface ShowCondition {
    parentId: string;
    operator: '===' | '!==' | '>' | '<' | '>=' | '<=' | 'range';
    value?: any;
    min?: number;
    max?: number;
}

// ドロップダウンオプション
export interface DropdownOption {
    value: any;
    label: LocalizedString;
}

// 要素タイプ別設定
export interface ElementConfig {
    // slider用
    min?: number;
    max?: number;
    step?: number;

    // dropdown用
    options?: DropdownOption[];

    // text用
    separator?: string;
    placeholder?: LocalizedString;

    // textarea用
    rows?: number;

    // composite用（年月日）
    compositeType?: 'yearMonthDay';
    yearRange?: [number, number];
    monthRange?: [number, number];
    dayRange?: [number, number];
}

// パラメータ要素
export interface ParameterElement {
    id: string;
    type: ElementType;
    displayName: LocalizedString;
    description: LocalizedString;
    defaultValue: any;

    // 親子関係
    parentId?: string;
    showCondition?: ShowCondition;

    // 要素タイプ別設定
    config?: ElementConfig;
}

// パラメータグループ
export interface ParameterGroup {
    id: string;
    displayName: LocalizedString;
    isFixed: boolean;
    defaultOpen: boolean;
    defaultEnabled: boolean;
    elements: ParameterElement[];
}

// 項目設定ファイルのルート型
export interface ParameterSchema {
    schemaName: LocalizedString;
    schemaId: string;
    groups: ParameterGroup[];
}

// セッション保存用 - パラメータグループ状態
export interface ParameterGroupState {
    id: string;
    enabled: boolean;
    isOpen: boolean;
    values: Record<string, any>;
}

// 項目設定一覧用
export interface ParameterSchemaListItem {
    id: string;
    name: LocalizedString;
}

// ローカライズ文字列からテキストを取得
export function getLocalizedText(ls: LocalizedString, lang: 'ja' | 'en' = 'ja'): string {
    return ls[lang] || ls.ja;
}
