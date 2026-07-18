// Package buildinfo は配布物のビルド情報（バージョン・ビルドモード）を管理する。
//
// 正本はビルド時の ldflags 埋め込み（交換日記 22 の決定）。
//
//	go build -ldflags "\
//	  -X alslime/internal/buildinfo.version=0.1.0 \
//	  -X alslime/internal/buildinfo.buildMode=release"
//
// 環境変数は正本にしない。環境変数で mode が変わると、配布版で利用者が
// 簡単に切り替えられてしまうため。dev 機能だけは build tag と併用する（features 側）。
//
// tier はビルド埋め込みから廃止した（Phase D・12番 3.3）。機能階層の正本は
// entitlement トークン（featuresimpl が署名検証して判定）で、ビルド差分は無い。
//
// 各層は非公開変数を直接読まず、Snapshot() を通すこと。
package buildinfo

// ビルド時に ldflags で上書きされる変数（小文字＝非公開。-X で注入する）。
// 既定値は開発時（ldflags 無しの go run / go test）に使われる。
var (
	version   = "0.0.0-dev"
	buildMode = "dev"
	commit    = ""
)

// Mode は配布ビルドの種別。
type Mode string

const (
	// ModeRelease は配布用ビルド。dev 診断などを含めない。
	ModeRelease Mode = "release"
	// ModeDev は開発用ビルド。dev 機能を有効化できる。
	ModeDev Mode = "dev"
)

// Info はビルド情報のスナップショット（読み取り専用の公開形）。
type Info struct {
	Version   string `json:"version"`
	BuildMode string `json:"buildMode"`
	Commit    string `json:"commit,omitempty"`
}

// Snapshot は現在のビルド情報を返す。
//
// 各層はこの読み取り口を通し、非公開変数を直接参照しない。
func Snapshot() Info {
	return Info{
		Version:   version,
		BuildMode: buildMode,
		Commit:    commit,
	}
}

// IsRelease は配布（release）ビルドかを返す。
//
// 既定（ldflags 無し）は dev のため false。release ビルドでのみ true になる。
func IsRelease() bool {
	return buildMode == string(ModeRelease)
}
