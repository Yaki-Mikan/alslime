package characters

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
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

func TestImageServiceUpload_申告MIMEでなく実データ形式を使う(t *testing.T) {
	root := t.TempDir()
	svc := NewImageService(paths.NewResolver(root))
	jpegData := testJPEGBytes(t)

	upload, err := svc.Upload("Alice", "happy", "image/png", bytes.NewReader(jpegData))
	if err != nil {
		t.Fatalf("Upload failed: %v", err)
	}
	if upload.OriginalImagePath != "originals/happy.jpg" {
		t.Fatalf("実データは JPEG なので .jpg で保存されるべき: %#v", upload)
	}

	result, err := svc.Crop("Alice", "happy", CropData{
		Zoom:              1,
		CroppedAreaPixels: CropAreaPixels{X: 0, Y: 0, Width: 2, Height: 2},
	})
	if err != nil {
		t.Fatalf("JPEG の切り抜きに失敗: %v", err)
	}
	if result.IconPath != "icons/happy.png" || result.FileHash == "" {
		t.Fatalf("unexpected crop result: %#v", result)
	}
}

func TestImageServiceCrop_WebPを切り抜ける(t *testing.T) {
	root := t.TempDir()
	svc := NewImageService(paths.NewResolver(root))
	webpData, err := base64.StdEncoding.DecodeString("UklGRh4AAABXRUJQVlA4TBEAAAAvA8AAAAdQqOIVpf+BiOh/AAA=")
	if err != nil {
		t.Fatalf("WebP fixture decode failed: %v", err)
	}

	upload, err := svc.Upload("Alice", "happy", "image/webp", bytes.NewReader(webpData))
	if err != nil {
		t.Fatalf("WebP Upload failed: %v", err)
	}
	if upload.OriginalImagePath != "originals/happy.webp" {
		t.Fatalf("WebP の保存先が不正: %#v", upload)
	}
	if _, err := svc.Crop("Alice", "happy", CropData{
		Zoom:              1,
		CroppedAreaPixels: CropAreaPixels{X: 0, Y: 0, Width: 2, Height: 2},
	}); err != nil {
		t.Fatalf("WebP の切り抜きに失敗: %v", err)
	}
}

func TestDecodeCropSource_拡張子でなく実データを判定する(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mislabeled.png")
	if err := os.WriteFile(path, testJPEGBytes(t), config.FilePerm); err != nil {
		t.Fatalf("fixture write failed: %v", err)
	}
	_, format, err := decodeCropSource(path)
	if err != nil {
		t.Fatalf("JPEG 実データの判定に失敗: %v", err)
	}
	if format != "jpeg" {
		t.Fatalf("実データは jpeg と判定されるべき: %q", format)
	}
}

func testJPEGBytes(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			img.Set(x, y, color.RGBA{R: uint8(50 * x), G: uint8(50 * y), B: 120, A: 255})
		}
	}
	buf := &bytes.Buffer{}
	if err := jpeg.Encode(buf, img, nil); err != nil {
		t.Fatalf("JPEG encode failed: %v", err)
	}
	return buf.Bytes()
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
