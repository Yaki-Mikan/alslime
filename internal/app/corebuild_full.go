//go:build !purepublic

package app

// core 結線（fullcore。12番 6章）。
//
// 現段階（Phase C・物理分割前）は既定ビルド＝fullcore とし、`purepublic` タグで
// スタブへ切替える。リポジトリ物理分割後（公開リポジトリに corefactory が
// 存在しなくなった時点）で、公開側の既定＝スタブへタグ極性を反転する
//（本人ビルドが -tags fullcore を付ける形。6.1 の検証構成）。

import (
	"alslime/core/corefactory"
	"alslime/internal/coreapi"
)

// newCore は core 実装一式を組み立てる（fullcore 結線）。
func newCore(deps coreapi.CoreDeps) coreapi.Core {
	return corefactory.New(deps)
}
