import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { SIMPLE_CHARACTER_I18N_KEYS, SIMPLE_CHARACTER_TEXT_FALLBACK_EN, SIMPLE_CHARACTER_TEXT_FALLBACK_JA } from '../../constants/i18n';

export interface SimpleCharacterConfig {
    base: {
        name: string;
        reading: string;
        nickname: string;
        age: string;
        gender: string;
        birthday: string;
        height: string;
        weight: string;
        threeSizes: { bust: string; waist: string; hip: string };
        hairStyle: string;
        eyeColor: string;
        skinColor: string;
    };
    personality: string;
    appearance: string;
    outfit: string;
    speechStyle: string;
    background: string;
    abilities: string;
    relationships: string;
    other: string;
}

export const EMPTY_SIMPLE_CHARACTER: SimpleCharacterConfig = {
    base: {
        name: '', reading: '', nickname: '', age: '', gender: '',
        birthday: '', height: '', weight: '',
        threeSizes: { bust: '', waist: '', hip: '' },
        hairStyle: '', eyeColor: '', skinColor: '',
    },
    personality: '', appearance: '', outfit: '', speechStyle: '',
    background: '', abilities: '', relationships: '', other: '',
};

const formatText = (template: string, values: Record<string, string | number>) => {
    return Object.entries(values).reduce((text, [key, value]) => {
        return text.split(`{{${key}}}`).join(String(value));
    }, template);
};

const createSimpleCharacterTranslator = (uiCatalog?: I18NCatalog | null) => {
    const fallback = uiCatalog?.lang?.startsWith('en')
        ? SIMPLE_CHARACTER_TEXT_FALLBACK_EN
        : SIMPLE_CHARACTER_TEXT_FALLBACK_JA;
    return (key: string) => resolveMessage(
        uiCatalog ?? null,
        key,
        fallback[key] || SIMPLE_CHARACTER_TEXT_FALLBACK_JA[key] || key
    );
};

export function simpleCharacterToMarkdown(
    config: SimpleCharacterConfig,
    title: string,
    uiCatalog?: I18NCatalog | null,
): string {
    const { base: b } = config;
    const t = createSimpleCharacterTranslator(uiCatalog);
    return [
        `# ${formatText(t(SIMPLE_CHARACTER_I18N_KEYS.markdownTitle), { title })}`,
        '',
        `## ${t(SIMPLE_CHARACTER_I18N_KEYS.basicInfo)}`,
        '',
        `### ${t(SIMPLE_CHARACTER_I18N_KEYS.base)}`,
        `- **${t(SIMPLE_CHARACTER_I18N_KEYS.name)}**: ${b.name}`,
        `- **${t(SIMPLE_CHARACTER_I18N_KEYS.reading)}**: ${b.reading}`,
        `- **${t(SIMPLE_CHARACTER_I18N_KEYS.nickname)}**: ${b.nickname}`,
        `- **${t(SIMPLE_CHARACTER_I18N_KEYS.age)}**: ${b.age}`,
        `- **${t(SIMPLE_CHARACTER_I18N_KEYS.gender)}**: ${b.gender}`,
        `- **${t(SIMPLE_CHARACTER_I18N_KEYS.birthday)}**: ${b.birthday}`,
        `- **${t(SIMPLE_CHARACTER_I18N_KEYS.height)}**: ${b.height}`,
        `- **${t(SIMPLE_CHARACTER_I18N_KEYS.weight)}**: ${b.weight}`,
        `- **${t(SIMPLE_CHARACTER_I18N_KEYS.threeSizes)}**: B ${b.threeSizes.bust} / W ${b.threeSizes.waist} / H ${b.threeSizes.hip}`,
        `- **${t(SIMPLE_CHARACTER_I18N_KEYS.hairStyle)}**: ${b.hairStyle}`,
        `- **${t(SIMPLE_CHARACTER_I18N_KEYS.eyeColor)}**: ${b.eyeColor}`,
        `- **${t(SIMPLE_CHARACTER_I18N_KEYS.skinColor)}**: ${b.skinColor}`,
        '',
        `## ${t(SIMPLE_CHARACTER_I18N_KEYS.personality)}`,
        config.personality,
        '',
        `## ${t(SIMPLE_CHARACTER_I18N_KEYS.appearance)}`,
        config.appearance,
        '',
        `## ${t(SIMPLE_CHARACTER_I18N_KEYS.outfit)}`,
        config.outfit,
        '',
        `## ${t(SIMPLE_CHARACTER_I18N_KEYS.speechStyle)}`,
        config.speechStyle,
        '',
        `## ${t(SIMPLE_CHARACTER_I18N_KEYS.background)}`,
        config.background,
        '',
        `## ${t(SIMPLE_CHARACTER_I18N_KEYS.abilities)}`,
        config.abilities,
        '',
        `## ${t(SIMPLE_CHARACTER_I18N_KEYS.relationships)}`,
        config.relationships,
        '',
        `## ${t(SIMPLE_CHARACTER_I18N_KEYS.other)}`,
        config.other,
    ].join('\n');
}

