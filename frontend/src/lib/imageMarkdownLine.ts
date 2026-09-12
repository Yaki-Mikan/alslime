/**
 * imageMarkdownLine.ts - 本文中の画像記法行の判定とセグメント化
 *
 * AI 応答の本文に 1 行で書かれた画像記法（![alt](URL) / ![alt](URL "title")）を
 * 画像として表示するための純粋関数群。Markdown 全体の解釈は行わず、
 * 行全体が画像記法である行だけを対象にする。
 *
 * URL は http / https のみ受け付ける（data: や javascript: は文字列のまま表示する）。
 * 判定規則はサーバー側の TTS 読み上げ除外（alslime-core/tts/plan.go）と同じ内容に保つ。
 */

const IMAGE_MARKDOWN_LINE_PATTERN = /^!\[([^\]]*)\]\(\s*(https?:\/\/[^\s)"]+)(?:\s+"[^"]*")?\s*\)$/;

export interface ImageMarkdownLine {
    url: string;
    alt: string;
}

/** 行全体が画像記法なら url と alt を返す。そうでなければ null。 */
export function parseImageMarkdownLine(line: string): ImageMarkdownLine | null {
    const m = IMAGE_MARKDOWN_LINE_PATTERN.exec(line.trim());
    if (!m) return null;
    return { alt: m[1], url: m[2] };
}

export type TurnSegment =
    | { kind: 'text'; lines: string[] }
    | { kind: 'image'; url: string; alt: string };

/**
 * 行配列を画像行で区切り、文章セグメントと画像セグメントの列にする。
 * 空行だけの文章セグメントは吹き出しを出さないため捨てる。
 * 画像行が無ければ文章セグメント 1 つだけを返す（表示は従来と同じになる）。
 */
export function splitLinesIntoSegments(lines: string[]): TurnSegment[] {
    const out: TurnSegment[] = [];
    let buffer: string[] = [];
    const flush = () => {
        if (buffer.some(line => line.trim() !== '')) {
            out.push({ kind: 'text', lines: buffer });
        }
        buffer = [];
    };
    for (const line of lines) {
        const image = parseImageMarkdownLine(line);
        if (image) {
            flush();
            out.push({ kind: 'image', url: image.url, alt: image.alt });
        } else {
            buffer.push(line);
        }
    }
    flush();
    if (out.length === 0) {
        out.push({ kind: 'text', lines });
    }
    return out;
}
