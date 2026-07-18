// Package globalsettings は グローバル設定のユースケースを担う service 層。
//
// 現行 Node 版 /api/settings/global のうち、永続化（取得・部分更新）を移植する。
//
// 注意（今回の移植方針）:
// 現行は POST 時に antigravityDirectConnection / antigravityStreamOutput を読んで
// Antigravity エージェントのモードをランタイム切替する副作用を持つ。
// Go版では Antigravity エージェント実装が未着手のため、この副作用は「保留」する。
// 値はファイルへ永続化されるので、Antigravity 移植時にその値を読んで反映する分担とする。
package globalsettings

import "alslime/internal/storage/globalsettings"

// Service はグローバル設定のユースケースを提供する。
type Service struct {
	store *globalsettings.Store
}

// New は Service を生成する。
func New(store *globalsettings.Store) *Service {
	return &Service{store: store}
}

// Get は現在のグローバル設定を返す。未作成なら空マップ。
func (s *Service) Get() (map[string]any, error) {
	return s.store.Load()
}

// Update は patch を部分マージして保存し、保存後の全体を返す。
//
// Antigravity モード切替の副作用は本移植段階では持たない（パッケージ doc 参照）。
// 値の永続化のみ行う。
func (s *Service) Update(patch map[string]any) (map[string]any, error) {
	return s.store.Merge(patch)
}
