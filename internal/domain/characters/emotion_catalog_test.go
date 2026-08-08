package characters

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/config"
	"alslime/internal/storage/paths"
)

func writeJSONFixture(t *testing.T, root, rel string, value any) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), config.DirPerm); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	if err := os.WriteFile(path, data, config.FilePerm); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}
}

func readJSONFixture(t *testing.T, root, rel string, out any) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	if err := json.Unmarshal(data, out); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}
}

func TestEmotionCatalog_管理用が無ければ送信用から生成する(t *testing.T) {
	root := t.TempDir()
	svc := NewImageService(paths.NewResolver(root))
	writeJSONFixture(t, root, config.EmotionDefinitionsFile, map[string]any{
		"emotions": []map[string]string{
			{"name": "default", "description": "デフォルトの表情"},
			{"name": "happy", "description": "嬉しい時の表情"},
		},
	})

	catalog, err := svc.EmotionCatalog()
	if err != nil {
		t.Fatalf("EmotionCatalog failed: %v", err)
	}
	if len(catalog.Emotions) != 2 {
		t.Fatalf("unexpected emotions: %#v", catalog.Emotions)
	}
	first := catalog.Emotions[0]
	if first.Name != defaultEmotionName || first.Label != defaultEmotionName ||
		first.Description != defaultEmotionDescription || !first.Enabled {
		t.Fatalf("default は先頭で規定値へ正規化されるべき: %#v", first)
	}
	second := catalog.Emotions[1]
	if second.Name != "happy" || second.Label != "嬉しい時の表情" ||
		second.Description != "嬉しい時の表情" || !second.Enabled {
		t.Fatalf("label は description を初期値とし enabled になるべき: %#v", second)
	}
}

func TestEmotionCatalog_送信用にのみ存在する表情を取り込む(t *testing.T) {
	root := t.TempDir()
	svc := NewImageService(paths.NewResolver(root))
	writeJSONFixture(t, root, config.EmotionCatalogFile, EmotionCatalogData{
		Version: emotionCatalogVersion,
		Emotions: []EmotionCatalogEntry{
			{Name: "default", Label: "default", Description: defaultEmotionDescription, Enabled: true},
			{Name: "sad", Label: "悲しい", Description: "悲しい時の表情", Enabled: false},
		},
	})
	writeJSONFixture(t, root, config.EmotionDefinitionsFile, map[string]any{
		"emotions": []map[string]string{
			{"name": "happy", "description": "嬉しい時の表情"},
		},
	})

	catalog, err := svc.EmotionCatalog()
	if err != nil {
		t.Fatalf("EmotionCatalog failed: %v", err)
	}
	byName := map[string]EmotionCatalogEntry{}
	for _, entry := range catalog.Emotions {
		byName[entry.Name] = entry
	}
	if entry, ok := byName["happy"]; !ok || !entry.Enabled {
		t.Fatalf("送信用にのみ存在する happy は enabled で取り込まれるべき: %#v", catalog.Emotions)
	}
	if entry, ok := byName["sad"]; !ok || entry.Enabled {
		t.Fatalf("管理用の無効状態は維持されるべき: %#v", catalog.Emotions)
	}
}

func TestSaveEmotionCatalog_無効な表情は送信用へ書き出さない(t *testing.T) {
	root := t.TempDir()
	svc := NewImageService(paths.NewResolver(root))

	saved, err := svc.SaveEmotionCatalog(EmotionCatalogData{
		Emotions: []EmotionCatalogEntry{
			{Name: "default", Enabled: true},
			{Name: "happy", Label: "嬉しい", Description: "嬉しい時の表情", Enabled: true},
			{Name: "sad", Label: "悲しい", Description: "悲しい時の表情", Enabled: false},
			{Name: "  ", Enabled: true},
		},
	})
	if err != nil {
		t.Fatalf("SaveEmotionCatalog failed: %v", err)
	}
	if len(saved.Emotions) != 3 {
		t.Fatalf("空の表情名は除外されるべき: %#v", saved.Emotions)
	}
	if saved.LastModified == "" || saved.Version != emotionCatalogVersion {
		t.Fatalf("version / lastModified が設定されるべき: %#v", saved)
	}

	var definitions emotionDefinitionDetailFile
	readJSONFixture(t, root, config.EmotionDefinitionsFile, &definitions)
	if len(definitions.Emotions) != 2 {
		t.Fatalf("送信用は有効な表情のみとなるべき: %#v", definitions.Emotions)
	}
	for _, def := range definitions.Emotions {
		if def.Name == "sad" {
			t.Fatalf("無効な sad が送信用へ書き出されている: %#v", definitions.Emotions)
		}
	}

	var catalog EmotionCatalogData
	readJSONFixture(t, root, config.EmotionCatalogFile, &catalog)
	if len(catalog.Emotions) != 3 {
		t.Fatalf("管理用は無効含む全表情を持つべき: %#v", catalog.Emotions)
	}
}

