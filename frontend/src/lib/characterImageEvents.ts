/**
 * キャラクター画像（表情アイコン）の変更通知。
 *
 * 設定画面（キャラクター画像管理・表情種別管理）での差し替えを、
 * 開いているチャット画面へページ再読込なしで反映するためのアプリ内イベント。
 * 受信側はアイコンURL一覧を再取得する（iconUrlはバックエンドがハッシュ付きで
 * 返すため、再取得だけでブラウザキャッシュも更新される）。
 */

export const CHARACTER_IMAGES_UPDATED_EVENT = 'alslime:character-images-updated';

/** キャラクター画像の変更を全画面へ通知する。 */
export function notifyCharacterImagesUpdated(): void {
    window.dispatchEvent(new Event(CHARACTER_IMAGES_UPDATED_EVENT));
}
