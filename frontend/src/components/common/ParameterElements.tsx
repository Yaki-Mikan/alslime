/**
 * ParameterElements - パラメータ要素の動的UI生成コンポーネント
 * 
 * ParameterSettings と RolePlaySettings の両方で使用可能な共通コンポーネント
 * 外部JSONスキーマに基づいてUI要素を動的に生成する
 */
import React from 'react';
import { ChevronDown, ChevronRight, Lock, Minus, Plus } from 'lucide-react';
import type {
    ParameterGroup,
    ParameterElement,
    ParameterGroupState
} from '../../types/Parameter';
import { getLocalizedText } from '../../types/Parameter';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { PARAMETER_ELEMENTS_I18N_KEYS, PARAMETER_ELEMENTS_TEXT_FALLBACK_JA } from '../../constants/i18n';

const resolveParameterText = (uiCatalog: I18NCatalog | null, key: string) => {
    return resolveMessage(uiCatalog, key, PARAMETER_ELEMENTS_TEXT_FALLBACK_JA[key] || key);
};

const formatParameterText = (template: string, values: Record<string, string | number>) => {
    return Object.entries(values).reduce((text, [key, value]) => {
        return text.split(`{{${key}}}`).join(String(value));
    }, template);
};

// 条件付き表示の評価関数
export const evaluateShowCondition = (condition: ParameterElement['showCondition'], parentValue: any): boolean => {
    if (!condition) return true;

    const { operator, value, min, max } = condition;

    switch (operator) {
        case '===':
            return parentValue === value;
        case '!==':
            return parentValue !== value;
        case '>':
            return typeof parentValue === 'number' && parentValue > value;
        case '<':
            return typeof parentValue === 'number' && parentValue < value;
        case '>=':
            return typeof parentValue === 'number' && parentValue >= value;
        case '<=':
            return typeof parentValue === 'number' && parentValue <= value;
        case 'range':
            return typeof parentValue === 'number' &&
                (min === undefined || parentValue >= min) &&
                (max === undefined || parentValue <= max);
        default:
            return true;
    }
};

// パラメータスライダーコンポーネント
interface ParameterSliderProps {
    element: ParameterElement;
    value: number;
    onChange: (value: number) => void;
}

export const ParameterSlider: React.FC<ParameterSliderProps> = ({ element, value, onChange }) => {
    const min = element.config?.min ?? 0;
    const max = element.config?.max ?? 100;
    const step = element.config?.step ?? 1;

    // テキスト入力用のローカル状態
    const [inputValue, setInputValue] = React.useState(value.toString());

    // 外部から値が変更された場合に同期
    React.useEffect(() => {
        setInputValue(value.toString());
    }, [value]);

    const handleInputCommit = () => {
        let val = parseInt(inputValue);
        if (isNaN(val)) val = min;
        val = Math.max(min, Math.min(max, val));
        onChange(val);
        setInputValue(val.toString());
    };

    return (
        <div className="space-y-1">
            {/* 上段: ラベルと値入力 */}
            <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-300">
                    {getLocalizedText(element.displayName)}
                </label>
                {/* 値入力（テキスト編集可能） */}
                <input
                    type="text"
                    inputMode="numeric"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onBlur={handleInputCommit}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            handleInputCommit();
                            (e.target as HTMLInputElement).blur();
                        }
                    }}
                    className="w-14 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-center text-sm"
                />
            </div>
            {/* 下段: スライダーとステッパー */}
            <div className="flex items-center gap-2">
                {/* スライダー（伸びる） */}
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onChange={(e) => onChange(parseInt(e.target.value))}
                    className="flex-1 accent-blue-500"
                />
                {/* ステッパー [-] [+] */}
                <button
                    type="button"
                    onClick={() => {
                        const newVal = Math.max(min, value - step);
                        onChange(newVal);
                    }}
                    className="w-7 h-7 flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded text-gray-300 hover:text-white transition-colors flex-shrink-0"
                    disabled={value <= min}
                >
                    <Minus size={14} />
                </button>
                <button
                    type="button"
                    onClick={() => {
                        const newVal = Math.min(max, value + step);
                        onChange(newVal);
                    }}
                    className="w-7 h-7 flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded text-gray-300 hover:text-white transition-colors flex-shrink-0"
                    disabled={value >= max}
                >
                    <Plus size={14} />
                </button>
            </div>
            <p className="text-xs text-gray-500">{getLocalizedText(element.description)}</p>
        </div>
    );
};

// ドロップダウンコンポーネント
interface ParameterDropdownProps {
    element: ParameterElement;
    value: any;
    onChange: (value: any) => void;
}