func TestSaveEmotionCatalog_defaultの欠落と無効化を拒否(t *testing.T) {
	svc := NewImageService(paths.NewResolver(t.TempDir()))

	if _, err := svc.SaveEmotionCatalog(EmotionCatalogData{
		Emotions: []EmotionCatalogEntry{{Name: "happy", Enabled: true}},
	}); !errors.Is(err, ErrEmotionDefaultRequired) {
		t.Fatalf("default 欠落は拒否されるべき: %v", err)
	}

	if _, err := svc.SaveEmotionCatalog(EmotionCatalogData{
		Emotions: []EmotionCatalogEntry{
			{Name: "default", Enabled: false},
			{Name: "happy", Enabled: true},
		},
	}); !errors.Is(err, ErrEmotionDefaultRequired) {
		t.Fatalf("default 無効化は拒否されるべき: %v", err)
	}
}

func TestSaveEmotionCatalog_表情名の検証(t *testing.T) {
	svc := NewImageService(paths.NewResolver(t.TempDir()))

	if _, err := svc.SaveEmotionCatalog(EmotionCatalogData{
		Emotions: []EmotionCatalogEntry{
			{Name: "default", Enabled: true},
			{Name: "happy", Enabled: true},
			{Name: "Happy", Enabled: true},
		},
	}); !errors.Is(err, ErrEmotionNameDuplicate) {
		t.Fatalf("大小違いの重複は拒否されるべき: %v", err)
	}

	for _, name := range []string{"ha/ppy", "ha:ppy", "happy.", "ha..ppy", `ha"ppy`} {
		if _, err := svc.SaveEmotionCatalog(EmotionCatalogData{
			Emotions: []EmotionCatalogEntry{
				{Name: "default", Enabled: true},
				{Name: name, Enabled: true},
			},
		}); !errors.Is(err, ErrEmotionNameInvalid) {
			t.Fatalf("%q は拒否されるべき: %v", name, err)
		}
	}
}

func TestSaveEmotionCatalog_default行は規定値へ正規化する(t *testing.T) {
	root := t.TempDir()
	svc := NewImageService(paths.NewResolver(root))

	saved, err := svc.SaveEmotionCatalog(EmotionCatalogData{
		Emotions: []EmotionCatalogEntry{
			{Name: "Default", Label: "勝手な表示名", Description: "勝手な説明", Enabled: true},
		},
	})
	if err != nil {
		t.Fatalf("SaveEmotionCatalog failed: %v", err)
	}
	first := saved.Emotions[0]
	if first.Name != defaultEmotionName || first.Label != defaultEmotionName ||
		first.Description != defaultEmotionDescription {
		t.Fatalf("default は全項目規定値となるべき: %#v", first)
	}
}

func TestImages_無効な表情も応答に含む(t *testing.T) {
	root := t.TempDir()
	svc := NewImageService(paths.NewResolver(root))
	writeJSONFixture(t, root, config.EmotionCatalogFile, EmotionCatalogData{
		Version: emotionCatalogVersion,
		Emotions: []EmotionCatalogEntry{
			{Name: "default", Label: "default", Description: defaultEmotionDescription, Enabled: true},
			{Name: "happy", Label: "嬉しい", Description: "嬉しい時の表情", Enabled: false},
		},
	})
	if _, err := svc.Upload("Alice", "happy", "image/png", bytes.NewReader(testPNGBytes())); err != nil {
		t.Fatalf("Upload failed: %v", err)
	}

	images, err := svc.Images("Alice")
	if err != nil {
		t.Fatalf("Images failed: %v", err)
	}
	info, ok := images.Images["happy"]
	if !ok || !info.HasOriginal {
		t.Fatalf("無効な表情の画像情報も応答へ含まれるべき: %#v", images.Images)
	}
}

