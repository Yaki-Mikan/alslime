/**
 * AI で設定を作るときのテンプレートの変更通知。
 *
 * 設定ファイルの「AI への指示」でテンプレートを保存・削除したときや既定を変えたときに、
 * テンプレートを選ぶ欄を持っている画面（素材づくりの「AI で作る」）へ知らせるアプリ内イベント。
 * 受信側はテンプレートの一覧と既定を読み直す。素材づくりは一度開くと隠すだけなので、
 * 知らせが無いとページを読み直すまで古い一覧・既定のまま残るため。
 */

export const CONFIG_GEN_TEMPLATES_CHANGED_EVENT = 'alslime:config-gen-templates-changed';

/** テンプレートの変更を全画面へ通知する。 */
export function notifyConfigGenTemplatesChanged(): void {
    window.dispatchEvent(new Event(CONFIG_GEN_TEMPLATES_CHANGED_EVENT));
}

/** テンプレートの変更を受け取る。戻り値を呼ぶと受け取りをやめる。 */
export function subscribeConfigGenTemplatesChanged(fn: () => void): () => void {
    window.addEventListener(CONFIG_GEN_TEMPLATES_CHANGED_EVENT, fn);
    return () => window.removeEventListener(CONFIG_GEN_TEMPLATES_CHANGED_EVENT, fn);
}
