/**
 * 個別設定（性格／服装・髪型／背景）の選択肢取得。
 *
 * 会話設定（RolePlaySettings）と設定ファイルエディタの設定紐づけタブが
 * 同じ取得方法を使うために切り出したもの。選択肢は
 * [個別]（キャラ配下 <dir>/personalities 等）＋[共通]（roleplay/global/...）の連結。
 */

import { listFiles } from '../../api/files';
import { WORKSPACE_PATHS, CHARACTER_SUBDIRS } from '../../constants/workspacePaths';

export interface IndividualOption {
    label: string;
    value: string;
}

export type IndividualKind = 'personalities' | 'outfits' | 'backgrounds';

export const INDIVIDUAL_KINDS: IndividualKind[] = ['personalities', 'outfits', 'backgrounds'];

/** 種別ごとのキャラ配下サブディレクトリと共通ディレクトリ */
export const INDIVIDUAL_DIRS: Record<IndividualKind, { localDir: string; globalDir: string }> = {
    personalities: { localDir: CHARACTER_SUBDIRS.PERSONALITIES, globalDir: WORKSPACE_PATHS.PERSONALITIES },
    outfits: { localDir: CHARACTER_SUBDIRS.OUTFITS_HAIR, globalDir: WORKSPACE_PATHS.OUTFITS_HAIR },
    backgrounds: { localDir: CHARACTER_SUBDIRS.BACKGROUNDS, globalDir: WORKSPACE_PATHS.BACKGROUNDS },
};

/**
 * ディレクトリを再帰的に探索して .md ファイルの一覧を返す。
 * サブディレクトリにあるファイルは「ディレクトリ名/ファイル名」形式でラベルを付ける。
 * サブディレクトリの探索は並列実行し、結果は元の走査順を維持して結合する。
 */
export async function loadDirRecursive(dirPath: string, prefix: string = ''): Promise<IndividualOption[]> {
    try {
        const res = await listFiles(dirPath);
        const parts = await Promise.all(res.files.map(async (f): Promise<IndividualOption[]> => {
            if (f.isDirectory) {
                const subPrefix = prefix ? `${prefix}/${f.name}` : f.name;
                return loadDirRecursive(f.path, subPrefix);
            }
            if (f.name.endsWith('.md')) {
                const baseName = f.name.replace('.md', '');
                const label = prefix ? `${prefix}/${baseName}` : baseName;
                return [{ label, value: f.path }];
            }
            return [];
        }));
        return parts.flat();
    } catch {
        // アクセスできないディレクトリは無視
        return [];
    }
}

/**
 * キャラ設定ファイルのパス（.../<dir>/settings/<name>.md）からキャラディレクトリのパスを得る。
 * .md でなければそのまま返す。
 */
export function characterBasePath(charPath: string): string {
    if (!charPath.endsWith('.md')) return charPath;
    const parts = charPath.split('/');
    parts.pop();
    parts.pop();
    return parts.join('/');
}

/**
 * 1 種別分の選択肢（[個別] → [共通] の順）を返す。
 * labels は接頭辞の表示文言（i18n 済み）。
 */
export async function loadIndividualOptions(
    charBasePath: string,
    kind: IndividualKind,
    labels: { local: string; shared: string },
): Promise<IndividualOption[]> {
    const { localDir, globalDir } = INDIVIDUAL_DIRS[kind];
    const [localFiles, globalOptions] = await Promise.all([
        listFiles(`${charBasePath}/${localDir}`).catch(() => ({ files: [] })),
        loadDirRecursive(globalDir).catch(() => [] as IndividualOption[]),
    ]);
    return [
        ...localFiles.files
            .filter(f => !f.isDirectory && f.name.endsWith('.md'))
            .map(f => ({ label: `[${labels.local}] ${f.name.replace('.md', '')}`, value: f.path })),
        ...globalOptions.map(o => ({ label: `[${labels.shared}] ${o.label}`, value: o.value })),
    ];
}