func TestPruneOrphanImages_定義に無い表情だけを削除する(t *testing.T) {
	root := t.TempDir()
	svc := NewImageService(paths.NewResolver(root))
	writeJSONFixture(t, root, config.EmotionCatalogFile, EmotionCatalogData{
		Version: emotionCatalogVersion,
		Emotions: []EmotionCatalogEntry{
			{Name: "default", Label: "default", Description: defaultEmotionDescription, Enabled: true},
			{Name: "happy", Label: "嬉しい", Description: "嬉しい時の表情", Enabled: false},
		},
	})
	if _, err := svc.Upload("Alice", "happy", "image/png", bytes.NewReader(testPNGBytes())); err != nil {
		t.Fatalf("Upload happy failed: %v", err)
	}
	if _, err := svc.Upload("Alice", "old", "image/png", bytes.NewReader(testPNGBytes())); err != nil {
		t.Fatalf("Upload old failed: %v", err)
	}
	if err := svc.saveImageHash("Alice", "happy", "hash-happy"); err != nil {
		t.Fatalf("saveImageHash happy failed: %v", err)
	}
	if err := svc.saveImageHash("Alice", "old", "hash-old"); err != nil {
		t.Fatalf("saveImageHash old failed: %v", err)
	}
	if err := svc.saveCropData("Alice", "old", CropData{Zoom: 1}); err != nil {
		t.Fatalf("saveCropData old failed: %v", err)
	}

	result, err := svc.PruneOrphanImages()
	if err != nil {
		t.Fatalf("PruneOrphanImages failed: %v", err)
	}
	if result.ScannedCharacters != 1 || result.AffectedCharacters != 1 {
		t.Fatalf("unexpected counts: %#v", result)
	}
	if result.DeletedFiles != 1 || result.DeletedEntries != 2 {
		t.Fatalf("old の画像 1 件とハッシュ・切り抜き 2 件が消えるべき: %#v", result)
	}

	images, err := svc.Images("Alice")
	if err != nil {
		t.Fatalf("Images failed: %v", err)
	}
	if !images.Images["happy"].HasOriginal {
		t.Fatalf("定義にある無効表情 happy の画像は残るべき: %#v", images.Images)
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(
		config.CharacterListDir+"/Alice/images/originals/old.png"))); !os.IsNotExist(err) {
		t.Fatalf("定義に無い old の画像は消えるべき: %v", err)
	}
	hashes := svc.loadImageHashes("Alice")
	if _, ok := hashes["old"]; ok {
		t.Fatalf("old のハッシュは消えるべき: %#v", hashes)
	}
	if _, ok := hashes["happy"]; !ok {
		t.Fatalf("happy のハッシュは残るべき: %#v", hashes)
	}
}

func TestPruneOrphanImages_大小違いのみのファイルは残す(t *testing.T) {
	root := t.TempDir()
	svc := NewImageService(paths.NewResolver(root))
	writeJSONFixture(t, root, config.EmotionCatalogFile, EmotionCatalogData{
		Version: emotionCatalogVersion,
		Emotions: []EmotionCatalogEntry{
			{Name: "default", Label: "default", Description: defaultEmotionDescription, Enabled: true},
			{Name: "Happy", Label: "嬉しい", Description: "嬉しい時の表情", Enabled: true},
		},
	})
	if _, err := svc.Upload("Alice", "happy", "image/png", bytes.NewReader(testPNGBytes())); err != nil {
		t.Fatalf("Upload failed: %v", err)
	}

	result, err := svc.PruneOrphanImages()
	if err != nil {
		t.Fatalf("PruneOrphanImages failed: %v", err)
	}
	if result.DeletedFiles != 0 {
		t.Fatalf("大小違いのみのファイルは削除されないべき: %#v", result)
	}
}

func TestPruneOrphanImages_定義が無ければ中断(t *testing.T) {
	svc := NewImageService(paths.NewResolver(t.TempDir()))
	if _, err := svc.PruneOrphanImages(); !errors.Is(err, ErrEmotionCatalogMissing) {
		t.Fatalf("定義ファイルが無い状態の一括削除は中断されるべき: %v", err)
	}
}
