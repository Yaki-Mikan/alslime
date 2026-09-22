// Package tempcharacters は、セッションの会話設定の中だけに設定本文を持つ
// 「一時キャラクター」の型と操作を提供する。
//
// 一時キャラクターは実ファイルを持たず、会話設定の characters 配列には
// 登録済みキャラクターと同じ形式の仮想パス
// （roleplay/temp_characters/<id>/settings/<名前>.md）で入る。
// 設定本文・固有 ID・元セッション等は同じ会話設定の tempCharacters
// （仮想パスをキーにした map）に持つ。
package tempcharacters

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"alslime/internal/config"
)

// IDPrefix は一時キャラ ID の接頭辞。
const IDPrefix = "tmp_"

// SSRPKey は会話設定内で一時キャラクターの map を持つキー。
const SSRPKey = "tempCharacters"

// TempCharacter は一時キャラクター 1 件。
type TempCharacter struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Content         string `json:"content"`
	CreatedAt       string `json:"createdAt"`
	SourceSessionID string `json:"sourceSessionId"`
	TemplateName    string `json:"templateName,omitempty"`
	RegisteredPath  string `json:"registeredPath,omitempty"`
}

// IsTempCharacterPath は会話設定の characters 要素が一時キャラクターの仮想パスかを返す。
func IsTempCharacterPath(p string) bool {
	p = strings.TrimSpace(strings.ReplaceAll(p, `\`, "/"))
	return strings.HasPrefix(p, config.TempCharacterListDir+"/")
}

// NewID は "tmp_"＋16 進 12 文字の ID を生成する。
func NewID() string {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%s%012x", IDPrefix, uint64(time.Now().UnixNano())&0xffffffffffff)
	}
	return IDPrefix + hex.EncodeToString(buf)
}

// VirtualPath は ID とファイル名（拡張子なし）から仮想パスを組み立てる。
func VirtualPath(id, fileName string) string {
	return config.TempCharacterListDir + "/" + id + "/" + config.CharacterSettingsDirName + "/" + fileName + ".md"
}

// NowISO は作成日時・登録日時に使う現在時刻の文字列。
func NowISO() string {
	return time.Now().Format(time.RFC3339)
}
