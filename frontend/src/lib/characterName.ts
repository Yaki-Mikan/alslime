/**
 * キャラクター名の照合用正規化と、一時キャラクターの仮想パス判定。
 *
 * 正規化の規則はサーバー側（alslime/internal/domain/charname/normalize.go）と同じ：
 * NFKC 正規化 → 拡張子除去 → 区切り記号（_ - 半角空白 全角空白 ・ ー）除去 → 小文字化。
 * 話者名の表記ゆれを束ねるときと、登録済みキャラクターかどうかを判定するときに使う。
 */

/** 一時キャラクターの仮想パスの接頭辞（実ディレクトリは存在しない） */
export const TEMP_CHARACTER_DIR = 'roleplay/temp_characters';

/** 会話設定の characters 要素が一時キャラクターの仮想パスかどうか */
export function isTempCharacterPath(value: string | null | undefined): boolean {
    if (!value) return false;
    const p = value.replace(/\\/g, '/').trim();
    return p.startsWith(`${TEMP_CHARACTER_DIR}/`);
}

/** 拡張子を取り除く（最後のパス要素の最後のドット以降）。サーバー側の path.Ext と同じ規則 */
function stripExt(value: string): string {
    const base = value.slice(value.lastIndexOf('/') + 1);
    const dot = base.lastIndexOf('.');
    if (dot < 0) return value;
    return value.slice(0, value.length - (base.length - dot));
}

/** 除去する区切り記号（全角空白 U+3000 はソース上に直接置かず文字コードで組む） */
const SEPARATOR_PATTERN = new RegExp('[_\\- ' + String.fromCharCode(0x3000) + '・ー]', 'g');

/** 照合用に名前を正規化する */
export function normalizeCharacterName(value: string): string {
    let v = value.trim().normalize('NFKC');
    v = stripExt(v);
    v = v.replace(SEPARATOR_PATTERN, '');
    return v.toLowerCase();
}
