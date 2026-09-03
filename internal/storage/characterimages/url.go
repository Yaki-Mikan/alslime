// Package characterimages はキャラクター画像の配信 URL 組み立てを担う。
//
// URL の形は画像 API（domain/characters）とキャラ一覧（storage/charfilters）の
// 双方が返すため、片方だけ変えて食い違わないようここへ集約する。
package characterimages

import (
	"net/url"

	"alslime/internal/config"
)

// IconURL はキャラクターの表情アイコン画像の配信 URL を返す。
// hash が空でなければキャッシュ破棄用のクエリ（?v=）を付ける。
func IconURL(characterDir, fileName, hash string) string {
	out := config.CharacterImagesRoute + "/" +
		url.PathEscape(characterDir) + "/" +
		url.PathEscape(config.CharacterImageDirName) + "/" +
		url.PathEscape(config.CharacterIconImageDirName) + "/" +
		url.PathEscape(fileName)
	if hash != "" {
		out += "?v=" + hash
	}
	return out
}