interface SectionProps {
    label: string;
    isOpen: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ label, isOpen, onToggle, children }) => (
    <div className="border border-gray-700 rounded">
        <button
            type="button"
            onClick={onToggle}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 transition-colors"
        >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="font-medium">{label}</span>
        </button>
        {isOpen && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
);

interface FieldProps {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
}

const Field: React.FC<FieldProps> = ({ label, value, onChange, placeholder }) => (
    <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-gray-400 w-28 shrink-0">{label}</span>
        <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
        />
    </div>
);

interface Props {
    value: SimpleCharacterConfig;
    onChange: (v: SimpleCharacterConfig) => void;
    uiCatalog?: I18NCatalog | null;
}

export const SimpleCharacterForm: React.FC<Props> = ({ value, onChange, uiCatalog = null }) => {
    const t = createSimpleCharacterTranslator(uiCatalog);
    const [baseOpen, setBaseOpen] = useState(true);
    const [sections, setSections] = useState<Record<string, boolean>>({
        personality: false, appearance: false, outfit: false,
        speechStyle: false, background: false, abilities: false,
        relationships: false, other: false,
    });

    const toggleSection = (key: string) =>
        setSections(prev => ({ ...prev, [key]: !prev[key] }));

    const setBase = (patch: Partial<typeof value.base>) =>
        onChange({ ...value, base: { ...value.base, ...patch } });

    const setSizes = (patch: Partial<typeof value.base.threeSizes>) =>
        setBase({ threeSizes: { ...value.base.threeSizes, ...patch } });

    const setField = (key: keyof Omit<SimpleCharacterConfig, 'base'>) =>
        (v: string) => onChange({ ...value, [key]: v });

    const textareaClass = "w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500 resize-y";

    const SECTION_DEFS: { key: keyof Omit<SimpleCharacterConfig, 'base'>; label: string }[] = [
        { key: 'personality',  label: t(SIMPLE_CHARACTER_I18N_KEYS.personality) },
        { key: 'appearance',   label: t(SIMPLE_CHARACTER_I18N_KEYS.appearance) },
        { key: 'outfit',       label: t(SIMPLE_CHARACTER_I18N_KEYS.outfit) },
        { key: 'speechStyle',  label: t(SIMPLE_CHARACTER_I18N_KEYS.speechStyle) },
        { key: 'background',   label: t(SIMPLE_CHARACTER_I18N_KEYS.background) },
        { key: 'abilities',    label: t(SIMPLE_CHARACTER_I18N_KEYS.abilities) },
        { key: 'relationships', label: t(SIMPLE_CHARACTER_I18N_KEYS.relationships) },
        { key: 'other',        label: t(SIMPLE_CHARACTER_I18N_KEYS.other) },
    ];

    return (
        <div className="flex flex-col gap-2 overflow-y-auto">
            {/* ベース */}
            <Section label={t(SIMPLE_CHARACTER_I18N_KEYS.base)} isOpen={baseOpen} onToggle={() => setBaseOpen(o => !o)}>
                <Field label={t(SIMPLE_CHARACTER_I18N_KEYS.name)}        value={value.base.name}      onChange={v => setBase({ name: v })} />
                <Field label={t(SIMPLE_CHARACTER_I18N_KEYS.reading)}      value={value.base.reading}   onChange={v => setBase({ reading: v })} />
                <Field label={t(SIMPLE_CHARACTER_I18N_KEYS.nickname)} value={value.base.nickname}  onChange={v => setBase({ nickname: v })} />
                <Field label={t(SIMPLE_CHARACTER_I18N_KEYS.age)}        value={value.base.age}       onChange={v => setBase({ age: v })} />
                <Field label={t(SIMPLE_CHARACTER_I18N_KEYS.gender)}        value={value.base.gender}    onChange={v => setBase({ gender: v })} />
                <Field label={t(SIMPLE_CHARACTER_I18N_KEYS.birthday)}      value={value.base.birthday}  onChange={v => setBase({ birthday: v })} />
                <Field label={t(SIMPLE_CHARACTER_I18N_KEYS.height)}        value={value.base.height}    onChange={v => setBase({ height: v })} />
                <Field label={t(SIMPLE_CHARACTER_I18N_KEYS.weight)}        value={value.base.weight}    onChange={v => setBase({ weight: v })} />
                {/* スリーサイズ */}
                <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-gray-400 w-28 shrink-0">{t(SIMPLE_CHARACTER_I18N_KEYS.threeSizes)}</span>
                    <span className="text-xs text-gray-500">B</span>
                    <input type="text" value={value.base.threeSizes.bust}  onChange={e => setSizes({ bust: e.target.value })}
                        className="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-gray-500" />
                    <span className="text-xs text-gray-500">W</span>
                    <input type="text" value={value.base.threeSizes.waist} onChange={e => setSizes({ waist: e.target.value })}
                        className="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-gray-500" />
                    <span className="text-xs text-gray-500">H</span>
                    <input type="text" value={value.base.threeSizes.hip}   onChange={e => setSizes({ hip: e.target.value })}
                        className="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-gray-500" />
                </div>
                <Field label={t(SIMPLE_CHARACTER_I18N_KEYS.hairStyle)}   value={value.base.hairStyle}  onChange={v => setBase({ hairStyle: v })} />
                <Field label={t(SIMPLE_CHARACTER_I18N_KEYS.eyeColor)}       value={value.base.eyeColor}   onChange={v => setBase({ eyeColor: v })} />
                <Field label={t(SIMPLE_CHARACTER_I18N_KEYS.skinColor)} value={value.base.skinColor}  onChange={v => setBase({ skinColor: v })} />
            </Section>

            {/* 各セクション */}
            {SECTION_DEFS.map(({ key, label }) => (
                <Section key={key} label={label} isOpen={sections[key]} onToggle={() => toggleSection(key)}>
                    <textarea
                        value={value[key]}
                        onChange={e => setField(key)(e.target.value)}
                        rows={5}
                        className={textareaClass}
                    />
                </Section>
            ))}
        </div>
    );
};
