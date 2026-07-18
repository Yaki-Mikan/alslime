// Package presets はディレクトリ列挙型プリセットのユースケースを担う service 層。
//
// 統一 API 契約（交換日記 08 の合意）:
//   - 一覧 GET  /api/<kind>        -> { presets: string[] }
//   - 取得 GET  /api/<kind>/:name  -> { name, data }
//   - 保存 POST /api/<kind>        body { name, data } -> { success, name }
//   - 削除 DELETE /api/<kind>/:name -> { success }
//
// 系統（SSRP_Mode / 時刻設定 / SSRP_All / SSRP_Parameter）で異なるのは
// 「保存先ディレクトリ」と「createdAt/updatedAt の付与有無」だけ。
// 前者は presetstore のベースディレクトリで吸収し、後者は本 service の
// メタ付与ポリシー（MetaPolicy）で吸収する。これにより handler 層は
// 完全に系統非依存にできる。
package presets

import (
	"time"

	"alslime/internal/storage/presetname"
	"alslime/internal/storage/presetstore"
)

// MetaPolicy は保存時の createdAt/updatedAt 付与方針。
//
// SSRP_All / SSRP_Parameter は現行踏襲でサーバー側がメタを付与・更新する。
// SSRP_Mode / 時刻設定グループは付与しない。系統ごとに本ポリシーを切り替える。
type MetaPolicy int

const (
	// MetaNone はメタを一切付与しない（SSRP_Mode / 時刻設定グループ）。
	MetaNone MetaPolicy = iota
	// MetaTimestamps は createdAt/updatedAt を付与・更新する（SSRP_All / SSRP_Parameter）。
	MetaTimestamps
)

// メタデータのキー名。現行 Node 版（createdAt/updatedAt）に揃える。
const (
	keyCreatedAt = "createdAt"
	keyUpdatedAt = "updatedAt"
)

// isoMillisUTC は現行 Node 版 new Date().toISOString() 互換の時刻形式。
// ミリ秒付き UTC（例: 2026-06-27T13:55:11.123Z）。replacement-config と同形式。
const isoMillisUTC = "2006-01-02T15:04:05.000Z07:00"

// Service は 1 系統のプリセットのユースケースを提供する。
type Service struct {
	store *presetstore.Store
	meta  MetaPolicy
	// now はテスト用に差し替え可能な時刻取得。通常は time.Now。
	now func() time.Time
}

// New は store とメタ付与方針を束ねた Service を生成する。
func New(store *presetstore.Store, meta MetaPolicy) *Service {
	return &Service{store: store, meta: meta, now: time.Now}
}

// List はプリセット名一覧（表示名）を返す。
func (s *Service) List() ([]string, error) {
	return s.store.List()
}

// Get は name のプリセット内容と正規化済み正本名を返す。
//
// 入力 name は前後空白等を含み得るため、先に正規化・検証する。
// 戻り値の data は api/presets.Service インタフェースに合わせて any。
// ディレクトリ列挙型は内部的に map だが、契約上は any として返す。
// 存在しなければ presetstore.ErrNotFound、不正名は presetname の検証エラー。
func (s *Service) Get(name string) (string, any, error) {
	normalized, err := presetname.Validate(name)
	if err != nil {
		return "", nil, err
	}
	data, err := s.store.Get(normalized)
	if err != nil {
		return "", nil, err
	}
	return normalized, data, nil
}

// Save は name のプリセットを保存し、保存に使われた正規化済みの正本名を返す。
//
// 入力 name は前後空白等を含み得るため、正規化後の名前を正本として返す
// （API契約の name は「保存された正本名」。燈レビュー指摘2）。
//
// data は api/presets.Service インタフェースに合わせて any。
// ディレクトリ列挙型はオブジェクトを期待するため、map[string]any へ変換して扱う。
// オブジェクト以外（文字列など）はメタ付与せずそのまま保存する（型の意味は系統依存）。
//
// メタ付与方針が MetaTimestamps の場合、updatedAt を常にサーバー時刻で上書きし、
// createdAt は「既存があれば維持、無ければ新規作成」とする（交換日記 08 の合意）。
// クライアントが送ってきた createdAt/updatedAt は盲信しない。
func (s *Service) Save(name string, data any) (string, error) {
	// 先に正規化・検証して正本名を確定する。以降のメタ付与・保存はこの名前で行う。
	normalized, err := presetname.Validate(name)
	if err != nil {
		return "", err
	}

	switch v := data.(type) {
	case nil:
		return s.saveMap(normalized, map[string]any{})
	case map[string]any:
		return s.saveMap(normalized, v)
	default:
		// オブジェクト以外（ディレクトリ列挙型では想定外だが防御）。
		// メタ付与は行わず、store がオブジェクトを前提とするため空マップで包んで保存する。
		// 系統別の値型を許す場合は、その系統専用 service で別途扱う。
		return s.saveMap(normalized, map[string]any{"value": v})
	}
}

// saveMap はメタ付与方針を適用したうえで map を保存し、正本名を返す。
func (s *Service) saveMap(normalized string, data map[string]any) (string, error) {
	if s.meta == MetaTimestamps {
		s.applyTimestamps(normalized, data)
	}
	if err := s.store.Save(normalized, data); err != nil {
		return "", err
	}
	return normalized, nil
}

// Delete は name のプリセットを削除する。存在しなければ presetstore.ErrNotFound。
func (s *Service) Delete(name string) error {
	return s.store.Delete(name)
}

// applyTimestamps は data へ createdAt/updatedAt を付与する。
//
// updatedAt は常に現在時刻で上書き。createdAt は既存プリセットがあればその値を
// 引き継ぎ、無ければ現在時刻を入れる。クライアント送信値は使わない。
func (s *Service) applyTimestamps(name string, data map[string]any) {
	nowStr := s.now().UTC().Format(isoMillisUTC)

	// createdAt は既存ファイルの値を優先して維持する。
	created := nowStr
	if existing, err := s.store.Get(name); err == nil {
		if c, ok := existing[keyCreatedAt].(string); ok && c != "" {
			created = c
		}
	}
	data[keyCreatedAt] = created
	data[keyUpdatedAt] = nowStr
}
