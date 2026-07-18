//go:build purepublic

package app

// core 未結合の結線（公開リポジトリ単体ビルド相当。12番 6章）。
// go build -tags purepublic で有効。

import (
	"alslime/internal/coreapi"
	"alslime/internal/corestub"
)

// newCore は core スタブを返す（purepublic 結線）。
func newCore(_ coreapi.CoreDeps) coreapi.Core {
	return corestub.New()
}
