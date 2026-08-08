/**
 * 設定ファイルを収めるディレクトリの名前。
 * 保存済みセッションには日本語名時代のパスがそのまま残っているため、
 * 現行名だけを見ると旧セッションのキャラクター名が対応付けられない。
 */
const SETTINGS_DIRECTORY_NAMES = ['settings', '設定'];

/** パス要素のうち、最後に現れる設定ディレクトリの位置を返す（無ければ -1）。 */
function findSettingsIndex(parts: string[]): number {
    let found = -1;
    for (const name of SETTINGS_DIRECTORY_NAMES) {
        const index = parts.lastIndexOf(name);
        if (index > found) found = index;
    }
    return found;
}

/**
 * キャラクター設定ファイルのパスから、画像の保存先である
 * 物理キャラクターディレクトリ名を取り出す。
 *
 * 設定ファイル名は `キャラ名_v3.md` のように版が付くことがあり、
 * ファイル名をそのままディレクトリ名として扱うと存在しない保存先を作ってしまう。
 * 画像はキャラクターディレクトリ直下の images 配下に一元化されているため、
 * 常に設定ディレクトリの親を保存先とする。
 *
 * 例:
 * roleplay/characters/Alice/settings/Alice_v3.md -> Alice
 *
 * 設定ディレクトリを含まないパスは判断材料が無いため null を返す。
 */
export function extractCharacterDirectoryName(characterPath: string): string | null {
    const parts = characterPath.replace(/\\/g, '/').split('/').filter(Boolean);
    const settingsIndex = findSettingsIndex(parts);
    if (settingsIndex < 1) return null;

    return parts[settingsIndex - 1] || null;
}

/** 設定ファイルのパスから、拡張子を除いた設定名を取り出す。 */
function extractSettingName(characterPath: string): string | null {
    const parts = characterPath.replace(/\\/g, '/').split('/').filter(Boolean);
    const settingsIndex = findSettingsIndex(parts);
    if (settingsIndex < 0 || settingsIndex + 1 >= parts.length) return null;

    return parts[settingsIndex + 1].replace(/\.md$/i, '') || null;
}

/**
 * セッションに保存されたキャラクター設定パスから、TURN の character 名を
 * 画像保存先の物理キャラクターディレクトリ名へ対応付ける。
 *
 * 例:
 * roleplay/characters/Alice/settings/Alice_v3.md
 *   Alice_v3 -> Alice
 *   Alice    -> Alice
 */
export function buildCharacterImageDirectoryMap(characterPaths: string[]): Map<string, string> {
    const result = new Map<string, string>();

    for (const rawPath of characterPaths) {
        const directoryName = extractCharacterDirectoryName(rawPath);
        const settingName = extractSettingName(rawPath);
        if (!directoryName || !settingName) continue;

        result.set(settingName, directoryName);
        result.set(directoryName, directoryName);
    }

    return result;
}

export function resolveCharacterImageDirectory(
    characterName: string,
    directoryMap: ReadonlyMap<string, string>
): string {
    return directoryMap.get(characterName) || characterName;
}
