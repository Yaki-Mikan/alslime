package charfilters

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteTags_往復(t *testing.T) {
	s, root := newStore(t)
	makeChar(t, root, "雪", []string{"雪.md"}, "")

	work := "オリジナル"
	if err := s.WriteTags("雪", &work, []string{" メスガキ ", "", "黒髪", "メスガキ"}); err != nil {
		t.Fatalf("WriteTags: %v", err)
	}
	chars, err := s.ListCharacters()
	if err != nil {
		t.Fatalf("ListCharacters: %v", err)
	}
	if len(chars) != 1 || chars[0].Work == nil || *chars[0].Work != work {
		t.Fatalf("work mismatch: %+v", chars)
	}
	if strings.Join(chars[0].Tags, ",") != "メスガキ,黒髪" {
		t.Fatalf("tags mismatch: %v", chars[0].Tags)
	}

	// work 空は work キーを書かない → 読み手で nil。
	empty := ""
	if err := s.WriteTags("雪", &empty, []string{}); err != nil {
		t.Fatalf("WriteTags empty: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(root, "roleplay", "characters", "雪", "settings", "tags.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), `"work"`) {
		t.Fatalf("work key should be omitted: %s", raw)
	}
	chars, _ = s.ListCharacters()
	if chars[0].Work != nil || len(chars[0].Tags) != 0 {
		t.Fatalf("expected nil work and no tags: %+v", chars[0])
	}
}

func TestWriteTags_未存在と不正名(t *testing.T) {
	s, _ := newStore(t)
	if err := s.WriteTags("未保存", nil, []string{"a"}); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("missing dir should be ErrNotExist: %v", err)
	}
	for _, bad := range []string{"", "..", "a/b", `a\b`, "a..b"} {
		if err := s.WriteTags(bad, nil, nil); !errors.Is(err, ErrInvalidDirName) {
			t.Fatalf("%q should be invalid: %v", bad, err)
		}
	}
}

func TestListCharacters_iconUrl(t *testing.T) {
	s, root := newStore(t)
	makeChar(t, root, "雪", []string{"雪.md", "雪_v2.md"}, "")
	makeChar(t, root, "燈", []string{"燈.md"}, "")

	iconDir := filepath.Join(root, "roleplay", "characters", "雪", "images", "icons")
	if err := os.MkdirAll(iconDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(iconDir, "default.png"), []byte("png"), 0o644); err != nil {
		t.Fatal(err)
	}

	chars, err := s.ListCharacters()
	if err != nil {
		t.Fatalf("ListCharacters: %v", err)
	}
	byName := map[string]Character{}
	for _, c := range chars {
		byName[c.Name] = c
	}
	if byName["燈"].IconURL != nil {
		t.Fatalf("no icon should be nil: %v", *byName["燈"].IconURL)
	}
	for _, name := range []string{"雪", "雪_v2"} {
		got := byName[name].IconURL
		if got == nil || !strings.HasSuffix(*got, "/images/icons/default.png") || strings.Contains(*got, "?v=") {
			t.Fatalf("%s icon url without hash: %v", name, got)
		}
	}

	// ハッシュがあれば ?v= が付く。
	internalDir := filepath.Join(root, "roleplay", "characters", "雪", "internal")
	if err := os.MkdirAll(internalDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(internalDir, "image_hashes.json"), []byte(`{"hashes":{"default":"abc123"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	chars, _ = s.ListCharacters()
	for _, c := range chars {
		if c.DirName == "雪" && (c.IconURL == nil || !strings.HasSuffix(*c.IconURL, "?v=abc123")) {
			t.Fatalf("hash missing: %v", c.IconURL)
		}
	}
}