export const ParameterDropdown: React.FC<ParameterDropdownProps> = ({ element, value, onChange }) => {
    const options = element.config?.options || [];

    return (
        <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">
                {getLocalizedText(element.displayName)}
            </label>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
            >
                {options.map((opt: any, idx: number) => (
                    <option key={idx} value={opt.value}>
                        {getLocalizedText(opt.label)}
                    </option>
                ))}
            </select>
            <p className="text-xs text-gray-500">{getLocalizedText(element.description)}</p>
        </div>
    );
};

// テキスト入力コンポーネント
interface ParameterTextProps {
    element: ParameterElement;
    value: string;
    onChange: (value: string) => void;
}

export const ParameterText: React.FC<ParameterTextProps> = ({ element, value, onChange }) => {
    const placeholder = element.config?.placeholder
        ? getLocalizedText(element.config.placeholder)
        : '';

    return (
        <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">
                {getLocalizedText(element.displayName)}
            </label>
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
            />
            <p className="text-xs text-gray-500">{getLocalizedText(element.description)}</p>
        </div>
    );
};

// テキストエリアコンポーネント
interface ParameterTextareaProps {
    element: ParameterElement;
    value: string;
    onChange: (value: string) => void;
}

export const ParameterTextarea: React.FC<ParameterTextareaProps> = ({ element, value, onChange }) => {
    const placeholder = element.config?.placeholder
        ? getLocalizedText(element.config.placeholder)
        : '';
    const rows = element.config?.rows ?? 3;

    return (
        <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">
                {getLocalizedText(element.displayName)}
            </label>
            <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                rows={rows}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm resize-none"
            />
            <p className="text-xs text-gray-500">{getLocalizedText(element.description)}</p>
        </div>
    );
};

// トグルコンポーネント
interface ParameterToggleProps {
    element: ParameterElement;
    value: boolean;
    onChange: (value: boolean) => void;
}

