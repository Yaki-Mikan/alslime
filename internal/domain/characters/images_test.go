package characters

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/config"
	"alslime/internal/storage/paths"
)

func TestImageServiceUploadListDelete(t *testing.T) {
	root := t.TempDir()
	svc := NewImageService(paths.NewResolver(root))
	writeEmotionDefinitions(t, root)

	upload, err := svc.Upload("Alice", "喜び", "image/png", bytes.NewReader(testPNGBytes()))
	if err != nil {
		t.Fatalf("Upload failed: %v", err)
	}
	if upload.CharacterName != "Alice" || upload.Emotion != "喜び" || upload.OriginalImagePath != "originals/喜び.png" {
		t.Fatalf("unexpected upload: %#v", upload)
	}

	images, err := svc.Images("Alice")
	if err != nil {
		t.Fatalf("Images failed: %v", err)
	}
	info := images.Images["喜び"]
	if !info.HasOriginal || info.OriginalPath == nil || *info.OriginalPath != "originals/喜び.png" {
		t.Fatalf("unexpected image info: %#v", info)
	}

	served, err := svc.StaticImage("Alice", "images/originals/喜び.png")
	if err != nil {
		t.Fatalf("StaticImage failed: %v", err)
	}
	if served.ContentType != "image/png" {
		t.Fatalf("unexpected content type: %#v", served)
	}

	deleted, err := svc.Delete("Alice", "喜び")
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if len(deleted.DeletedFiles) != 1 || deleted.DeletedFiles[0] != "originals/喜び.png" {
		t.Fatalf("unexpected deleted files: %#v", deleted)
	}
	images, err = svc.Images("Alice")
	if err != nil {
		t.Fatalf("Images after delete failed: %v", err)
	}
	if images.Images["喜び"].HasOriginal {
		t.Fatalf("original should be deleted: %#v", images.Images["喜び"])
	}
}

func TestImageServiceRejectsInvalidUpload(t *testing.T) {
	svc := NewImageService(paths.NewResolver(t.TempDir()))
	if _, err := svc.Upload("Alice", "喜び", "text/plain", bytes.NewReader([]byte("x"))); err == nil {
		t.Fatalf("expected unsupported content type error")
	}
}

func writeEmotionDefinitions(t *testing.T, root string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(config.EmotionDefinitionsFile))
	if err := os.MkdirAll(filepath.Dir(path), config.DirPerm); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}
	data, err := json.Marshal(map[string]any{
		"emotions": []map[string]string{
			{"name": "喜び"},
			{"name": "怒り"},
		},
	})
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	if err := os.WriteFile(path, data, config.FilePerm); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}
}

func testPNGBytes() []byte {
	return []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
		0xde,
	}
}
