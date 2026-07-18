import type { DanbooruTagFormat, TriggerWordFormat } from '../../api/comfyui';

export function formatDanbooruTag(value: string, format: DanbooruTagFormat): string {
    return format === 'space' ? value.replace(/_/g, ' ') : value;
}

/**
 * トリガーワードのコピー時変換。
 *   raw        … 一切変換しない（元の表記のまま）
 *   underscore … スペースを _ に寄せる
 *   space      … _ をスペースに寄せる
 */
export function formatTriggerWord(value: string, format: TriggerWordFormat): string {
    if (format === 'space') return value.replace(/_/g, ' ');
    if (format === 'underscore') return value.replace(/ /g, '_');
    return value;
}

/**
 * 1行（カンマ区切りのワード群）全体にフォーマットを適用する。
 * 行内の各ワードに formatTriggerWord を掛けてからカンマ連結し直す。
 */
export function formatTriggerLine(line: string, format: TriggerWordFormat): string {
    if (format === 'raw') return line;
    return line
        .split(',')
        .map(w => w.trim())
        .filter(w => w.length > 0)
        .map(w => formatTriggerWord(w, format))
        .join(', ');
}

/**
 * 重複判定用にワードを正規化する。
 * 表記揺れ（アンダーバー/スペース）と大小文字を吸収して比較キーにする。
 */
function normalizeWordKey(word: string): string {
    return word.trim().replace(/_/g, ' ').toLowerCase();
}

/**
 * 既存のトリガーワード欄（カンマ区切り文字列）に、追加する行のワードを
 * ワード単位で重複除去しながら連結する。
 * 既に欄にあるワード（表記揺れ・大小文字無視）はスキップする。
 *
 * @param current   既存のトリガーワード欄文字列
 * @param line      追加する1行（カンマ区切りのワード群）
 * @param format    追加するワードに適用するフォーマット
 * @returns 重複除去後の連結文字列
 */
export function appendTriggerLineDedup(current: string, line: string, format: TriggerWordFormat): string {
    const existingWords = current.split(',').map(w => w.trim()).filter(w => w.length > 0);
    const existingKeys = new Set(existingWords.map(normalizeWordKey));

    const result = [...existingWords];
    for (const raw of line.split(',')) {
        const word = formatTriggerWord(raw.trim(), format);
        if (!word) continue;
        const key = normalizeWordKey(word);
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        result.push(word);
    }
    return result.join(', ');
}
