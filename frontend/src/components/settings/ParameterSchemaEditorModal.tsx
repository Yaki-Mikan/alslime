/**
 * 項目設定管理画面
 * 項目設定ファイル（parameter-schema-*.json）をGUIで作成・編集するためのモーダル
 */
import React, { useState, useEffect, useCallback } from 'react';
import { X, Plus, Trash2, Save, FileText, ChevronDown, ChevronRight, AlertCircle, AlertTriangle, Copy, ArrowUp, ArrowDown, Download, Upload } from 'lucide-react';
import { getIdToken } from '../../firebase';
import { ConfirmDialog } from '../ConfirmDialog';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { BACKEND_URL } from '../../api/base-url';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import {
    PARAMETER_SCHEMA_EDITOR_I18N_KEYS,
    PARAMETER_SCHEMA_EDITOR_TEXT_FALLBACK_EN,
    PARAMETER_SCHEMA_EDITOR_TEXT_FALLBACK_JA,
} from '../../constants/i18n';

// ======================
// 型定義
// ======================

/** 多言語対応文字列 */
interface LocalizedString {
    ja: string;
    en?: string;
}

/** パラメータ要素の設定 */
interface ElementConfig {
    min?: number;
    max?: number;
    step?: number;
    options?: Array<{
        value: any;
        label: LocalizedString;
    }>;
    separator?: string;
    placeholder?: LocalizedString;
    rows?: number;
    compositeType?: 'yearMonthDay';
    yearRange?: [number, number];
    monthRange?: [number, number];
    dayRange?: [number, number];
}

/** 表示条件 */
interface ShowCondition {
    parentId: string;
    operator: '===' | '!==' | '>' | '<' | '>=' | '<=' | 'range';
    value?: any;
    min?: number;
    max?: number;
}

/** パラメータ要素 */
interface ParameterElement {
    id: string;
    type: 'slider' | 'dropdown' | 'text' | 'textarea' | 'toggle' | 'composite';
    displayName: LocalizedString;
    description: LocalizedString;
    promptDescription?: LocalizedString;
    defaultValue: any;
    parentId?: string;
    showCondition?: ShowCondition;
    config?: ElementConfig;
}

/** パラメータグループ */
interface ParameterGroup {
    id: string;
    displayName: LocalizedString;
    isFixed: boolean;
    defaultOpen: boolean;
    defaultEnabled: boolean;
    elements: ParameterElement[];
}

/** 項目設定スキーマ */
interface ParameterSchema {
    schemaId: string;
    schemaName: LocalizedString;
    groups: ParameterGroup[];
}

/** スキーマ一覧項目 */
interface SchemaListItem {
    id: string;
    name: LocalizedString;
}

// ======================
// Props
// ======================

interface ParameterSchemaEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    uiCatalog?: I18NCatalog | null;
}

// ======================
// コンポーネント
// ======================

