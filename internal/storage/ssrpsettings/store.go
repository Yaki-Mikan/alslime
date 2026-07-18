// Package ssrpsettings は SSRP 関連の単一ファイル設定の保存先を担う。
//
// 対象（いずれも WORKSPACE_ROOT 配下で保存先確定済み）:
//   - 関係性オプション   relation_options.json     （読み取り。無ければ既定配列）
//   - 置換設定           replacement_config.json    （読み書き）
//   - 言語設定           Language/<lang>.json       （読み取り。無ければ空）
//   - デフォルト設定      デフォルト設定.json         （読み書き・全置換）
//
// プリセットのようなディレクトリ＋名前指定ではなく、固定パスの単一ファイル群を扱う。
// 読み書きは jsonstore を用い、symlink 境界確認は paths.Resolver に委ねる。
package ssrpsettings

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"sync"
	"time"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
)

// cachedRaw は mtime 検証キャッシュの1エントリ（パース前の生JSON）。
type cachedRaw struct {
	modTime time.Time
	size    int64
	raw     []byte
}

// Store は SSRP 単一ファイル設定の読み書きを担う。
//
// 置換設定・言語設定は 1 回のチャット送信でエントリ数・パラメータ要素数ぶん
// 繰り返し読まれるため、現行 Node 版 readFileCached と同じく mtime 検証付きの
// キャッシュを持つ（ファイルが変わればキャッシュは自動で無効化される）。
// キャッシュは生JSONバイト列で持ち、返却時に毎回 Unmarshal するため
// 呼び出し側がマップを変更しても共有状態は汚染されない。
type Store struct {
	resolver *paths.Resolver
	mu       sync.Mutex
	cache    map[string]cachedRaw
}

// New は Store を生成する。
func New(resolver *paths.Resolver) *Store {
	return &Store{resolver: resolver, cache: map[string]cachedRaw{}}
}

// loadJSONOrDefault は logical が指すファイルを v へ読み込む。
// 未存在なら何もせず false を返す（呼び出し側で既定値を使う）。
func (s *Store) loadJSONOrDefault(logical string, v any) (found bool, err error) {
	lexical, err := s.resolver.ResolveLexical(logical)
	if err != nil {
		return false, err
	}
	if _, statErr := os.Lstat(lexical); errors.Is(statErr, fs.ErrNotExist) {
		return false, nil
	}
	// mtime+size が前回読み込み時と一致すればファイルI/Oを省略する。
	// symlink の場合も実体の変更を見るため os.Stat（実体側）で検証する。
	if info, statErr := os.Stat(lexical); statErr == nil {
		s.mu.Lock()
		entry, ok := s.cache[logical]
		s.mu.Unlock()
		if ok && entry.modTime.Equal(info.ModTime()) && entry.size == info.Size() {
			if err := json.Unmarshal(entry.raw, v); err == nil {
				return true, nil
			}
			// キャッシュ破損時は通常経路へフォールバック
		}
	}
	path, err := s.resolver.ResolveExisting(logical)
	if err != nil {
		return false, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return false, nil
		}
		return false, err
	}
	if err := json.Unmarshal(raw, v); err != nil {
		return false, err
	}
	if info, statErr := os.Stat(lexical); statErr == nil {
		s.mu.Lock()
		s.cache[logical] = cachedRaw{modTime: info.ModTime(), size: info.Size(), raw: raw}
		s.mu.Unlock()
	}
	return true, nil
}

// saveJSON は v を logical が指すファイルへ保存する。
// 親作成＋実体境界確認は resolver の ResolveForCreateMkdirAll に集約する。
func (s *Store) saveJSON(logical string, v any) error {
	path, err := s.resolver.ResolveForCreateMkdirAll(logical, config.DirPerm)
	if err != nil {
		return err
	}
	return jsonstore.WriteJSON(path, v)
}

// LoadRelationships は関係性オプションを返す。未存在なら既定配列。
func (s *Store) LoadRelationships() ([]any, error) {
	var out []any
	found, err := s.loadJSONOrDefault(config.RelationOptionsFile, &out)
	if err != nil {
		return nil, err
	}
	if !found {
		return defaultRelationships(), nil
	}
	return out, nil
}

// LoadReplacementConfig は置換設定を返す。未存在なら既定値。
func (s *Store) LoadReplacementConfig() (map[string]any, error) {
	var out map[string]any
	found, err := s.loadJSONOrDefault(config.ReplacementConfigFile, &out)
	if err != nil {
		return nil, err
	}
	if !found || out == nil {
		return defaultReplacementConfig(), nil
	}
	return out, nil
}

// SaveReplacementConfig は置換設定を保存する（全置換）。
func (s *Store) SaveReplacementConfig(cfg map[string]any) error {
	return s.saveJSON(config.ReplacementConfigFile, cfg)
}

// LoadLanguage は lang の言語設定を返す。未存在なら空マップ。
// lang はファイル名の一部になるため、呼び出し側で検証済みであること。
func (s *Store) LoadLanguage(lang string) (map[string]any, error) {
	logical := config.LanguageDir + "/" + lang + ".json"
	var out map[string]any
	found, err := s.loadJSONOrDefault(logical, &out)
	if err != nil {
		return nil, err
	}
	if !found || out == nil {
		return map[string]any{}, nil
	}
	return out, nil
}

// LoadDefaultSettings はデフォルト設定（SSRPデフォルト）を返す。未存在なら空マップ。
func (s *Store) LoadDefaultSettings() (map[string]any, error) {
	var out map[string]any
	found, err := s.loadJSONOrDefault(config.GlobalSettingsFile, &out)
	if err != nil {
		return nil, err
	}
	if !found || out == nil {
		return map[string]any{}, nil
	}
	return out, nil
}

// SaveDefaultSettings はデフォルト設定を保存する（全置換）。
//
// /api/settings/global（マージ）とは異なり、現行 /api/settings/default は
// 受け取った内容で全置換する。意味が違うため共通化せず別メソッドにする。
func (s *Store) SaveDefaultSettings(settings map[string]any) error {
	return s.saveJSON(config.GlobalSettingsFile, settings)
}
