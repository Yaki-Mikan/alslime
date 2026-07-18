package charfilters

import (
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/storage/paths"
)

const (
	charListDir = "roleplay/characters"
	filtersFile = "roleplay/global/settings/character_filters.json"
)

func newStore(t *testing.T) (*Store, string) {
	t.Helper()
	root := t.TempDir()
	real, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatalf("EvalSymlinks: %v", err)
	}
	return New(paths.NewResolver(real), charListDir, filtersFile), real
}

// makeChar はキャラディレクトリ + settings/*.md + tags.json を作る。
func makeChar(t *testing.T, root, dirName string, mdNames []string, tagsJSON string) {
	t.Helper()
	settings := filepath.Join(root, filepath.FromSlash(charListDir), dirName, "settings")
	if err := os.MkdirAll(settings, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, md := range mdNames {
		if err := os.WriteFile(filepath.Join(settings, md), []byte("# "+md), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if tagsJSON != "" {
		if err := os.WriteFile(filepath.Join(settings, "tags.json"), []byte(tagsJSON), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestListCharacters_各mdが1キャラ(t *testing.T) {
	s, root := newStore(t)
	// 1 ディレクトリに 2 md → 2 キャラ。
	makeChar(t, root, "雪", []string{"雪.md", "雪_別衣装.md"}, `{"work":"オリジナル","tags":["メスガキ","黒髪"]}`)
	// tags.json 無しのキャラ。
	makeChar(t, root, "燈", []string{"燈.md"}, "")

	chars, err := s.ListCharacters()
	if err != nil {
		t.Fatalf("ListCharacters: %v", err)
	}
	if len(chars) != 3 {
		t.Fatalf("各 md=1キャラで 3 件のはず: %#v", chars)
	}
	// 名前順ソート確認 + path 形・work/tags 確認。
	byName := map[string]Character{}
	for _, c := range chars {
		byName[c.Name] = c
	}
	yuki := byName["雪"]
	if yuki.DirName != "雪" || yuki.Path != "roleplay/characters/雪/settings/雪.md" {
		t.Fatalf("path 想定外: %#v", yuki)
	}
	if yuki.Work == nil || *yuki.Work != "オリジナル" || len(yuki.Tags) != 2 {
		t.Fatalf("work/tags 想定外: %#v", yuki)
	}
	// tags.json 無しは work=nil / tags=[]。
	akari := byName["燈"]
	if akari.Work != nil || len(akari.Tags) != 0 {
		t.Fatalf("tags.json 無しは work=nil/tags=[]: %#v", akari)
	}
}

func TestListCharacters_未作成は空(t *testing.T) {
	s, _ := newStore(t)
	chars, err := s.ListCharacters()
	if err != nil {
		t.Fatalf("ListCharacters: %v", err)
	}
	if len(chars) != 0 {
		t.Fatalf("未作成は空: %#v", chars)
	}
}

func TestLoadFilters_無ければ空(t *testing.T) {
	s, _ := newStore(t)
	f, err := s.LoadFilters()
	if err != nil {
		t.Fatalf("LoadFilters: %v", err)
	}
	if len(f.Works) != 0 || len(f.Tags) != 0 {
		t.Fatalf("無ければ空: %#v", f)
	}
}

func TestRebuild_集約とマスタ書き出し(t *testing.T) {
	s, root := newStore(t)
	makeChar(t, root, "雪", []string{"雪.md"}, `{"work":"オリジナル","tags":["メスガキ","黒髪"]}`)
	makeChar(t, root, "明乃", []string{"明乃.md"}, `{"work":"オリジナル","tags":["ツインテール"]}`)
	makeChar(t, root, "無タグ", []string{"無タグ.md"}, "")

	filters, stats, err := s.Rebuild()
	if err != nil {
		t.Fatalf("Rebuild: %v", err)
	}
	// works は重複排除（オリジナル 1 件）、tags は 3 種、ソート済み。
	if len(filters.Works) != 1 || filters.Works[0] != "オリジナル" {
		t.Fatalf("works 集約想定外: %#v", filters.Works)
	}
	if len(filters.Tags) != 3 {
		t.Fatalf("tags 集約想定外: %#v", filters.Tags)
	}
	if stats.TotalCharacters != 3 || stats.WithTags != 2 || stats.WithoutTags != 1 {
		t.Fatalf("stats 想定外: %#v", stats)
	}
	// マスタファイルが書き出されていること。
	master := filepath.Join(root, filepath.FromSlash(filtersFile))
	if _, err := os.Stat(master); err != nil {
		t.Fatalf("マスタが書き出されていない: %v", err)
	}
	// 再読込で一致。
	loaded, err := s.LoadFilters()
	if err != nil {
		t.Fatalf("LoadFilters: %v", err)
	}
	if len(loaded.Works) != 1 || len(loaded.Tags) != 3 {
		t.Fatalf("再読込が一致しない: %#v", loaded)
	}
}
