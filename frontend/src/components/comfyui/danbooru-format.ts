import type { DanbooruTagFormat, TriggerWordFormat } from '../../api/comfyui';

/**
 * Anima向け表記。半角スペース区切りにした上で、括弧を \( \) にエスケープする
 * （例: char (series) → char \(series\)）。既にエスケープ済みの括弧は二重にしない。
 */
export function formatAnima(value: string): string {
    return value
        .replace(/_/g, ' ')
        .replace(/\\?([()])/g, '\\$1');
}

/**
 * キャラクター名・作品名（ComfyUI 用と API サービス用で共用の値）を、ComfyUI 用の
 * Danbooru タグ形式の設定に合わせた表記へ変換する。サーバー側の出力時変換と同じ規則で、
 * 画面の出力表示に使う。カンマ区切りの複数タグは要素ごとに変換する。
 */
export function formatIdentityForComfyUI(value: string, format: DanbooruTagFormat): string {
    return value
        .split(',')
        .map((part) => part.replace(/\\+([()])/g, '$1').replace(/_/g, ' ').trim().split(/\s+/).filter(Boolean))
        .filter((words) => words.length > 0)
        .map((words) => {
            if (format === 'space') return words.join(' ');
            if (format === 'anima') return words.join(' ').replace(/([()])/g, '\\$1');
            return words.join('_');
        })
        .join(', ');
}

/**
 * API サービス（NovelAI）の送信時変換と同じ規則（括弧のエスケープを外し、_ を半角スペースへ）。
 * 画面の出力表示に使う。
 */
export function formatForApiService(value: string): string {
    return value
        .split(',')
        .map((part) => part.replace(/\\+([()])/g, '$1').replace(/_/g, ' ').replace(/[ \t]{2,}/g, ' ').trim())
        .filter(Boolean)
        .join(', ');
}

export function formatDanbooruTag(value: string, format: DanbooruTagFormat): string {
    if (format === 'anima') return formatAnima(value);
    return format === 'space' ? value.replace(/_/g, ' ') : value;
}

/**
 * トリガーワードのコピー時変換。
 *   raw        … 一切変換しない（元の表記のまま）
 *   underscore … スペースを _ に寄せる
 *   space      … _ をスペースに寄せる
 */
export function formatTriggerWord(value: string, format: TriggerWordFormat): string {
    if (format === 'anima') return formatAnima(value);
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
    return word.trim().replace(/_/g, ' ').replace(/\\([()])/g, '$1').toLowerCase();
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
