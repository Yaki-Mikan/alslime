/**
 * 「プレースホルダ名: 値」形式（1行1件）のテキストを directReplacements に変換する。
 * 有効な行が1件も無ければ undefined を返す（リクエストにキー自体を載せない）。
 * プレースホルダ名の大文字化はサーバ側で行われるため、ここでは大文字小文字を問わない。
 */
export function parseDirectReplacements(text: string): Record<string, string> | undefined {
    const out: Record<string, string> = {};
    let found = false;
    for (const line of text.split('\n')) {
        const idx = line.indexOf(':');
        if (idx <= 0) continue;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (!key || !value) continue;
        out[key] = value;
        found = true;
    }
    return found ? out : undefined;
}
