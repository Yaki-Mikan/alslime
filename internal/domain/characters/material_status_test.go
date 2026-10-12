package characters

import (
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/config"
	"alslime/internal/storage/paths"
)

func writeImageFixture(t *testing.T, root, character, dir, name string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(config.CharacterListDir), character, config.CharacterImageDirName, dir, name)
	if err := os.MkdirAll(filepath.Dir(path), config.DirPerm); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}
	if err := os.WriteFile(path, []byte("x"), config.FilePerm); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}
}

func TestImageStatus_有効な表情だけを数え拡張子違いは1つにまとめる(t *testing.T) {
	root := t.TempDir()
	svc := NewImageService(paths.NewResolver(root))
	writeJSONFixture(t, root, config.EmotionCatalogFile, EmotionCatalogData{
		Version: emotionCatalogVersion,
		Emotions: []EmotionCatalogEntry{
			{Name: "default", Label: "default", Description: defaultEmotionDescription, Enabled: true},
			{Name: "happy", Label: "嬉しい", Description: "嬉しい時の表情", Enabled: true},
			{Name: "sad", Label: "悲しい", Description: "悲しい時の表情", Enabled: false},
		},
	})
	// Alice：default は拡張子違いで2つ、happy はアイコンだけ、sad は無効なので数えない
	writeImageFixture(t, root, "Alice", config.CharacterOriginalImageDirName, "default.png")
	writeImageFixture(t, root, "Alice", config.CharacterOriginalImageDirName, "default.webp")
	writeImageFixture(t, root, "Alice", config.CharacterOriginalImageDirName, "sad.png")
	writeImageFixture(t, root, "Alice", config.CharacterOriginalImageDirName, "memo.txt")
	writeImageFixture(t, root, "Alice", config.CharacterIconImageDirName, "default.png")
	writeImageFixture(t, root, "Alice", config.CharacterIconImageDirName, "HAPPY.png")
	// Bob：画像のフォルダが無い
	if err := os.MkdirAll(filepath.Join(root, filepath.FromSlash(config.CharacterListDir), "Bob"), config.DirPerm); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}

	status, err := svc.ImageStatus()
	if err != nil {
		t.Fatalf("ImageStatus failed: %v", err)
	}
	if status.EnabledEmotions != 2 {
		t.Fatalf("有効な表情は2つのはず: %d", status.EnabledEmotions)
	}
	want := []CharacterImageStatus{
		{DirName: "Alice", Originals: 1, Icons: 2},
		{DirName: "Bob", Originals: 0, Icons: 0},
	}
	if len(status.Characters) != len(want) {
		t.Fatalf("キャラの数が違う: %#v", status.Characters)
	}
	for i := range want {
		if status.Characters[i] != want[i] {
			t.Fatalf("%d件目が違う: got %#v want %#v", i, status.Characters[i], want[i])
		}
	}
}

func TestImageStatus_キャラのフォルダが無ければ空で返す(t *testing.T) {
	svc := NewImageService(paths.NewResolver(t.TempDir()))
	status, err := svc.ImageStatus()
	if err != nil {
		t.Fatalf("ImageStatus failed: %v", err)
	}
	if len(status.Characters) != 0 {
		t.Fatalf("キャラは0件のはず: %#v", status.Characters)
	}
}
