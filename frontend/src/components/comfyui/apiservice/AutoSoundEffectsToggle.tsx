/**
 * AutoSoundEffectsToggle.tsx - 自動効果音描画のトグル
 *
 * 値は全体で 1 つ。画像生成統合設定・スマホ版の画像生成設定・チャットの左メニューの 3 つの画面に
 * 置き、どこで切り替えても同じ値を読み書きする。切り替えたら、この値だけを書く専用の保存の口で
 * 即時保存する（設定全体を読んで書き戻す方式は使わない）。画面を開くたびに保存済みの値を読み直す。
 * 保存に失敗したら、トグルを元の位置へ戻して、その場に失敗を表示する。
 * 対応モデルを選んでいるときだけ表示する。非表示にしても保存値は保持する。
 */

import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import {
    apiServiceAutoSoundEffectsOf,
    apiServiceModelOf,
    getApiServiceCatalog,
    getComfyUIConfig,
    setApiServiceAutoSoundEffects,
} from '../../../api/comfyui';
import type { ApiServiceId, ComfyUIConfig } from '../../../api/comfyui';
import { normalizeApiService, normalizeImageBackend } from './services';
import type { I18NCatalog } from '../../../api/i18n';
import { ToggleSwitch } from '../../common/ToggleSwitch';
import { createComfyUIText } from '../i18n';

interface AutoSoundEffectsToggleProps {
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    /** 値を読み書きする API サービス。未指定なら、全体の設定で選ばれているサービス */
    service?: ApiServiceId;
    /** 親のモデル選択に追従する。未指定なら保存済み設定を使う */
    modelId?: string;
    active: boolean;
    /** 説明文と注意書きを添えるか（左メニューではトグルだけを置く） */
    showHelp?: boolean;
    /** 真なら、全体の設定で API サービスが選ばれているときだけ表示する（親が選択を持たない画面用） */
    onlyWhenApiBackend?: boolean;
    /**
     * 親が開くたびに読み直している設定。渡されたときは、この部品は自前で読みに行かず、渡された
     * 設定から値を取る（同じ設定を二重に読まない）。読み込み前は null。
     */
    source?: ComfyUIConfig | null;
    size?: 'sm' | 'md';
}

export const AutoSoundEffectsToggle: React.FC<AutoSoundEffectsToggleProps> = ({
    backendUrl,
    uiCatalog = null,
    service,
    modelId,
    active,
    showHelp = false,
    onlyWhenApiBackend = false,
    source,
    size = 'md',
}) => {
    const { API_SERVICE } = createComfyUIText(uiCatalog);
    const [enabled, setEnabled] = useState(false);
    const [resolvedService, setResolvedService] = useState<ApiServiceId>(service ?? 'novelai');
    // API サービスのときだけ出す指定では、設定を読むまでは出さない。
    const [isApiBackend, setIsApiBackend] = useState(!onlyWhenApiBackend);
    const [failed, setFailed] = useState(false);
    const [savedModel, setSavedModel] = useState('');
    const [supportedModels, setSupportedModels] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    // 表示が更新される前の連続操作も含め、保存中の変更を受け付けない。
    const savingRef = useRef(false);

    const applyConfig = (config: ComfyUIConfig) => {
        const target = service ?? normalizeApiService(config.apiService);
        setResolvedService(target);
        setSavedModel(apiServiceModelOf(config, target));
        setIsApiBackend(!onlyWhenApiBackend || normalizeImageBackend(config.imageBackend) === 'api');
        setEnabled(apiServiceAutoSoundEffectsOf(config, target));
        setFailed(false);
    };

    // 画面を開くたびに、保存済みの値を読み直す（ほかの画面での変更を拾う）。
    // 親が読み直した設定を渡してくる画面では、自前では読まない。
    const loadsBySelf = source === undefined;
    useEffect(() => {
        if (!active || !loadsBySelf) return;
        let cancelled = false;
        (async () => {
            try {
                const config = await getComfyUIConfig(backendUrl);
                if (cancelled) return;
                applyConfig(config);
            } catch (e) {
                console.error('[AutoSoundEffectsToggle] load failed:', e);
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, backendUrl, service, onlyWhenApiBackend, loadsBySelf]);

    // 親が読み直した設定が届くたびに、その値を反映する。
    useEffect(() => {
        if (source) applyConfig(source);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [source]);

    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        setSupportedModels([]);
        void getApiServiceCatalog(backendUrl, resolvedService).then((catalog) => {
            if (!cancelled) setSupportedModels(catalog.models.filter(model => model.supportsSoundEffects).map(model => model.id));
        }).catch((error) => {
            console.error('[AutoSoundEffectsToggle] catalog load failed:', error);
        });
        return () => { cancelled = true; };
    }, [active, backendUrl, resolvedService]);

    const handleChange = (next: boolean) => {
        if (savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        const previous = enabled;
        setEnabled(next);
        setFailed(false);
        const run = async () => {
            try {
                setEnabled(await setApiServiceAutoSoundEffects(backendUrl, next, resolvedService));
            } catch (e) {
                // 保存できなかったので、トグルを元の位置へ戻す。
                console.error('[AutoSoundEffectsToggle] save failed:', e);
                setEnabled(previous);
                setFailed(true);
            } finally {
                savingRef.current = false;
                setSaving(false);
            }
        };
        void run();
    };

    if (!isApiBackend || !supportedModels.includes(modelId ?? savedModel)) return null;

    return (
        <div className="space-y-1" data-testid="auto-sound-effects-toggle">
            <ToggleSwitch
                checked={enabled}
                onChange={handleChange}
                disabled={saving}
                label={API_SERVICE.LABELS.AUTO_SOUND_EFFECTS}
                labelPosition="right"
                accent="green"
                size={size}
            />
            {showHelp && (
                <>
                    <p className="text-xs text-gray-500">{API_SERVICE.HELP.AUTO_SOUND_EFFECTS}</p>
                    <p className="text-xs text-amber-300/80">{API_SERVICE.HELP.AUTO_SOUND_EFFECTS_NOTE}</p>
                </>
            )}
            {failed && (
                <p className="flex items-center gap-1 text-xs text-red-300">
                    <AlertCircle size={12} />
                    {API_SERVICE.MESSAGES.AUTO_SOUND_EFFECTS_SAVE_FAILED}
                </p>
            )}
        </div>
    );
};