export const ParameterToggle: React.FC<ParameterToggleProps> = ({ element, value, onChange }) => {
    return (
        <div className="flex items-center justify-between py-2">
            <div>
                <label className="text-sm font-medium text-gray-300">
                    {getLocalizedText(element.displayName)}
                </label>
                <p className="text-xs text-gray-500">{getLocalizedText(element.description)}</p>
            </div>
            <button
                onClick={() => onChange(!value)}
                className={`relative w-12 h-6 rounded-full transition-colors ${value ? 'bg-blue-600' : 'bg-gray-700'}`}
            >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform shadow ${value ? 'translate-x-7' : 'translate-x-1'}`} />
            </button>
        </div>
    );
};

// Composite要素（年月日等）コンポーネント
interface ParameterCompositeProps {
    element: ParameterElement;
    value: any;
    onChange: (value: any) => void;
    uiCatalog?: I18NCatalog | null;
}

export const ParameterComposite: React.FC<ParameterCompositeProps> = ({ element, value, onChange, uiCatalog = null }) => {
    const compositeType = element.config?.compositeType;

    if (compositeType === 'yearMonthDay') {
        const currentValue = value || { years: 0, months: 0, days: 0 };

        return (
            <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">
                    {getLocalizedText(element.displayName)}
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                    <select
                        value={currentValue.years ?? 0}
                        onChange={(e) => onChange({ ...currentValue, years: parseInt(e.target.value) })}
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
                    >
                        {[...Array(101)].map((_, i) => (
                            <option key={i} value={i}>{formatParameterText(resolveParameterText(uiCatalog, PARAMETER_ELEMENTS_I18N_KEYS.yearUnit), { count: i })}</option>
                        ))}
                    </select>
                    <select
                        value={currentValue.months ?? 0}
                        onChange={(e) => onChange({ ...currentValue, months: parseInt(e.target.value) })}
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
                    >
                        {[...Array(12)].map((_, i) => (
                            <option key={i} value={i}>{formatParameterText(resolveParameterText(uiCatalog, PARAMETER_ELEMENTS_I18N_KEYS.monthUnit), { count: i })}</option>
                        ))}
                    </select>
                    <select
                        value={currentValue.days ?? 0}
                        onChange={(e) => onChange({ ...currentValue, days: parseInt(e.target.value) })}
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
                    >
                        {[...Array(31)].map((_, i) => (
                            <option key={i} value={i}>{formatParameterText(resolveParameterText(uiCatalog, PARAMETER_ELEMENTS_I18N_KEYS.dayUnit), { count: i })}</option>
                        ))}
                    </select>
                </div>
                {/* クイック設定 */}
                <div className="flex items-center gap-2">
                    <select
                        defaultValue=""
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm w-32"
                        onChange={(e) => {
                            if (e.target.value) {
                                const [y, m, d] = e.target.value.split(',').map(Number);
                                onChange({ years: y, months: m, days: d });
                                e.target.value = '';
                            }
                        }}
                    >
                        <option value="" disabled>{resolveParameterText(uiCatalog, PARAMETER_ELEMENTS_I18N_KEYS.quickSettings)}</option>
                        <option value="0,0,0">{resolveParameterText(uiCatalog, PARAMETER_ELEMENTS_I18N_KEYS.firstMeeting)}</option>
                        <option value="0,0,7">{resolveParameterText(uiCatalog, PARAMETER_ELEMENTS_I18N_KEYS.oneWeek)}</option>
                        <option value="0,1,0">{resolveParameterText(uiCatalog, PARAMETER_ELEMENTS_I18N_KEYS.oneMonth)}</option>
                        <option value="0,6,0">{resolveParameterText(uiCatalog, PARAMETER_ELEMENTS_I18N_KEYS.halfYear)}</option>
                        <option value="1,0,0">{resolveParameterText(uiCatalog, PARAMETER_ELEMENTS_I18N_KEYS.oneYear)}</option>
                        <option value="2,0,0">{resolveParameterText(uiCatalog, PARAMETER_ELEMENTS_I18N_KEYS.twoYears)}</option>
                    </select>
                    <span className="text-xs text-gray-500">{resolveParameterText(uiCatalog, PARAMETER_ELEMENTS_I18N_KEYS.quickApplyHint)}</span>
                </div>
                <p className="text-xs text-gray-500">{getLocalizedText(element.description)}</p>
            </div>
        );
    }

    // 他のcompositeタイプはここに追加
    return null;
};

// 要素レンダラー（統合）
interface RenderElementProps {
    element: ParameterElement;
    groupState: ParameterGroupState;
    onValueChange: (elementId: string, value: any) => void;
    uiCatalog?: I18NCatalog | null;
}

export const RenderElement: React.FC<RenderElementProps> = ({ element, groupState, onValueChange, uiCatalog = null }) => {
    const value = groupState.values[element.id] ?? element.defaultValue;

    // 条件付き表示の評価
    if (element.showCondition) {
        const parentValue = groupState.values[element.showCondition.parentId];
        if (!evaluateShowCondition(element.showCondition, parentValue)) {
            return null;
        }
    }

    const handleChange = (newValue: any) => onValueChange(element.id, newValue);

    switch (element.type) {
        case 'slider':
            return <ParameterSlider key={element.id} element={element} value={value} onChange={handleChange} />;
        case 'dropdown':
            return <ParameterDropdown key={element.id} element={element} value={value} onChange={handleChange} />;
        case 'text':
            return <ParameterText key={element.id} element={element} value={value} onChange={handleChange} />;
        case 'textarea':
            return <ParameterTextarea key={element.id} element={element} value={value} onChange={handleChange} />;
        case 'toggle':
            return <ParameterToggle key={element.id} element={element} value={value} onChange={handleChange} />;
        case 'composite':
            return <ParameterComposite key={element.id} element={element} value={value} onChange={handleChange} uiCatalog={uiCatalog} />;
        default:
            return null;
    }
};

// グループレンダラー
interface RenderGroupProps {
    groupDef: ParameterGroup;
    groupState: ParameterGroupState;
    onGroupStateChange: (updates: Partial<ParameterGroupState>) => void;
    onValueChange: (elementId: string, value: any) => void;
    uiCatalog?: I18NCatalog | null;
}

export const RenderGroup: React.FC<RenderGroupProps> = ({ groupDef, groupState, onGroupStateChange, onValueChange, uiCatalog = null }) => {
    const isOpen = groupState.isOpen;
    const isEnabled = groupState.enabled;
    const isFixed = groupDef.isFixed;

    return (
        <div className="border border-gray-700 rounded-lg overflow-hidden mb-4">
            {/* グループヘッダー */}
            <div className={`flex items-center justify-between p-3 ${isEnabled ? 'bg-gray-800' : 'bg-gray-900 opacity-60'}`}>
                <button
                    onClick={() => onGroupStateChange({ isOpen: !isOpen })}
                    className="flex items-center gap-2 text-left flex-1"
                >
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span className="font-medium">{getLocalizedText(groupDef.displayName)}</span>
                    {isFixed && <Lock size={14} className="text-gray-500" />}
                </button>

                {/* 有効/無効トグル */}
                {!isFixed ? (
                    <button
                        onClick={() => onGroupStateChange({ enabled: !isEnabled })}
                        className={`relative w-10 h-5 rounded-full transition-colors ${isEnabled ? 'bg-blue-600' : 'bg-gray-700'}`}
                    >
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow ${isEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                ) : (
                    <span className="text-xs text-gray-500">{resolveParameterText(uiCatalog, PARAMETER_ELEMENTS_I18N_KEYS.alwaysEnabled)}</span>
                )}
            </div>

            {/* グループ内容 */}
            {isOpen && (
                <div className={`p-4 space-y-4 ${!isEnabled && 'opacity-50 pointer-events-none'}`}>
                    {groupDef.elements.map(element => (
                        <RenderElement
                            key={element.id}
                            element={element}
                            groupState={groupState}
                            onValueChange={onValueChange}
                            uiCatalog={uiCatalog}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};
