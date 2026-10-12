/**
 * 設定ファイルの変更通知。
 *
 * 設定ファイルの保存・削除・取り込みや、AI での作成・直しのあとに、一覧を持っている画面
 * （会話の準備・調整欄、素材づくりのキャラ・設定ファイル・声のタブ）へ知らせるアプリ内イベント。
 * 受信側は一覧を読み直す。ページを読み直さなくても、作ったファイルがすぐ一覧・検索に出るようにするため。
 */

export const CONFIG_FILES_CHANGED_EVENT = 'alslime:config-files-changed';

/** 設定ファイルの変更を全画面へ通知する。 */
export function notifyConfigFilesChanged(): void {
    window.dispatchEvent(new Event(CONFIG_FILES_CHANGED_EVENT));
}

/** 設定ファイルの変更を受け取る。戻り値を呼ぶと受け取りをやめる。 */
export function subscribeConfigFilesChanged(fn: () => void): () => void {
    window.addEventListener(CONFIG_FILES_CHANGED_EVENT, fn);
    return () => window.removeEventListener(CONFIG_FILES_CHANGED_EVENT, fn);
}
