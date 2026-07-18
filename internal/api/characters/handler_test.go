package characters

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/config"
	charsvc "alslime/internal/domain/characters"
	"alslime/internal/storage/paths"
)

func TestCharacterImageRoutes(t *testing.T) {
	root := t.TempDir()
	writeTestEmotionDefinitions(t, root)
	svc := charsvc.NewImageService(paths.NewResolver(root))
	mux := http.NewServeMux()
	RegisterImages(mux, svc)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	if err := writer.WriteField("emotion", "喜び"); err != nil {
		t.Fatalf("WriteField failed: %v", err)
	}
	part, err := writer.CreateFormFile("image", "face.png")
	if err != nil {
		t.Fatalf("CreateFormFile failed: %v", err)
	}
	if _, err := part.Write(testUploadPNGBytes()); err != nil {
		t.Fatalf("part.Write failed: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("writer.Close failed: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/characters/Alice/images/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("upload status=%d body=%s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/characters/Alice/images", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("images status=%d body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Success bool `json:"success"`
		Data    struct {
			Images map[string]struct {
				HasOriginal  bool    `json:"hasOriginal"`
				OriginalPath *string `json:"originalPath"`
			} `json:"images"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if !got.Success || !got.Data.Images["喜び"].HasOriginal {
		t.Fatalf("unexpected images response: %#v", got)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/characters/Alice/images/crop", bytes.NewBufferString(`{
		"emotion":"喜び",
		"cropData":{
			"x":0,
			"y":0,
			"zoom":1,
			"croppedAreaPixels":{"x":0,"y":0,"width":2,"height":2}
		}
	}`))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("crop status=%d body=%s", rec.Code, rec.Body.String())
	}
	var cropGot struct {
		Success bool `json:"success"`
		Data    struct {
			IconPath string `json:"iconPath"`
			FileHash string `json:"fileHash"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&cropGot); err != nil {
		t.Fatalf("decode crop failed: %v", err)
	}
	if !cropGot.Success || cropGot.Data.IconPath != "icons/喜び.png" || cropGot.Data.FileHash == "" {
		t.Fatalf("unexpected crop response: %#v", cropGot)
	}
	iconPath := filepath.Join(root, "roleplay", "characters", "Alice", "images", "icons", "喜び.png")
	if _, err := os.Stat(iconPath); err != nil {
		t.Fatalf("icon not written: %v", err)
	}
}

func writeTestEmotionDefinitions(t *testing.T, root string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(config.EmotionDefinitionsFile))
	if err := os.MkdirAll(filepath.Dir(path), config.DirPerm); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}
	data := []byte(`{"emotions":[{"name":"喜び"}]}`)
	if err := os.WriteFile(path, data, config.FilePerm); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}
}

func testUploadPNGBytes() []byte {
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			img.Set(x, y, color.RGBA{R: uint8(50 * x), G: uint8(50 * y), B: 120, A: 255})
		}
	}
	buf := &bytes.Buffer{}
	if err := png.Encode(buf, img); err != nil {
		panic(err)
	}
	return buf.Bytes()
}