export const ParameterSchemaEditorModal: React.FC<ParameterSchemaEditorModalProps> = ({
    isOpen,
    onClose,
    uiCatalog = null,
}) => {
    const fallback = uiCatalog?.lang?.startsWith('en') ? PARAMETER_SCHEMA_EDITOR_TEXT_FALLBACK_EN : PARAMETER_SCHEMA_EDITOR_TEXT_FALLBACK_JA;
    const t = (key: string) => resolveMessage(uiCatalog, key, fallback[key] || PARAMETER_SCHEMA_EDITOR_TEXT_FALLBACK_JA[key] || key);
    const formatText = (template: string, values: Record<string, string | number>) =>
        Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)), template);
    // スキーマ一覧
    const [schemaList, setSchemaList] = useState<SchemaListItem[]>([]);
    // 選択中のスキーマID
    const [selectedSchemaId, setSelectedSchemaId] = useState<string | null>(null);
    // 編集中のスキーマデータ
    const [editingSchema, setEditingSchema] = useState<ParameterSchema | null>(null);
    // 元のスキーマデータ（変更検出用）
    const [originalSchema, setOriginalSchema] = useState<ParameterSchema | null>(null);
    // ローディング状態
    const [isLoading, setIsLoading] = useState(false);
    // 保存中状態
    const [isSaving, setIsSaving] = useState(false);
    // エラーメッセージ
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    // 確認ダイアログ
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
    const [showGroupDeleteConfirm, setShowGroupDeleteConfirm] = useState(false);
    const [pendingDeleteGroupId, setPendingDeleteGroupId] = useState<string | null>(null);
    const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
    // 展開中のグループ
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    // 展開中の要素
    const [expandedElements, setExpandedElements] = useState<Set<string>>(new Set());
    // 展開中の要素詳細設定
    const [expandedElementDetails, setExpandedElementDetails] = useState<Set<string>>(new Set());
    // 編集中の言語（'ja' | 'en'）
    const [editingLanguage, setEditingLanguage] = useState<'ja' | 'en'>('ja');

    // 変更があるかどうか
    const isDirty = useCallback(() => {
        if (!editingSchema || !originalSchema) return false;
        return JSON.stringify(editingSchema) !== JSON.stringify(originalSchema);
    }, [editingSchema, originalSchema]);

    // スキーマ一覧を取得
    const fetchSchemaList = useCallback(async () => {
        try {
            const token = await getIdToken();
            const response = await fetch(`${BACKEND_URL}/api/parameters/schemas`, {
                headers: { 'Authorization': `Bearer ${token || ''}` }
            });
            if (!response.ok) throw new Error(t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.schemaListLoadFailed));
            const data = await response.json();
            setSchemaList(data.schemas || []);
        } catch (error) {
            console.error('Failed to fetch schema list:', error);
            setErrorMessage(t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.schemaItemListLoadFailed));
        }
    }, []);

    // スキーマを読み込み
    const loadSchema = useCallback(async (schemaId: string) => {
        setIsLoading(true);
        setErrorMessage(null);
        try {
            const token = await getIdToken();
            const response = await fetch(`${BACKEND_URL}/api/parameters/schema/${schemaId}`, {
                headers: { 'Authorization': `Bearer ${token || ''}` }
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.schemaLoadFailed));
            }
            const data = await response.json();
            const schema = data.schema as ParameterSchema;
            setEditingSchema(schema);
            setOriginalSchema(JSON.parse(JSON.stringify(schema)));
            setSelectedSchemaId(schemaId);
            // 全グループを折りたたみ状態で初期化
            setExpandedGroups(new Set());
            setExpandedElements(new Set());
            setExpandedElementDetails(new Set());
        } catch (error) {
            console.error('Failed to load schema:', error);
            setErrorMessage(error instanceof Error ? error.message : t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.schemaLoadFailed));
        } finally {
            setIsLoading(false);
        }
    }, []);

    // 新規スキーマ作成
    const createNewSchema = useCallback(() => {
        const newSchema: ParameterSchema = {
            schemaId: 'new_schema',
            schemaName: { ja: t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.newSchemaName), en: 'New Schema' },
            groups: []
        };
        setEditingSchema(newSchema);
        setOriginalSchema(null);
        setSelectedSchemaId(null);
        setExpandedGroups(new Set());
        setExpandedElements(new Set());
        setExpandedElementDetails(new Set());
    }, []);

    // スキーマのバリデーション
    const validateSchemaData = useCallback((schema: ParameterSchema): { isValid: boolean; errors: string[] } => {
        const errors: string[] = [];

        // 項目設定IDのチェック
        if (!schema.schemaId || schema.schemaId.trim() === '') {
            errors.push(t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.schemaIdRequired));
        }

        // 項目設定名（日本語）のチェック
        if (!schema.schemaName.ja || schema.schemaName.ja.trim() === '') {
            errors.push(t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.schemaNameJaRequired));
        }

        // グループID重複チェック
        const groupIds = schema.groups.map(g => g.id);
        const duplicateGroupIds = groupIds.filter((id, idx) => groupIds.indexOf(id) !== idx);
        if (duplicateGroupIds.length > 0) {
            errors.push(formatText(t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.duplicateGroupIds), {
                ids: [...new Set(duplicateGroupIds)].join(', '),
            }));
        }

        // 各グループの表示名チェック
        schema.groups.forEach((group, idx) => {
            if (!group.displayName.ja || group.displayName.ja.trim() === '') {
                errors.push(formatText(t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.groupDisplayNameRequired), {
                    index: idx + 1,
                }));
            }

            // 要素ID重複チェック（グループ内）
            const elementIds = group.elements.map(e => e.id);
            const duplicateElementIds = elementIds.filter((id, i) => elementIds.indexOf(id) !== i);
            if (duplicateElementIds.length > 0) {
                errors.push(formatText(t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.duplicateElementIds), {
                    group: group.displayName.ja || group.id,
                    ids: [...new Set(duplicateElementIds)].join(', '),
                }));
            }

            // 各要素の表示名チェック
            group.elements.forEach((element, elemIdx) => {
                if (!element.displayName.ja || element.displayName.ja.trim() === '') {
                    errors.push(formatText(t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.elementDisplayNameRequired), {
                        group: group.displayName.ja || group.id,
                        index: elemIdx + 1,
                    }));
                }
            });

            // 循環参照チェック
            const checkCircularReference = (elementId: string, visited: Set<string> = new Set()): boolean => {
                if (visited.has(elementId)) return true; // 循環検出
                const element = group.elements.find(e => e.id === elementId);
                if (!element?.parentId) return false;
                visited.add(elementId);
                return checkCircularReference(element.parentId, visited);
            };

            group.elements.forEach(element => {
                if (element.parentId) {
                    // 親要素が存在するかチェック
                    const parentExists = group.elements.some(e => e.id === element.parentId);
                    if (!parentExists) {
                        errors.push(formatText(t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.parentElementMissing), {
                            group: group.displayName.ja || group.id,
                            element: element.displayName.ja || element.id,
                            parent: element.parentId,
                        }));
                    }
                    // 循環参照チェック
                    if (checkCircularReference(element.id)) {
                        errors.push(formatText(t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.circularReference), {
                            group: group.displayName.ja || group.id,
                            element: element.displayName.ja || element.id,
                        }));
                    }
                }
            });
        });

        // 空グループの警告（エラーではなく警告として扱うが、ここでは省略して保存は許可）

        return {
            isValid: errors.length === 0,
            errors
        };
    }, []);

    // スキーマを保存
    const saveSchema = useCallback(async () => {
        if (!editingSchema) return;

        // バリデーション
        const validation = validateSchemaData(editingSchema);
        if (!validation.isValid) {
            setErrorMessage(validation.errors.join('\n'));
            return;
        }

        setIsSaving(true);
        setErrorMessage(null);

        try {
            const token = await getIdToken();
            const isNew = originalSchema === null;
            const url = isNew
                ? `${BACKEND_URL}/api/parameters/schemas`
                : `${BACKEND_URL}/api/parameters/schemas/${selectedSchemaId}`;
            const method = isNew ? 'POST' : 'PUT';

            const response = await fetch(url, {
                method,
                headers: {
                    'Authorization': `Bearer ${token || ''}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(editingSchema)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.saveFailed));
            }

            const data = await response.json();
            console.log('Schema saved:', data);

            // 保存成功後、一覧を更新して選択状態を維持
            await fetchSchemaList();
            setSelectedSchemaId(editingSchema.schemaId);
            setOriginalSchema(JSON.parse(JSON.stringify(editingSchema)));
            setErrorMessage(null);

        } catch (error) {
            console.error('Failed to save schema:', error);
            setErrorMessage(error instanceof Error ? error.message : t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.saveFailed));
        } finally {
            setIsSaving(false);
        }
    }, [editingSchema, originalSchema, selectedSchemaId, fetchSchemaList, validateSchemaData]);

    // スキーマを削除
    const deleteSchema = useCallback(async () => {
        if (!selectedSchemaId) return;

        setIsLoading(true);
        setErrorMessage(null);

        try {
            const token = await getIdToken();
            const response = await fetch(`${BACKEND_URL}/api/parameters/schemas/${selectedSchemaId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token || ''}` }
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.deleteFailed));
            }

            // 削除成功後、一覧を更新して新規作成状態にリセット
            await fetchSchemaList();
            createNewSchema();

        } catch (error) {
            console.error('Failed to delete schema:', error);
            setErrorMessage(error instanceof Error ? error.message : t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.deleteFailed));
        } finally {
            setIsLoading(false);
            setShowDeleteConfirm(false);
        }
    }, [selectedSchemaId, fetchSchemaList, createNewSchema]);

    // スキーマ選択変更（変更確認付き）
    const handleSchemaChange = useCallback((newSchemaId: string) => {
        if (isDirty()) {
            setPendingAction(() => () => loadSchema(newSchemaId));
            setShowUnsavedConfirm(true);
        } else {
            loadSchema(newSchemaId);
        }
    }, [isDirty, loadSchema]);

    // 新規作成（変更確認付き）
    const handleCreateNew = useCallback(() => {
        if (isDirty()) {
            setPendingAction(() => createNewSchema);
            setShowUnsavedConfirm(true);
        } else {
            createNewSchema();
        }
    }, [isDirty, createNewSchema]);

    // スキーマをコピー（全設定をコピーして新規作成）
    const handleCopySchema = useCallback(() => {
        if (!editingSchema) return;

        const copySchema = () => {
            const newSchemaId = `${editingSchema.schemaId}_copy`;
            const copiedSchema: ParameterSchema = {
                ...editingSchema,
                schemaId: newSchemaId,
                schemaName: {
                    ja: `${editingSchema.schemaName.ja}_Copy`,
                    en: editingSchema.schemaName.en ? `${editingSchema.schemaName.en}_Copy` : undefined
                }
            };
            setSelectedSchemaId('');
            setOriginalSchema(null);
            setEditingSchema(copiedSchema);
        };

        if (isDirty()) {
            setPendingAction(() => copySchema);
            setShowUnsavedConfirm(true);
        } else {
            copySchema();
        }
    }, [editingSchema, isDirty]);

    // モーダルを閉じる（変更確認付き）
    const handleClose = useCallback(() => {
        if (isDirty()) {
            setPendingAction(() => onClose);
            setShowUnsavedConfirm(true);
        } else {
            onClose();
        }
    }, [isDirty, onClose]);

    // 初期化
    useEffect(() => {
        if (isOpen) {
            fetchSchemaList();
            createNewSchema();
        }
    }, [isOpen, fetchSchemaList, createNewSchema]);

    // グループ開閉トグル
    const toggleGroup = (groupId: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(groupId)) {
                next.delete(groupId);
            } else {
                next.add(groupId);
            }
            return next;
        });
    };

    // 要素開閉トグル
    const toggleElement = (elementKey: string) => {
        setExpandedElements(prev => {
            const next = new Set(prev);
            if (next.has(elementKey)) {
                next.delete(elementKey);
            } else {
                next.add(elementKey);
            }
            return next;
        });
    };

    // 要素詳細設定開閉トグル
    const toggleElementDetails = (elementKey: string) => {
        setExpandedElementDetails(prev => {
            const next = new Set(prev);
            if (next.has(elementKey)) {
                next.delete(elementKey);
            } else {
                next.add(elementKey);
            }
            return next;
        });
    };

    // グループ追加
    const addGroup = () => {
        if (!editingSchema) return;
        const newGroupId = `newGroup_${Date.now()}`;
        const newGroup: ParameterGroup = {
            id: newGroupId,
            displayName: { ja: t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.newGroupName), en: 'New Group' },
            isFixed: false,
            defaultOpen: false,
            defaultEnabled: true,
            elements: []
        };
        setEditingSchema({
            ...editingSchema,
            groups: [...editingSchema.groups, newGroup]
        });
        // 新規グループを展開
        setExpandedGroups(prev => new Set(prev).add(newGroupId));
    };

    // グループ削除（確認付き）
    const handleRemoveGroup = (groupId: string) => {
        if (!editingSchema) return;
        const group = editingSchema.groups.find(g => g.id === groupId);
        if (!group) return;

        // 要素がある場合は確認ダイアログを表示
        if (group.elements.length > 0) {
            setPendingDeleteGroupId(groupId);
            setShowGroupDeleteConfirm(true);
        } else {
            // 要素がない場合は即座に削除
            executeRemoveGroup(groupId);
        }
    };

    // グループ削除の実行
    const executeRemoveGroup = (groupId: string) => {
        if (!editingSchema) return;
        setEditingSchema({
            ...editingSchema,
            groups: editingSchema.groups.filter(g => g.id !== groupId)
        });
        setShowGroupDeleteConfirm(false);
        setPendingDeleteGroupId(null);
    };

    // グループを上に移動
    const moveGroupUp = (index: number) => {
        if (!editingSchema || index <= 0) return;
        const newGroups = [...editingSchema.groups];
        [newGroups[index - 1], newGroups[index]] = [newGroups[index], newGroups[index - 1]];
        setEditingSchema({ ...editingSchema, groups: newGroups });
    };

    // グループを下に移動
    const moveGroupDown = (index: number) => {
        if (!editingSchema || index >= editingSchema.groups.length - 1) return;
        const newGroups = [...editingSchema.groups];
        [newGroups[index], newGroups[index + 1]] = [newGroups[index + 1], newGroups[index]];
        setEditingSchema({ ...editingSchema, groups: newGroups });
    };

    // グループ更新
    const updateGroup = (groupId: string, updates: Partial<ParameterGroup>) => {
        if (!editingSchema) return;
        setEditingSchema({
            ...editingSchema,
            groups: editingSchema.groups.map(g =>
                g.id === groupId ? { ...g, ...updates } : g
            )
        });
    };

    // 要素追加
    const addElement = (groupId: string) => {
        if (!editingSchema) return;
        const newElementId = `newElement_${Date.now()}`;
        const newElement: ParameterElement = {
            id: newElementId,
            type: 'slider',
            displayName: { ja: t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.newElementName), en: 'New Parameter' },
            description: { ja: '', en: '' },
            promptDescription: { ja: '', en: '' },
            defaultValue: 0,
            config: { min: 0, max: 100, step: 1 }
        };
        setEditingSchema({
            ...editingSchema,
            groups: editingSchema.groups.map(g =>
                g.id === groupId
                    ? { ...g, elements: [...g.elements, newElement] }
                    : g
            )
        });
        // 新規要素を展開
        const elementKey = `${groupId}_${newElementId}`;
        setExpandedElements(prev => new Set(prev).add(elementKey));
    };

    // 要素削除
    const removeElement = (groupId: string, elementId: string) => {
        if (!editingSchema) return;
        setEditingSchema({
            ...editingSchema,
            groups: editingSchema.groups.map(g =>
                g.id === groupId
                    ? { ...g, elements: g.elements.filter(e => e.id !== elementId) }
                    : g
            )
        });
    };

    // 要素を上に移動
    const moveElementUp = (groupId: string, index: number) => {
        if (!editingSchema || index <= 0) return;
        setEditingSchema({
            ...editingSchema,
            groups: editingSchema.groups.map(g => {
                if (g.id !== groupId) return g;
                const newElements = [...g.elements];
                [newElements[index - 1], newElements[index]] = [newElements[index], newElements[index - 1]];
                return { ...g, elements: newElements };
            })
        });
    };

    // 要素を下に移動
    const moveElementDown = (groupId: string, index: number) => {
        if (!editingSchema) return;
        const group = editingSchema.groups.find(g => g.id === groupId);
        if (!group || index >= group.elements.length - 1) return;
        setEditingSchema({
            ...editingSchema,
            groups: editingSchema.groups.map(g => {
                if (g.id !== groupId) return g;
                const newElements = [...g.elements];
                [newElements[index], newElements[index + 1]] = [newElements[index + 1], newElements[index]];
                return { ...g, elements: newElements };
            })
        });
    };

    // 要素更新
    const updateElement = (groupId: string, elementId: string, updates: Partial<ParameterElement>) => {
        if (!editingSchema) return;
        setEditingSchema({
            ...editingSchema,
            groups: editingSchema.groups.map(g =>
                g.id === groupId
                    ? {
                        ...g,
                        elements: g.elements.map(e =>
                            e.id === elementId ? { ...e, ...updates } : e
                        )
                    }
                    : g
            )
        });
    };

    // 要素タイプ変更時のデフォルト値リセット
    const handleElementTypeChange = (groupId: string, elementId: string, newType: ParameterElement['type']) => {
        const typeDefaults: Record<string, { defaultValue: any; config: ElementConfig }> = {
            slider: { defaultValue: 0, config: { min: 0, max: 100, step: 1 } },
            dropdown: { defaultValue: null, config: { options: [] } },
            text: { defaultValue: '', config: { separator: ',', placeholder: { ja: '', en: '' } } },
            textarea: { defaultValue: '', config: { rows: 3 } },
            toggle: { defaultValue: false, config: {} },
            composite: {
                defaultValue: { years: 0, months: 0, days: 0 },
                config: {
                    compositeType: 'yearMonthDay',
                    yearRange: [0, 100],
                    monthRange: [0, 11],
                    dayRange: [0, 30]
                }
            }
        };
        const defaults = typeDefaults[newType];
        updateElement(groupId, elementId, {
            type: newType,
            defaultValue: defaults.defaultValue,
            config: defaults.config
        });
    };

    // グループをコピー
    const copyGroup = (groupId: string) => {
        if (!editingSchema) return;
        const group = editingSchema.groups.find(g => g.id === groupId);
        if (!group) return;
        const newGroupId = `${group.id}_copy_${Date.now()}`;
        const newGroup: ParameterGroup = {
            ...group,
            id: newGroupId,
            displayName: { ja: `${group.displayName.ja}${t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.copySuffix)}`, en: group.displayName.en ? `${group.displayName.en} (Copy)` : undefined },
            elements: group.elements.map(e => ({
                ...e,
                id: `${e.id}_copy_${Date.now()}`,
                parentId: undefined,
                showCondition: undefined
            }))
        };
        setEditingSchema({
            ...editingSchema,
            groups: [...editingSchema.groups, newGroup]
        });
    };

    // 要素をコピー
    const copyElement = (groupId: string, elementId: string) => {
        if (!editingSchema) return;
        const group = editingSchema.groups.find(g => g.id === groupId);
        const element = group?.elements.find(e => e.id === elementId);
        if (!element) return;
        const newElement: ParameterElement = {
            ...element,
            id: `${element.id}_copy_${Date.now()}`,
            displayName: { ja: `${element.displayName.ja}${t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.copySuffix)}`, en: element.displayName.en ? `${element.displayName.en} (Copy)` : undefined },
            parentId: undefined,
            showCondition: undefined
        };
        setEditingSchema({
            ...editingSchema,
            groups: editingSchema.groups.map(g =>
                g.id === groupId
                    ? { ...g, elements: [...g.elements, newElement] }
                    : g
            )
        });
    };

    // スキーマをエクスポート
    const exportSchema = () => {
        if (!editingSchema) return;
        const dataStr = JSON.stringify(editingSchema, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `parameter-schema-${editingSchema.schemaId || 'export'}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    // スキーマをインポート
    const importSchema = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target?.result as string);
                if (data.schemaId && data.groups) {
                    setEditingSchema(data);
                    setSelectedSchemaId('');
                    setOriginalSchema(null);
                } else {
                    setErrorMessage(t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.invalidSchemaFile));
                }
            } catch {
                setErrorMessage(t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.jsonParseFailed));
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    };

    if (!isOpen) return null;

    return (
        <>
            <div
                className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            >
                <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] border border-gray-700 overflow-hidden flex flex-col">
                    {/* ヘッダー */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 bg-gray-800 shrink-0">
                        <div className="flex items-center gap-2">
                            <FileText size={20} className="text-purple-400" />
                            <h3 className="font-semibold text-gray-100 text-lg">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.title)}</h3>
                            {isDirty() && (
                                <span className="text-xs text-amber-400 ml-2">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.dirty)}</span>
                            )}
                        </div>
                        <button
                            onClick={handleClose}
                            className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* エラーメッセージ */}
                    {errorMessage && (
                        <div className="mx-5 mt-4 p-3 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-2 text-red-300 shrink-0">
                            <AlertCircle size={18} />
                            <span>{errorMessage}</span>
                        </div>
                    )}

                    {/* 項目設定選択部 */}
                    <div className="px-5 py-4 border-b border-gray-700 bg-gray-800/50 shrink-0">
                        <div className="flex items-center gap-3">
                            <label className="text-sm text-gray-400 whitespace-nowrap">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.fileLabel)}</label>
                            <select
                                value={selectedSchemaId || ''}
                                onChange={(e) => e.target.value && handleSchemaChange(e.target.value)}
                                disabled={isLoading}
                                className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-gray-200 text-sm outline-none focus:border-purple-500 transition-colors"
                            >
                                <option value="">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.selectPrompt)}</option>
                                {schemaList.map(schema => (
                                    <option key={schema.id} value={schema.id}>
                                        {schema.name.ja} ({schema.id})
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={handleCreateNew}
                                disabled={isLoading}
                                className="flex items-center gap-1 px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg text-sm text-white transition-colors"
                            >
                                <Plus size={16} />
                                {t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.createNew)}
                            </button>
                            <button
                                onClick={() => setShowDeleteConfirm(true)}
                                disabled={isLoading || !selectedSchemaId || selectedSchemaId === 'default'}
                                className="flex items-center gap-1 px-3 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm text-white transition-colors"
                                title={selectedSchemaId === 'default' ? t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.fixedGroupDeleteDisabled) : t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.delete)}
                            >
                                <Trash2 size={16} />
                                {t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.delete)}
                            </button>
                            {/* スキーマコピーボタン */}
                            <button
                                onClick={handleCopySchema}
                                disabled={isLoading || !selectedSchemaId}
                                className="flex items-center gap-1 px-3 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm text-white transition-colors"
                                title={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.copy)}
                            >
                                <Copy size={16} />
                                {t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.copy)}
                            </button>
                            {/* エクスポート/インポートボタン */}
                            <button
                                onClick={exportSchema}
                                disabled={!editingSchema}
                                className="flex items-center gap-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm text-gray-300 transition-colors"
                                title={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.exportJson)}
                            >
                                <Download size={16} />
                            </button>
                            <label
                                className="flex items-center gap-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 transition-colors cursor-pointer"
                                title={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.importJson)}
                            >
                                <Upload size={16} />
                                <input
                                    type="file"
                                    accept=".json"
                                    onChange={importSchema}
                                    className="hidden"
                                />
                            </label>
                        </div>
                    </div>

                    {/* メインコンテンツ */}
                    <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
                        {isLoading ? (
                            <div className="flex items-center justify-center py-10">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400"></div>
                            </div>
                        ) : editingSchema ? (
                            <>
                                {/* 基本情報 */}
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-sm font-medium text-gray-400">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.basicInfo)}</h4>
                                        <div className="flex items-center gap-2">
                                            <label className="text-xs text-gray-500">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.editLanguage)}</label>
                                            <select
                                                value={editingLanguage}
                                                onChange={(e) => setEditingLanguage(e.target.value as 'ja' | 'en')}
                                                className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-200 text-xs outline-none focus:border-purple-500 transition-colors"
                                            >
                                                <option value="ja">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.ja)}</option>
                                                <option value="en">English</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.schemaId)}</label>
                                            <input
                                                type="text"
                                                value={editingSchema.schemaId}
                                                onChange={(e) => setEditingSchema({ ...editingSchema, schemaId: e.target.value })}
                                                disabled={originalSchema !== null} // 既存スキーマはID変更不可
                                                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-gray-200 text-sm outline-none focus:border-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                placeholder={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.schemaIdExample)}
                                            />
                                            {originalSchema !== null && (
                                                <p className="text-xs text-gray-500 mt-1">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.schemaIdLocked)}</p>
                                            )}
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">
                                                {t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.schemaName)}
                                                <span className="ml-1 text-purple-400">({editingLanguage === 'ja' ? t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.ja) : 'English'})</span>
                                            </label>
                                            <input
                                                type="text"
                                                value={editingLanguage === 'ja' ? editingSchema.schemaName.ja : (editingSchema.schemaName.en || '')}
                                                onChange={(e) => setEditingSchema({
                                                    ...editingSchema,
                                                    schemaName: {
                                                        ...editingSchema.schemaName,
                                                        [editingLanguage]: e.target.value
                                                    }
                                                })}
                                                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-gray-200 text-sm outline-none focus:border-purple-500 transition-colors"
                                                placeholder={editingLanguage === 'ja' ? t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.schemaNameExample) : 'e.g. My Schema'}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* グループ一覧 */}
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-sm font-medium text-gray-400">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.groups)}</h4>
                                        <button
                                            onClick={addGroup}
                                            className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-gray-300 transition-colors"
                                        >
                                            <Plus size={14} />
                                            {t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.addGroup)}
                                        </button>
                                    </div>

                                    {editingSchema.groups.length === 0 ? (
                                        <div className="text-center py-8 text-gray-500 text-sm border border-dashed border-gray-700 rounded-lg">
                                            {t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.emptyGroups)}
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {editingSchema.groups.map((group, groupIndex) => (
                                                <div key={group.id} className="border border-gray-700 rounded-lg overflow-hidden">
                                                    {/* グループヘッダー */}
                                                    <div
                                                        className="flex items-center gap-2 px-4 py-3 bg-gray-800/80 cursor-pointer hover:bg-gray-800 transition-colors"
                                                        onClick={() => toggleGroup(group.id)}
                                                    >
                                                        {expandedGroups.has(group.id) ? (
                                                            <ChevronDown size={16} className="text-gray-400" />
                                                        ) : (
                                                            <ChevronRight size={16} className="text-gray-400" />
                                                        )}
                                                        <span className="flex-1 text-gray-200 font-medium">
                                                            {group.displayName.ja || formatText(t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.groupFallback), { id: group.id })}
                                                        </span>
                                                        {group.elements.length === 0 && (
                                                            <span
                                                                className="text-amber-400"
                                                                title={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.groupEmptyTitle)}
                                                            >
                                                                <AlertTriangle size={14} />
                                                            </span>
                                                        )}
                                                        <span className="text-xs text-gray-500">
                                                            {formatText(t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.elementCount), { count: group.elements.length })}
                                                        </span>
                                                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                                            <button
                                                                onClick={() => moveGroupUp(groupIndex)}
                                                                disabled={groupIndex === 0}
                                                                className="p-1 text-gray-500 hover:text-gray-300 disabled:opacity-30"
                                                                title={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.moveUp)}
                                                            >
                                                                <ArrowUp size={14} />
                                                            </button>
                                                            <button
                                                                onClick={() => moveGroupDown(groupIndex)}
                                                                disabled={groupIndex === editingSchema.groups.length - 1}
                                                                className="p-1 text-gray-500 hover:text-gray-300 disabled:opacity-30"
                                                                title={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.moveDown)}
                                                            >
                                                                <ArrowDown size={14} />
                                                            </button>
                                                            <button
                                                                onClick={() => copyGroup(group.id)}
                                                                className="p-1 text-gray-500 hover:text-purple-400"
                                                                title={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.copyGroup)}
                                                            >
                                                                <Copy size={14} />
                                                            </button>
                                                            <button
                                                                onClick={() => handleRemoveGroup(group.id)}
                                                                disabled={group.isFixed}
                                                                className="p-1 text-gray-500 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                                                                title={group.isFixed ? t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.fixedGroupDeleteDisabled) : t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.delete)}
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* グループ内容 */}
                                                    {expandedGroups.has(group.id) && (
                                                        <div className="p-4 space-y-4 bg-gray-900">
                                                            {/* グループ基本情報 */}
                                                            <div className="grid grid-cols-2 gap-3">
                                                                <div>
                                                                    <label className="block text-xs text-gray-500 mb-1">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.groupId)}</label>
                                                                    <input
                                                                        type="text"
                                                                        value={group.id}
                                                                        disabled
                                                                        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-gray-400 text-xs disabled:opacity-50"
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className="block text-xs text-gray-500 mb-1">
                                                                        {t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.displayName)}
                                                                        <span className="ml-1 text-purple-400">({editingLanguage === 'ja' ? t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.ja) : 'English'})</span>
                                                                    </label>
                                                                    <input
                                                                        type="text"
                                                                        value={editingLanguage === 'ja' ? group.displayName.ja : (group.displayName.en || '')}
                                                                        onChange={(e) => updateGroup(group.id, {
                                                                            displayName: { ...group.displayName, [editingLanguage]: e.target.value }
                                                                        })}
                                                                        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-gray-200 text-xs outline-none focus:border-purple-500 transition-colors"
                                                                        placeholder={editingLanguage === 'ja' ? t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.groupNamePlaceholder) : 'Group name'}
                                                                    />
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-4">
                                                                <ToggleSwitch
                                                                    checked={group.isFixed}
                                                                    onChange={(on) => updateGroup(group.id, { isFixed: on })}
                                                                    label={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.fixedGroup)}
                                                                    labelPosition="right"
                                                                    labelClassName="text-xs text-gray-400"
                                                                    accent="purple"
                                                                    size="sm"
                                                                />
                                                                <ToggleSwitch
                                                                    checked={group.defaultOpen}
                                                                    onChange={(on) => updateGroup(group.id, { defaultOpen: on })}
                                                                    label={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.defaultOpen)}
                                                                    labelPosition="right"
                                                                    labelClassName="text-xs text-gray-400"
                                                                    accent="purple"
                                                                    size="sm"
                                                                />
                                                                <ToggleSwitch
                                                                    checked={group.defaultEnabled}
                                                                    onChange={(on) => updateGroup(group.id, { defaultEnabled: on })}
                                                                    label={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.defaultEnabled)}
                                                                    labelPosition="right"
                                                                    labelClassName="text-xs text-gray-400"
                                                                    accent="purple"
                                                                    size="sm"
                                                                />
                                                            </div>

                                                            {/* 要素一覧 */}
                                                            <div className="mt-4">
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <h5 className="text-xs font-medium text-gray-500">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.elements)}</h5>
                                                                    <button
                                                                        onClick={() => addElement(group.id)}
                                                                        className="flex items-center gap-1 px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 transition-colors"
                                                                    >
                                                                        <Plus size={12} />
                                                                        {t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.addElement)}
                                                                    </button>
                                                                </div>

                                                                {group.elements.length === 0 ? (
                                                                    <div className="text-center py-4 text-gray-600 text-xs border border-dashed border-gray-700 rounded">
                                                                        {t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.emptyElements)}
                                                                    </div>
                                                                ) : (
                                                                    <div className="space-y-2">
                                                                        {group.elements.map((element, elemIndex) => {
                                                                            const elementKey = `${group.id}_${element.id}`;
                                                                            const isExpanded = expandedElements.has(elementKey);
                                                                            const isDetailsExpanded = expandedElementDetails.has(elementKey);

                                                                            return (
                                                                                <div key={element.id} className="border border-gray-700 rounded overflow-hidden">
                                                                                    {/* 要素ヘッダー */}
                                                                                    <div
                                                                                        className="flex items-center gap-2 px-3 py-2 bg-gray-800/50 cursor-pointer hover:bg-gray-800"
                                                                                        onClick={() => toggleElement(elementKey)}
                                                                                    >
                                                                                        {isExpanded ? (
                                                                                            <ChevronDown size={14} className="text-gray-500" />
                                                                                        ) : (
                                                                                            <ChevronRight size={14} className="text-gray-500" />
                                                                                        )}
                                                                                        <span className="flex-1 text-gray-300 text-sm">
                                                                                            {element.displayName.ja || element.id}
                                                                                        </span>
                                                                                        <span className="text-xs text-gray-500 px-2 py-0.5 bg-gray-700 rounded">
                                                                                            {element.type}
                                                                                        </span>
                                                                                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                                                                            <button
                                                                                                onClick={() => moveElementUp(group.id, elemIndex)}
                                                                                                disabled={elemIndex === 0}
                                                                                                className="p-0.5 text-gray-600 hover:text-gray-400 disabled:opacity-30 text-xs"
                                                                                            >
                                                                                                <ArrowUp size={12} />
                                                                                            </button>
                                                                                            <button
                                                                                                onClick={() => moveElementDown(group.id, elemIndex)}
                                                                                                disabled={elemIndex === group.elements.length - 1}
                                                                                                className="p-0.5 text-gray-600 hover:text-gray-400 disabled:opacity-30 text-xs"
                                                                                            >
                                                                                                <ArrowDown size={12} />
                                                                                            </button>
                                                                                            <button
                                                                                                onClick={() => copyElement(group.id, element.id)}
                                                                                                className="p-0.5 text-gray-600 hover:text-purple-400"
                                                                                                title={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.copyElement)}
                                                                                            >
                                                                                                <Copy size={12} />
                                                                                            </button>
                                                                                            <button
                                                                                                onClick={() => removeElement(group.id, element.id)}
                                                                                                className="p-0.5 text-gray-600 hover:text-red-400"
                                                                                            >
                                                                                                <Trash2 size={12} />
                                                                                            </button>
                                                                                        </div>
                                                                                    </div>

                                                                                    {/* 要素内容 */}
                                                                                    {isExpanded && (
                                                                                        <div className="p-3 space-y-3 bg-gray-900/50">
                                                                                            {/* 基本情報（常に表示） */}
                                                                                            <div className="grid grid-cols-3 gap-2">
                                                                                                <div>
                                                                                                    <label className="block text-xs text-gray-600 mb-1">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.elementId)}</label>
                                                                                                    <input
                                                                                                        type="text"
                                                                                                        value={element.id}
                                                                                                        disabled
                                                                                                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-500 text-xs disabled:opacity-50"
                                                                                                    />
                                                                                                </div>
                                                                                                <div>
                                                                                                    <label className="block text-xs text-gray-600 mb-1">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.type)}</label>
                                                                                                    <select
                                                                                                        value={element.type}
                                                                                                        onChange={(e) => handleElementTypeChange(group.id, element.id, e.target.value as ParameterElement['type'])}
                                                                                                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs outline-none focus:border-purple-500 transition-colors"
                                                                                                    >
                                                                                                        <option value="slider">slider</option>
                                                                                                        <option value="dropdown">dropdown</option>
                                                                                                        <option value="text">text</option>
                                                                                                        <option value="textarea">textarea</option>
                                                                                                        <option value="toggle">toggle</option>
                                                                                                        <option value="composite">composite</option>
                                                                                                    </select>
                                                                                                </div>
                                                                                                <div>
                                                                                                    <label className="block text-xs text-gray-600 mb-1">
                                                                                                        {t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.displayName)}
                                                                                                        <span className="ml-1 text-purple-400">({editingLanguage === 'ja' ? t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.ja) : 'English'})</span>
                                                                                                    </label>
                                                                                                    <input
                                                                                                        type="text"
                                                                                                        value={editingLanguage === 'ja' ? element.displayName.ja : (element.displayName.en || '')}
                                                                                                        onChange={(e) => updateElement(group.id, element.id, {
                                                                                                            displayName: { ...element.displayName, [editingLanguage]: e.target.value }
                                                                                                        })}
                                                                                                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs outline-none focus:border-purple-500 transition-colors"
                                                                                                        placeholder={editingLanguage === 'ja' ? t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.parameterNamePlaceholder) : 'Parameter name'}
                                                                                                    />
                                                                                                </div>
                                                                                            </div>

                                                                                            {/* 詳細設定（折りたたみ可能） */}
                                                                                            <div className="border-t border-gray-700 pt-2">
                                                                                                <button
                                                                                                    onClick={() => toggleElementDetails(elementKey)}
                                                                                                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-400"
                                                                                                >
                                                                                                    {isDetailsExpanded ? (
                                                                                                        <ChevronDown size={12} />
                                                                                                    ) : (
                                                                                                        <ChevronRight size={12} />
                                                                                                    )}
                                                                                                    {t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.elementDetails)}
                                                                                                </button>

                                                                                                {isDetailsExpanded && (
                                                                                                    <div className="mt-2 space-y-2">
                                                                                                        {/* 説明 */}
                                                                                                        <div>
                                                                                                            <label className="block text-xs text-gray-600 mb-1">
                                                                                                                {t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.description)}
                                                                                                                <span className="ml-1 text-purple-400">({editingLanguage === 'ja' ? t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.ja) : 'English'})</span>
                                                                                                            </label>
                                                                                                            <textarea
                                                                                                                value={editingLanguage === 'ja' ? element.description.ja : (element.description.en || '')}
                                                                                                                onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                    description: { ...element.description, [editingLanguage]: e.target.value }
                                                                                                                })}
                                                                                                                rows={2}
                                                                                                                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs outline-none focus:border-purple-500 transition-colors resize-none"
                                                                                                                placeholder={editingLanguage === 'ja' ? t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.parameterDescriptionPlaceholder) : 'Parameter description'}
                                                                                                            />
                                                                                                        </div>
                                                                                                        <div>
                                                                                                            <label className="block text-xs text-gray-600 mb-1">
                                                                                                                {t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.promptDescription)}
                                                                                                                <span className="ml-1 text-purple-400">({editingLanguage === 'ja' ? t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.ja) : 'English'})</span>
                                                                                                            </label>
                                                                                                            <textarea
                                                                                                                value={editingLanguage === 'ja' ? (element.promptDescription?.ja || '') : (element.promptDescription?.en || '')}
                                                                                                                onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                    promptDescription: { ja: element.promptDescription?.ja || '', en: element.promptDescription?.en || '', [editingLanguage]: e.target.value }
                                                                                                                })}
                                                                                                                rows={2}
                                                                                                                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs outline-none focus:border-purple-500 transition-colors resize-none"
                                                                                                                placeholder={editingLanguage === 'ja' ? t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.promptDescriptionPlaceholder) : 'Description sent to Gemini'}
                                                                                                            />
                                                                                                        </div>

                                                                                                        {/* デフォルト値設定 */}
                                                                                                        <div className="border-t border-gray-700 pt-2">
                                                                                                            <label className="block text-xs text-gray-600 mb-1">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.defaultValue)}</label>
                                                                                                            {(element.type === 'slider') && (
                                                                                                                <input
                                                                                                                    type="number"
                                                                                                                    value={element.defaultValue ?? 0}
                                                                                                                    onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                        defaultValue: parseInt(e.target.value) || 0
                                                                                                                    })}
                                                                                                                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs outline-none focus:border-purple-500 transition-colors"
                                                                                                                />
                                                                                                            )}
                                                                                                            {(element.type === 'text' || element.type === 'textarea') && (
                                                                                                                <input
                                                                                                                    type="text"
                                                                                                                    value={element.defaultValue ?? ''}
                                                                                                                    onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                        defaultValue: e.target.value
                                                                                                                    })}
                                                                                                                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs outline-none focus:border-purple-500 transition-colors"
                                                                                                                    placeholder={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.defaultTextPlaceholder)}
                                                                                                                />
                                                                                                            )}
                                                                                                            {element.type === 'toggle' && (
                                                                                                                <select
                                                                                                                    value={element.defaultValue ? 'true' : 'false'}
                                                                                                                    onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                        defaultValue: e.target.value === 'true'
                                                                                                                    })}
                                                                                                                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs outline-none focus:border-purple-500 transition-colors"
                                                                                                                >
                                                                                                                    <option value="false">OFF</option>
                                                                                                                    <option value="true">ON</option>
                                                                                                                </select>
                                                                                                            )}
                                                                                                            {element.type === 'dropdown' && (
                                                                                                                <select
                                                                                                                    value={element.defaultValue ?? ''}
                                                                                                                    onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                        defaultValue: e.target.value || null
                                                                                                                    })}
                                                                                                                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs outline-none focus:border-purple-500 transition-colors"
                                                                                                                >
                                                                                                                    <option value="">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.unset)}</option>
                                                                                                                    {(element.config?.options || []).map((opt: { value: unknown; label: { ja: string } }, i: number) => (
                                                                                                                        <option key={i} value={String(opt.value)}>
                                                                                                                            {opt.label.ja} ({String(opt.value)})
                                                                                                                        </option>
                                                                                                                    ))}
                                                                                                                </select>
                                                                                                            )}
                                                                                                            {element.type === 'composite' && (
                                                                                                                <div className="grid grid-cols-3 gap-1">
                                                                                                                    <div>
                                                                                                                        <label className="block text-xs text-gray-600 mb-0.5">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.year)}</label>
                                                                                                                        <input
                                                                                                                            type="number"
                                                                                                                            value={(element.defaultValue as { years?: number })?.years ?? 0}
                                                                                                                            onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                                defaultValue: {
                                                                                                                                    ...(element.defaultValue as { years?: number; months?: number; days?: number } || {}),
                                                                                                                                    years: parseInt(e.target.value) || 0
                                                                                                                                }
                                                                                                                            })}
                                                                                                                            className="w-full bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-gray-300 text-xs"
                                                                                                                        />
                                                                                                                    </div>
                                                                                                                    <div>
                                                                                                                        <label className="block text-xs text-gray-600 mb-0.5">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.month)}</label>
                                                                                                                        <input
                                                                                                                            type="number"
                                                                                                                            value={(element.defaultValue as { months?: number })?.months ?? 0}
                                                                                                                            onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                                defaultValue: {
                                                                                                                                    ...(element.defaultValue as { years?: number; months?: number; days?: number } || {}),
                                                                                                                                    months: parseInt(e.target.value) || 0
                                                                                                                                }
                                                                                                                            })}
                                                                                                                            className="w-full bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-gray-300 text-xs"
                                                                                                                        />
                                                                                                                    </div>
                                                                                                                    <div>
                                                                                                                        <label className="block text-xs text-gray-600 mb-0.5">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.day)}</label>
                                                                                                                        <input
                                                                                                                            type="number"
                                                                                                                            value={(element.defaultValue as { days?: number })?.days ?? 0}
                                                                                                                            onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                                defaultValue: {
                                                                                                                                    ...(element.defaultValue as { years?: number; months?: number; days?: number } || {}),
                                                                                                                                    days: parseInt(e.target.value) || 0
                                                                                                                                }
                                                                                                                            })}
                                                                                                                            className="w-full bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-gray-300 text-xs"
                                                                                                                        />
                                                                                                                    </div>
                                                                                                                </div>
                                                                                                            )}
                                                                                                        </div>

                                                                                                        {/* タイプ別設定 */}
                                                                                                        {element.type === 'slider' && (
                                                                                                            <div className="grid grid-cols-3 gap-2">
                                                                                                                <div>
                                                                                                                    <label className="block text-xs text-gray-600 mb-1">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.min)}</label>
                                                                                                                    <input
                                                                                                                        type="number"
                                                                                                                        value={element.config?.min ?? 0}
                                                                                                                        onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                            config: { ...element.config, min: parseInt(e.target.value) || 0 }
                                                                                                                        })}
                                                                                                                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs outline-none focus:border-purple-500 transition-colors"
                                                                                                                    />
                                                                                                                </div>
                                                                                                                <div>
                                                                                                                    <label className="block text-xs text-gray-600 mb-1">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.max)}</label>
                                                                                                                    <input
                                                                                                                        type="number"
                                                                                                                        value={element.config?.max ?? 100}
                                                                                                                        onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                            config: { ...element.config, max: parseInt(e.target.value) || 100 }
                                                                                                                        })}
                                                                                                                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs outline-none focus:border-purple-500 transition-colors"
                                                                                                                    />
                                                                                                                </div>
                                                                                                                <div>
                                                                                                                    <label className="block text-xs text-gray-600 mb-1">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.step)}</label>
                                                                                                                    <input
                                                                                                                        type="number"
                                                                                                                        value={element.config?.step ?? 1}
                                                                                                                        onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                            config: { ...element.config, step: parseInt(e.target.value) || 1 }
                                                                                                                        })}
                                                                                                                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs outline-none focus:border-purple-500 transition-colors"
                                                                                                                    />
                                                                                                                </div>
                                                                                                            </div>
                                                                                                        )}

                                                                                                        {element.type === 'text' && (
                                                                                                            <div className="grid grid-cols-2 gap-2">
                                                                                                                <div>
                                                                                                                    <label className="block text-xs text-gray-600 mb-1">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.separator)}</label>
                                                                                                                    <input
                                                                                                                        type="text"
                                                                                                                        value={element.config?.separator || ''}
                                                                                                                        onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                            config: { ...element.config, separator: e.target.value }
                                                                                                                        })}
                                                                                                                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs outline-none focus:border-purple-500 transition-colors"
                                                                                                                        placeholder=","
                                                                                                                    />
                                                                                                                </div>
                                                                                                                <div>
                                                                                                                    <label className="block text-xs text-gray-600 mb-1">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.placeholder)}</label>
                                                                                                                    <input
                                                                                                                        type="text"
                                                                                                                        value={element.config?.placeholder?.ja || ''}
                                                                                                                        onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                            config: { ...element.config, placeholder: { ja: e.target.value } }
                                                                                                                        })}
                                                                                                                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs outline-none focus:border-purple-500 transition-colors"
                                                                                                                    />
                                                                                                                </div>
                                                                                                            </div>
                                                                                                        )}

                                                                                                        {element.type === 'textarea' && (
                                                                                                            <div>
                                                                                                                <label className="block text-xs text-gray-600 mb-1">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.rows)}</label>
                                                                                                                <input
                                                                                                                    type="number"
                                                                                                                    value={element.config?.rows ?? 3}
                                                                                                                    onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                        config: { ...element.config, rows: parseInt(e.target.value) || 3 }
                                                                                                                    })}
                                                                                                                    min={1}
                                                                                                                    max={20}
                                                                                                                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs outline-none focus:border-purple-500 transition-colors"
                                                                                                                />
                                                                                                            </div>
                                                                                                        )}

                                                                                                        {element.type === 'dropdown' && (
                                                                                                            <div className="space-y-2">
                                                                                                                <div className="flex items-center justify-between">
                                                                                                                    <label className="block text-xs text-gray-600">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.options)}</label>
                                                                                                                    <button
                                                                                                                        onClick={() => {
                                                                                                                            const currentOptions = element.config?.options || [];
                                                                                                                            updateElement(group.id, element.id, {
                                                                                                                                config: {
                                                                                                                                    ...element.config,
                                                                                                                                    options: [
                                                                                                                                        ...currentOptions,
                                                                                                                                        {
                                                                                                                                            value: `option_${currentOptions.length + 1}`,
                                                                                                                                            label: {
                                                                                                                                                ja: formatText(t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.optionDefaultLabel), {
                                                                                                                                                    index: currentOptions.length + 1,
                                                                                                                                                }),
                                                                                                                                                en: `Option ${currentOptions.length + 1}`,
                                                                                                                                            }
                                                                                                                                        }
                                                                                                                                    ]
                                                                                                                                }
                                                                                                                            });
                                                                                                                        }}
                                                                                                                        className="text-xs text-purple-400 hover:text-purple-300"
                                                                                                                    >
                                                                                                                        {t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.addOption)}
                                                                                                                    </button>
                                                                                                                </div>
                                                                                                                <div className="space-y-1 max-h-32 overflow-y-auto">
                                                                                                                    {(element.config?.options || []).map((opt: { value: unknown; label: { ja: string; en?: string } }, optIndex: number) => (
                                                                                                                        <div key={optIndex} className="flex items-center gap-1 bg-gray-800 rounded p-1">
                                                                                                                            <input
                                                                                                                                type="text"
                                                                                                                                value={String(opt.value)}
                                                                                                                                onChange={(e) => {
                                                                                                                                    const newOptions = [...(element.config?.options || [])];
                                                                                                                                    newOptions[optIndex] = { ...newOptions[optIndex], value: e.target.value };
                                                                                                                                    updateElement(group.id, element.id, {
                                                                                                                                        config: { ...element.config, options: newOptions }
                                                                                                                                    });
                                                                                                                                }}
                                                                                                                                className="flex-1 bg-gray-700 border-none rounded px-1 py-0.5 text-gray-300 text-xs focus:outline-none"
                                                                                                                                placeholder={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.value)}
                                                                                                                                title={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.value)}
                                                                                                                            />
                                                                                                                            <input
                                                                                                                                type="text"
                                                                                                                                value={editingLanguage === 'ja' ? opt.label.ja : (opt.label.en || '')}
                                                                                                                                onChange={(e) => {
                                                                                                                                    const newOptions = [...(element.config?.options || [])];
                                                                                                                                    newOptions[optIndex] = {
                                                                                                                                        ...newOptions[optIndex],
                                                                                                                                        label: { ...newOptions[optIndex].label, [editingLanguage]: e.target.value }
                                                                                                                                    };
                                                                                                                                    updateElement(group.id, element.id, {
                                                                                                                                        config: { ...element.config, options: newOptions }
                                                                                                                                    });
                                                                                                                                }}
                                                                                                                                className="flex-1 bg-gray-700 border-none rounded px-1 py-0.5 text-gray-300 text-xs focus:outline-none"
                                                                                                                                placeholder={editingLanguage === 'ja' ? t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.optionLabel) : 'Label'}
                                                                                                                                title={editingLanguage === 'ja' ? t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.optionLabelJaTitle) : 'Label (English)'}
                                                                                                                            />
                                                                                                                            <button
                                                                                                                                onClick={() => {
                                                                                                                                    const newOptions = (element.config?.options || []).filter((_: unknown, i: number) => i !== optIndex);
                                                                                                                                    updateElement(group.id, element.id, {
                                                                                                                                        config: { ...element.config, options: newOptions }
                                                                                                                                    });
                                                                                                                                }}
                                                                                                                                className="text-gray-500 hover:text-red-400 p-0.5"
                                                                                                                            >
                                                                                                                                <Trash2 size={10} />
                                                                                                                            </button>
                                                                                                                        </div>
                                                                                                                    ))}
                                                                                                                    {(element.config?.options || []).length === 0 && (
                                                                                                                        <p className="text-xs text-gray-600 italic">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.noOptions)}</p>
                                                                                                                    )}
                                                                                                                </div>
                                                                                                            </div>
                                                                                                        )}

                                                                                                        {element.type === 'composite' && (
                                                                                                            <div className="space-y-2">
                                                                                                                <div>
                                                                                                                    <label className="block text-xs text-gray-600 mb-1">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.compositeType)}</label>
                                                                                                                    <select
                                                                                                                        value={element.config?.compositeType || 'yearMonthDay'}
                                                                                                                        onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                            config: { ...element.config, compositeType: e.target.value as 'yearMonthDay' }
                                                                                                                        })}
                                                                                                                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs outline-none focus:border-purple-500 transition-colors"
                                                                                                                    >
                                                                                                                        <option value="yearMonthDay">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.yearMonthDay)}</option>
                                                                                                                    </select>
                                                                                                                </div>
                                                                                                                <div className="grid grid-cols-3 gap-2">
                                                                                                                    <div>
                                                                                                                        <label className="block text-xs text-gray-600 mb-1">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.yearRange)}</label>
                                                                                                                        <div className="flex gap-1">
                                                                                                                            <input
                                                                                                                                type="number"
                                                                                                                                value={element.config?.yearRange?.[0] ?? 0}
                                                                                                                                onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                                    config: {
                                                                                                                                        ...element.config,
                                                                                                                                        yearRange: [parseInt(e.target.value) || 0, element.config?.yearRange?.[1] ?? 100]
                                                                                                                                    }
                                                                                                                                })}
                                                                                                                                className="w-1/2 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-gray-300 text-xs"
                                                                                                                                placeholder={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.minPlaceholder)}
                                                                                                                            />
                                                                                                                            <input
                                                                                                                                type="number"
                                                                                                                                value={element.config?.yearRange?.[1] ?? 100}
                                                                                                                                onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                                    config: {
                                                                                                                                        ...element.config,
                                                                                                                                        yearRange: [element.config?.yearRange?.[0] ?? 0, parseInt(e.target.value) || 100]
                                                                                                                                    }
                                                                                                                                })}
                                                                                                                                className="w-1/2 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-gray-300 text-xs"
                                                                                                                                placeholder={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.maxPlaceholder)}
                                                                                                                            />
                                                                                                                        </div>
                                                                                                                    </div>
                                                                                                                    <div>
                                                                                                                        <label className="block text-xs text-gray-600 mb-1">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.monthRange)}</label>
                                                                                                                        <div className="flex gap-1">
                                                                                                                            <input
                                                                                                                                type="number"
                                                                                                                                value={element.config?.monthRange?.[0] ?? 0}
                                                                                                                                onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                                    config: {
                                                                                                                                        ...element.config,
                                                                                                                                        monthRange: [parseInt(e.target.value) || 0, element.config?.monthRange?.[1] ?? 11]
                                                                                                                                    }
                                                                                                                                })}
                                                                                                                                className="w-1/2 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-gray-300 text-xs"
                                                                                                                            />
                                                                                                                            <input
                                                                                                                                type="number"
                                                                                                                                value={element.config?.monthRange?.[1] ?? 11}
                                                                                                                                onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                                    config: {
                                                                                                                                        ...element.config,
                                                                                                                                        monthRange: [element.config?.monthRange?.[0] ?? 0, parseInt(e.target.value) || 11]
                                                                                                                                    }
                                                                                                                                })}
                                                                                                                                className="w-1/2 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-gray-300 text-xs"
                                                                                                                            />
                                                                                                                        </div>
                                                                                                                    </div>
                                                                                                                    <div>
                                                                                                                        <label className="block text-xs text-gray-600 mb-1">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.dayRange)}</label>
                                                                                                                        <div className="flex gap-1">
                                                                                                                            <input
                                                                                                                                type="number"
                                                                                                                                value={element.config?.dayRange?.[0] ?? 0}
                                                                                                                                onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                                    config: {
                                                                                                                                        ...element.config,
                                                                                                                                        dayRange: [parseInt(e.target.value) || 0, element.config?.dayRange?.[1] ?? 30]
                                                                                                                                    }
                                                                                                                                })}
                                                                                                                                className="w-1/2 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-gray-300 text-xs"
                                                                                                                            />
                                                                                                                            <input
                                                                                                                                type="number"
                                                                                                                                value={element.config?.dayRange?.[1] ?? 30}
                                                                                                                                onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                                    config: {
                                                                                                                                        ...element.config,
                                                                                                                                        dayRange: [element.config?.dayRange?.[0] ?? 0, parseInt(e.target.value) || 30]
                                                                                                                                    }
                                                                                                                                })}
                                                                                                                                className="w-1/2 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-gray-300 text-xs"
                                                                                                                            />
                                                                                                                        </div>
                                                                                                                    </div>
                                                                                                                </div>
                                                                                                            </div>
                                                                                                        )}

                                                                                                        {/* 親子関係設定 */}
                                                                                                        <div className="border-t border-gray-700 pt-2 mt-2">
                                                                                                            <label className="block text-xs text-gray-500 mb-2 font-medium">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.parentSettings)}</label>

                                                                                                            {/* 親要素選択 */}
                                                                                                            <div className="mb-2">
                                                                                                                <label className="block text-xs text-gray-600 mb-1">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.parentElement)}</label>
                                                                                                                <select
                                                                                                                    value={element.parentId || ''}
                                                                                                                    onChange={(e) => {
                                                                                                                        const newParentId = e.target.value || undefined;
                                                                                                                        if (newParentId) {
                                                                                                                            updateElement(group.id, element.id, {
                                                                                                                                parentId: newParentId,
                                                                                                                                showCondition: element.showCondition || {
                                                                                                                                    parentId: newParentId,
                                                                                                                                    operator: '===',
                                                                                                                                    value: ''
                                                                                                                                }
                                                                                                                            });
                                                                                                                        } else {
                                                                                                                            updateElement(group.id, element.id, {
                                                                                                                                parentId: undefined,
                                                                                                                                showCondition: undefined
                                                                                                                            });
                                                                                                                        }
                                                                                                                    }}
                                                                                                                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs outline-none focus:border-purple-500 transition-colors"
                                                                                                                >
                                                                                                                    <option value="">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.none)}</option>
                                                                                                                    {group.elements
                                                                                                                        .filter(e => e.id !== element.id)
                                                                                                                        .map(e => (
                                                                                                                            <option key={e.id} value={e.id}>
                                                                                                                                {e.displayName.ja || e.id}
                                                                                                                            </option>
                                                                                                                        ))
                                                                                                                    }
                                                                                                                </select>
                                                                                                            </div>

                                                                                                            {/* 表示条件設定（親要素が選択されている場合のみ表示） */}
                                                                                                            {element.parentId && (
                                                                                                                <div className="space-y-2 pl-2 border-l-2 border-purple-500/30">
                                                                                                                    <div className="grid grid-cols-2 gap-2">
                                                                                                                        <div>
                                                                                                                            <label className="block text-xs text-gray-600 mb-1">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.operator)}</label>
                                                                                                                            <select
                                                                                                                                value={element.showCondition?.operator || '==='}
                                                                                                                                onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                                    showCondition: {
                                                                                                                                        ...element.showCondition,
                                                                                                                                        parentId: element.parentId!,
                                                                                                                                        operator: e.target.value as '===' | '!==' | '>' | '<' | '>=' | '<=' | 'range'
                                                                                                                                    }
                                                                                                                                })}
                                                                                                                                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs outline-none focus:border-purple-500 transition-colors"
                                                                                                                            >
                                                                                                                                <option value="===">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.opEq)}</option>
                                                                                                                                <option value="!==">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.opNe)}</option>
                                                                                                                                <option value=">">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.opGt)}</option>
                                                                                                                                <option value="<">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.opLt)}</option>
                                                                                                                                <option value=">=">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.opGte)}</option>
                                                                                                                                <option value="<=">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.opLte)}</option>
                                                                                                                                <option value="range">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.opRange)}</option>
                                                                                                                            </select>
                                                                                                                        </div>

                                                                                                                        {/* 単一値入力（range以外） */}
                                                                                                                        {element.showCondition?.operator !== 'range' && (
                                                                                                                            <div>
                                                                                                                                <label className="block text-xs text-gray-600 mb-1">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.value)}</label>
                                                                                                                                <input
                                                                                                                                    type="text"
                                                                                                                                    value={element.showCondition?.value ?? ''}
                                                                                                                                    onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                                        showCondition: {
                                                                                                                                            ...element.showCondition,
                                                                                                                                            parentId: element.parentId!,
                                                                                                                                            operator: element.showCondition?.operator || '===',
                                                                                                                                            value: e.target.value
                                                                                                                                        }
                                                                                                                                    })}
                                                                                                                                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs outline-none focus:border-purple-500 transition-colors"
                                                                                                                                    placeholder={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.comparisonValuePlaceholder)}
                                                                                                                                />
                                                                                                                            </div>
                                                                                                                        )}
                                                                                                                    </div>

                                                                                                                    {/* 範囲入力（range の場合） */}
                                                                                                                    {element.showCondition?.operator === 'range' && (
                                                                                                                        <div className="grid grid-cols-2 gap-2">
                                                                                                                            <div>
                                                                                                                                <label className="block text-xs text-gray-600 mb-1">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.min)}</label>
                                                                                                                                <input
                                                                                                                                    type="number"
                                                                                                                                    value={element.showCondition?.min ?? ''}
                                                                                                                                    onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                                        showCondition: {
                                                                                                                                            ...element.showCondition,
                                                                                                                                            parentId: element.parentId!,
                                                                                                                                            operator: 'range',
                                                                                                                                            min: e.target.value ? parseInt(e.target.value) : undefined
                                                                                                                                        }
                                                                                                                                    })}
                                                                                                                                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs outline-none focus:border-purple-500 transition-colors"
                                                                                                                                />
                                                                                                                            </div>
                                                                                                                            <div>
                                                                                                                                <label className="block text-xs text-gray-600 mb-1">{t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.max)}</label>
                                                                                                                                <input
                                                                                                                                    type="number"
                                                                                                                                    value={element.showCondition?.max ?? ''}
                                                                                                                                    onChange={(e) => updateElement(group.id, element.id, {
                                                                                                                                        showCondition: {
                                                                                                                                            ...element.showCondition,
                                                                                                                                            parentId: element.parentId!,
                                                                                                                                            operator: 'range',
                                                                                                                                            max: e.target.value ? parseInt(e.target.value) : undefined
                                                                                                                                        }
                                                                                                                                    })}
                                                                                                                                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs outline-none focus:border-purple-500 transition-colors"
                                                                                                                                />
                                                                                                                            </div>
                                                                                                                        </div>
                                                                                                                    )}
                                                                                                                </div>
                                                                                                            )}
                                                                                                        </div>
                                                                                                    </div>
                                                                                                )}
                                                                                            </div>
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="text-center py-10 text-gray-500">
                                {t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.selectOrCreate)}
                            </div>
                        )}
                    </div>

                    {/* フッター */}
                    <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-700 bg-gray-800/50 shrink-0">
                        <button
                            onClick={handleClose}
                            className="px-5 py-2 text-sm text-gray-300 hover:text-gray-100 hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            {t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.close)}
                        </button>
                        <button
                            onClick={saveSchema}
                            disabled={isSaving || !editingSchema}
                            className="flex items-center gap-2 px-5 py-2 text-sm text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg transition-colors"
                        >
                            <Save size={16} />
                            {isSaving ? t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.saving) : t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.save)}
                        </button>
                    </div>
                </div>
            </div>

            {/* 削除確認ダイアログ */}
            <ConfirmDialog
                isOpen={showDeleteConfirm}
                title={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.deleteSchemaTitle)}
                message={formatText(t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.deleteSchemaMessage), {
                    name: editingSchema?.schemaName.ja || selectedSchemaId || '',
                })}
                onYes={deleteSchema}
                onNo={() => setShowDeleteConfirm(false)}
                onCancel={() => setShowDeleteConfirm(false)}
            />

            {/* 未保存確認ダイアログ */}
            <ConfirmDialog
                isOpen={showUnsavedConfirm}
                title={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.unsavedTitle)}
                message={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.unsavedMessage)}
                onYes={() => {
                    setShowUnsavedConfirm(false);
                    if (pendingAction) {
                        pendingAction();
                        setPendingAction(null);
                    }
                }}
                onNo={() => {
                    setShowUnsavedConfirm(false);
                    setPendingAction(null);
                }}
                onCancel={() => {
                    setShowUnsavedConfirm(false);
                    setPendingAction(null);
                }}
            />

            {/* グループ削除確認ダイアログ */}
            <ConfirmDialog
                isOpen={showGroupDeleteConfirm}
                title={t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.deleteGroupTitle)}
                message={formatText(t(PARAMETER_SCHEMA_EDITOR_I18N_KEYS.deleteGroupMessage), {
                    count: editingSchema?.groups.find(g => g.id === pendingDeleteGroupId)?.elements.length || 0,
                })}
                onYes={() => {
                    if (pendingDeleteGroupId) {
                        executeRemoveGroup(pendingDeleteGroupId);
                    }
                }}
                onNo={() => {
                    setShowGroupDeleteConfirm(false);
                    setPendingDeleteGroupId(null);
                }}
                onCancel={() => {
                    setShowGroupDeleteConfirm(false);
                    setPendingDeleteGroupId(null);
                }}
            />
        </>
    );
};
