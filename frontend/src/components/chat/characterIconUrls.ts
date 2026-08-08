/**
 * キャラクターアイコンの表示 URL を、バックエンドの画像一覧応答から組み立てる。
 *
 * チャット側で URL を自前組み立てすると、拡張子（webp/png/jpg）の実在解決と
 * ハッシュ由来のキャッシュ更新をバックエンドと二重管理することになり、
 * 画像を差し替えても古いアイコンが表示され続ける。
 * /api/characters/{name}/images が返す iconUrl をそのまま使うことで、
 * 拡張子とキャッシュ更新の判断をバックエンド側の一箇所に寄せる。
 */

/** /api/characters/{name}/images の images 配下 1 件ぶん（利用する項目のみ）。 */
export interface CharacterImageEntry {
    iconUrl?: string | null;
}

/** 心情名 → アイコン URL（backendUrl を前置していない相対パス）。 */
export type CharacterIconUrlMap = Record<string, string>;

/** 物理ディレクトリ名 → 心情ごとのアイコン URL。 */
export type CharacterIconUrlsByDirectory = Record<string, CharacterIconUrlMap>;

/**
 * 画像一覧応答の images から、心情 → iconUrl のマップを作る。
 * アイコン未設定の心情（iconUrl が null）は含めない。
 */
export function buildCharacterIconUrlMap(
    images: Record<string, CharacterImageEntry> | null | undefined
): CharacterIconUrlMap {
    const result: CharacterIconUrlMap = {};
    if (!images) return result;

    for (const [emotion, entry] of Object.entries(images)) {
        const iconUrl = entry?.iconUrl;
        if (typeof iconUrl === 'string' && iconUrl !== '') {
            result[emotion] = iconUrl;
        }
    }

    return result;
}

/**
 * 表示用のアイコン URL を決める。
 * 取得済みマップに該当心情があればそれを使い、無ければ従来の拡張子固定パスへ退避する。
 * 退避パスはアイコン未取得（読み込み中・取得失敗）でも表示を試みるための保険であり、
 * 実在しなければ img の onError でフォールバックされる。
 *
 * backendUrl の空文字は同一オリジン（Go 同梱フロント）を意味する正常な値であり、
 * 未設定として扱ってはならない。空を弾くと同梱ビルドでアイコンが一切要求されなくなる。
 */
export function resolveCharacterIconUrl(
    backendUrl: string,
    directoryName: string,
    emotion: string,
    iconUrls: CharacterIconUrlMap | undefined
): string {
    if (!directoryName) {
        return '/assets/default/no-image-female.png';
    }

    const known = iconUrls?.[emotion];
    if (known) {
        return `${backendUrl}${known}`;
    }

    return `${backendUrl}/images/characters/${encodeURIComponent(directoryName)}/images/icons/${emotion}.png`;
}
