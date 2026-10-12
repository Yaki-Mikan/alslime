// クラス名を空値を除いてつなぐ。
export const cn = (...parts: Array<string | false | null | undefined>): string =>
    parts.filter(Boolean).join(' ');
