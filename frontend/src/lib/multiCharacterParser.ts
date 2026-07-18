/**
 * 複数キャラクター応答パーサー
 * 
 * AIからの応答を[TURN character="キャラ名"]...[/TURN]形式でパースし、
 * キャラクターごとに分割された配列として返却する。
 * 
 * このモジュールは独立しており、パース形式の変更が容易にできるよう設計されている。
 */

/**
 * パース結果の1ターン分を表すインターフェース
 */
export interface CharacterTurn {
    /** キャラクター名。nullの場合は従来形式（単一キャラ/不明） */
    character: string | null;
    /** キャラクターの心情。nullの場合は指定なし（defaultとして扱う） */
    emotion: string | null;
    /** シーン情報。nullの場合は指定なし */
    scene: string | null;
    /** ターンの内容（セリフ、内心、行動描写など） */
    content: string;
    /** メッセージ内でのTURNの出現順序（0始まりのインデックス） */
    index: number;
}

/**
 * [TURN character="キャラ名" emotion="心情名" scene="シーン情報"]...[/TURN]形式のタグにマッチする正規表現
 *
 * - `\[TURN\s+character="([^"]+)"` - 開始タグ（キャラ名をキャプチャ）
 * - `(?:\s+emotion="([^"]+)")?` - emotion属性（オプショナル、心情名をキャプチャ）
 * - `(?:\s+scene="([^"]+)")?` - scene属性（オプショナル、シーン情報をキャプチャ）
 * - `(?:\s+\w+="[^"]*")*` - 将来の未知の属性を許容（キャプチャしない）
 * - `\]` - 開始タグ終了
 * - `([\s\S]*?)` - コンテンツ（非貪欲マッチ）
 * - `(?:\[\/TURN\]|$)` - 終了タグ、もしくは文字列の終端（トークン上限による途切れ対応）
 */
const TURN_REGEX = /\[TURN\s+character="([^"]+)"(?:\s+emotion="([^"]+)")?(?:\s+scene="([^"]+)")?(?:\s+\w+="[^"]*")*\]([\s\S]*?)(?:\[\/TURN\]|$)/g;

/**
 * AIの応答を複数キャラクターのターンに分割する
 * 
 * @param content - AIからの応答テキスト
 * @returns キャラクターターンの配列。TURNタグが見つからない場合は
 *          従来形式として全体を1つのターン（character: null）として返す
 * 
 * @example
 * // TURNタグありの場合
 * const result = parseMultiCharacterResponse(`
 *   [TURN character="アイナ"]
 *   アイナ：「おはよう」
 *   [/TURN]
 *   [TURN character="イスミ"]
 *   イスミ：「おはよ」
 *   [/TURN]
 * `);
 * // => [
 * //   { character: "アイナ", content: "アイナ：「おはよう」", index: 0 },
 * //   { character: "イスミ", content: "イスミ：「おはよ」", index: 1 }
 * // ]
 * 
 * @example
 * // TURNタグなしの場合（従来形式）
 * const result = parseMultiCharacterResponse("普通の応答テキスト");
 * // => [{ character: null, content: "普通の応答テキスト", index: 0 }]
 */
export function parseMultiCharacterResponse(content: string): CharacterTurn[] {
    const turns: CharacterTurn[] = [];
    let turnIndex = 0;

    // 正規表現を使ってすべてのTURNタグを検索
    let match;
    // グローバル正規表現のlastIndexをリセット
    TURN_REGEX.lastIndex = 0;

    while ((match = TURN_REGEX.exec(content)) !== null) {
        const character = match[1];
        const emotion = match[2] || null; // emotion属性（オプショナル）
        const scene = match[3] || null; // scene属性（オプショナル）
        const turnContent = match[4].trim();

        // 空のコンテンツはスキップ
        if (turnContent.length > 0) {
            turns.push({
                character,
                emotion,
                scene,
                content: turnContent,
                index: turnIndex++
            });
        }
    }

    // TURNタグが見つからなかった場合は従来形式として処理
    if (turns.length === 0) {
        return [{
            character: null,
            emotion: null,
            scene: null,
            content: content,
            index: 0
        }];
    }

    return turns;
}

/**
 * 応答がマルチキャラクター形式かどうかを判定する
 * 
 * @param content - AIからの応答テキスト
 * @returns TURNタグが含まれていればtrue
 */
export function isMultiCharacterResponse(content: string): boolean {
    TURN_REGEX.lastIndex = 0;
    return TURN_REGEX.test(content);
}
