package characters

import (
	"bytes"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	"image/draw"
	"image/jpeg"
	"image/png"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
)

const maxCharacterImageUploadBytes = 5 * 1024 * 1024
const cropIconSizePixels = 512

var (
	// ErrImageEmotionRequired は画像アップロード時に心情名が空の場合の利用者起因エラー。
	ErrImageEmotionRequired = errors.New("character image emotion required")
	// ErrImageFileRequired は画像アップロード時にファイル本体が空の場合の利用者起因エラー。
	ErrImageFileRequired = errors.New("character image file required")
	// ErrImageTooLarge は画像アップロードサイズが上限を超えた場合の利用者起因エラー。
	ErrImageTooLarge = errors.New("character image too large")
	// ErrUnsupportedImageType は jpg/png/webp 以外が指定された場合の利用者起因エラー。
	ErrUnsupportedImageType = errors.New("unsupported character image type")
	// ErrInvalidImagePath は静的画像パスがキャラ画像領域外へ出る場合の利用者起因エラー。
	ErrInvalidImagePath = errors.New("invalid character image path")
	// ErrInvalidName はキャラ名・心情名として使えない値を受け取った場合の利用者起因エラー。
	ErrInvalidName = errors.New("invalid character image name")
	// ErrCropDataRequired は切り抜き対象の心情名または cropData が不足した場合の利用者起因エラー。
	ErrCropDataRequired = errors.New("character image crop data required")
	// ErrSourceImageNotFound は切り抜き元の元画像が存在しない場合の利用者起因エラー。
	ErrSourceImageNotFound = errors.New("character source image not found")
	// ErrUnsupportedCropImageType は Go 版 crop がまだ扱えない元画像形式の場合の利用者起因エラー。
	ErrUnsupportedCropImageType = errors.New("unsupported character crop image type")
	// ErrInvalidCropData は croppedAreaPixels が画像範囲として不正な場合の利用者起因エラー。
	ErrInvalidCropData = errors.New("invalid character crop data")
)

type ImageService struct {
	resolver *paths.Resolver
	// metaMu は image_hashes.json / crop data の「読み→変更→書き戻し」直列化用
	//（並行アップロード・削除での更新消失防止）。
	metaMu sync.Mutex
}

type EmotionDefinitionFile struct {
	Emotions []EmotionDefinition `json:"emotions"`
}

type EmotionDefinition struct {
	Name string `json:"name"`
}

type CharacterImagesData struct {
	CharacterName string               `json:"characterName"`
	Images        map[string]ImageInfo `json:"images"`
}

type ImageInfo struct {
	HasOriginal  bool    `json:"hasOriginal"`
	HasIcon      bool    `json:"hasIcon"`
	OriginalPath *string `json:"originalPath"`
	IconPath     *string `json:"iconPath"`
	IconURL      *string `json:"iconUrl"`
	Hash         *string `json:"hash"`
}

type UploadResult struct {
	CharacterName     string `json:"characterName"`
	Emotion           string `json:"emotion"`
	OriginalImagePath string `json:"originalImagePath"`
	FileSize          int64  `json:"fileSize"`
}

type DeleteResult struct {
	CharacterName string   `json:"characterName"`
	Emotion       string   `json:"emotion"`
	DeletedFiles  []string `json:"deletedFiles"`
}

type CropData struct {
	X                 float64        `json:"x"`
	Y                 float64        `json:"y"`
	Zoom              float64        `json:"zoom"`
	CroppedAreaPixels CropAreaPixels `json:"croppedAreaPixels"`
}

type CropAreaPixels struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type CropResult struct {
	CharacterName string `json:"characterName"`
	Emotion       string `json:"emotion"`
	IconPath      string `json:"iconPath"`
	FileHash      string `json:"fileHash"`
}

type ServedImage struct {
	Path        string
	ContentType string
}

type imageHashesFile struct {
	Hashes map[string]string `json:"hashes"`
}

func NewImageService(resolver *paths.Resolver) *ImageService {
	return &ImageService{resolver: resolver}
}

func MaxCharacterImageUploadBytes() int64 {
	return maxCharacterImageUploadBytes
}

func (s *ImageService) Emotions() (any, error) {
	path, err := s.resolver.ResolveExisting(config.EmotionDefinitionsFile)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var raw any
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	return raw, nil
}

func (s *ImageService) Images(characterName string) (CharacterImagesData, error) {
	characterName, err := sanitizeImageSegment(characterName)
	if err != nil {
		return CharacterImagesData{}, err
	}
	emotions, err := s.emotionDefinitions()
	if err != nil {
		return CharacterImagesData{}, err
	}
	out := CharacterImagesData{
		CharacterName: characterName,
		Images:        map[string]ImageInfo{},
	}
	// image_hashes.json は心情数ぶん繰り返し読まず、ループ前に 1 回だけ読む。
	imageHashes := s.loadImageHashes(characterName)
	for _, emotion := range emotions.Emotions {
		emotionName, err := sanitizeImageSegment(emotion.Name)
		if err != nil || emotionName == "" {
			continue
		}
		originalRel, originalFound := s.findImageRel(characterName, config.CharacterOriginalImageDirName, emotionName)
		iconRel, iconFound := s.findImageRel(characterName, config.CharacterIconImageDirName, emotionName)
		hash := hashFromMap(imageHashes, emotionName)
		var iconURL *string
		if iconFound {
			ext := path.Ext(iconRel)
			url := "/images/characters/" + pathEscape(characterName) + "/" +
				pathEscape(config.CharacterImageDirName) + "/" +
				pathEscape(config.CharacterIconImageDirName) + "/" +
				pathEscape(emotionName+ext)
			if hash != nil {
				url += "?v=" + *hash
			}
			iconURL = &url
		}
		out.Images[emotionName] = ImageInfo{
			HasOriginal:  originalFound,
			HasIcon:      iconFound,
			OriginalPath: optionalString(originalRel, originalFound),
			IconPath:     optionalString(iconRel, iconFound),
			IconURL:      iconURL,
			Hash:         hash,
		}
	}
	return out, nil
}

func (s *ImageService) Upload(characterName, emotion, contentType string, r io.Reader) (UploadResult, error) {
	characterName, err := sanitizeImageSegment(characterName)
	if err != nil {
		return UploadResult{}, err
	}
	emotion, err = sanitizeImageSegment(emotion)
	if err != nil {
		return UploadResult{}, err
	}
	if emotion == "" {
		return UploadResult{}, ErrImageEmotionRequired
	}
	limited := io.LimitReader(r, maxCharacterImageUploadBytes+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return UploadResult{}, err
	}
	if len(data) == 0 {
		return UploadResult{}, ErrImageFileRequired
	}
	if int64(len(data)) > maxCharacterImageUploadBytes {
		return UploadResult{}, ErrImageTooLarge
	}
	sniffed := http.DetectContentType(data)
	ext, err := extensionForImageContentType(contentType)
	if err != nil {
		ext, err = extensionForImageContentType(sniffed)
		if err != nil {
			return UploadResult{}, err
		}
	}
	if err := s.deleteImageFiles(characterName, config.CharacterOriginalImageDirName, emotion); err != nil {
		return UploadResult{}, err
	}
	rel := characterImageRel(characterName, config.CharacterOriginalImageDirName, emotion+ext)
	abs, err := s.resolver.ResolveForCreateMkdirAll(rel, config.DirPerm)
	if err != nil {
		return UploadResult{}, err
	}
	if err := os.WriteFile(abs, data, config.FilePerm); err != nil {
		return UploadResult{}, err
	}
	return UploadResult{
		CharacterName:     characterName,
		Emotion:           emotion,
		OriginalImagePath: config.CharacterOriginalImageDirName + "/" + emotion + ext,
		FileSize:          int64(len(data)),
	}, nil
}

func (s *ImageService) Delete(characterName, emotion string) (DeleteResult, error) {
	characterName, err := sanitizeImageSegment(characterName)
	if err != nil {
		return DeleteResult{}, err
	}
	emotion, err = sanitizeImageSegment(emotion)
	if err != nil {
		return DeleteResult{}, err
	}
	deleted := []string{}
	for _, dirName := range []string{config.CharacterOriginalImageDirName, config.CharacterIconImageDirName} {
		files, err := s.deleteImageFilesCollect(characterName, dirName, emotion)
		if err != nil {
			return DeleteResult{}, err
		}
		deleted = append(deleted, files...)
	}
	if err := s.deleteImageHash(characterName, emotion); err != nil {
		return DeleteResult{}, err
	}
	if err := s.deleteCropData(characterName, emotion); err != nil {
		return DeleteResult{}, err
	}
	return DeleteResult{CharacterName: characterName, Emotion: emotion, DeletedFiles: deleted}, nil
}

func (s *ImageService) Crop(characterName, emotion string, cropData CropData) (CropResult, error) {
	characterName, err := sanitizeImageSegment(characterName)
	if err != nil {
		return CropResult{}, err
	}
	emotion, err = sanitizeImageSegment(emotion)
	if err != nil {
		return CropResult{}, err
	}
	if emotion == "" || cropData.CroppedAreaPixels.Width <= 0 || cropData.CroppedAreaPixels.Height <= 0 {
		return CropResult{}, ErrCropDataRequired
	}
	originalRel, ok := s.findImageRel(characterName, config.CharacterOriginalImageDirName, emotion)
	if !ok {
		return CropResult{}, ErrSourceImageNotFound
	}
	originalAbs, err := s.resolver.ResolveExisting(characterImageRel(characterName, config.CharacterOriginalImageDirName, path.Base(originalRel)))
	if err != nil {
		return CropResult{}, err
	}
	src, format, err := decodeCropSource(originalAbs)
	if err != nil {
		return CropResult{}, err
	}
	if format == "webp" {
		return CropResult{}, ErrUnsupportedCropImageType
	}
	icon, err := cropAndResize(src, cropData.CroppedAreaPixels, cropIconSizePixels)
	if err != nil {
		return CropResult{}, err
	}
	encoded := &bytes.Buffer{}
	if err := png.Encode(encoded, icon); err != nil {
		return CropResult{}, err
	}
	iconRel := characterImageRel(characterName, config.CharacterIconImageDirName, emotion+".png")
	iconAbs, err := s.resolver.ResolveForCreateMkdirAll(iconRel, config.DirPerm)
	if err != nil {
		return CropResult{}, err
	}
	if err := s.deleteImageFiles(characterName, config.CharacterIconImageDirName, emotion); err != nil {
		return CropResult{}, err
	}
	if err := os.WriteFile(iconAbs, encoded.Bytes(), config.FilePerm); err != nil {
		return CropResult{}, err
	}
	fileHash := md5Hash(encoded.Bytes())
	if err := s.saveImageHash(characterName, emotion, fileHash); err != nil {
		return CropResult{}, err
	}
	if err := s.saveCropData(characterName, emotion, cropData); err != nil {
		return CropResult{}, err
	}
	return CropResult{
		CharacterName: characterName,
		Emotion:       emotion,
		IconPath:      config.CharacterIconImageDirName + "/" + emotion + ".png",
		FileHash:      fileHash,
	}, nil
}

func (s *ImageService) StaticImage(characterName, rest string) (ServedImage, error) {
	characterName, err := sanitizeImageSegment(characterName)
	if err != nil {
		return ServedImage{}, err
	}
	rest = path.Clean(filepath.ToSlash(rest))
	if rest == "." || strings.HasPrefix(rest, "../") || strings.HasPrefix(rest, "/") {
		return ServedImage{}, ErrInvalidImagePath
	}
	rel := config.CharacterListDir + "/" + characterName + "/" + rest
	abs, err := s.resolver.ResolveExisting(rel)
	if err != nil {
		return ServedImage{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return ServedImage{}, err
	}
	if info.IsDir() {
		return ServedImage{}, fs.ErrNotExist
	}
	return ServedImage{Path: abs, ContentType: mime.TypeByExtension(strings.ToLower(filepath.Ext(abs)))}, nil
}

func (s *ImageService) emotionDefinitions() (EmotionDefinitionFile, error) {
	raw, err := s.Emotions()
	if err != nil {
		return EmotionDefinitionFile{}, err
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return EmotionDefinitionFile{}, err
	}
	var out EmotionDefinitionFile
	if err := json.Unmarshal(data, &out); err != nil {
		return EmotionDefinitionFile{}, err
	}
	return out, nil
}

func (s *ImageService) findImageRel(characterName, dirName, emotion string) (string, bool) {
	for _, ext := range imageExtensions() {
		rel := characterImageRel(characterName, dirName, emotion+ext)
		abs, err := s.resolver.ResolveLexical(rel)
		if err != nil {
			continue
		}
		if info, err := os.Stat(abs); err == nil && !info.IsDir() {
			return dirName + "/" + emotion + ext, true
		}
	}
	return "", false
}

// loadImageHashes は image_hashes.json を 1 回だけ読み、心情→ハッシュのマップを返す。
// 未存在・読めない場合は nil（ハッシュ無し扱い）。
// Images() は心情数ぶん繰り返し呼ばず、ループ前に一度だけ読むこと（02調査 低#6）。
func (s *ImageService) loadImageHashes(characterName string) map[string]string {
	path, err := s.resolver.ResolveLexical(characterInternalRel(characterName, config.CharacterImageHashesFileName))
	if err != nil {
		return nil
	}
	var hashes imageHashesFile
	if err := readJSONFile(path, &hashes); err != nil {
		return nil
	}
	return hashes.Hashes
}

func hashFromMap(hashes map[string]string, emotion string) *string {
	hash := strings.TrimSpace(hashes[emotion])
	if hash == "" {
		return nil
	}
	return &hash
}

func (s *ImageService) deleteImageFiles(characterName, dirName, emotion string) error {
	_, err := s.deleteImageFilesCollect(characterName, dirName, emotion)
	return err
}

func (s *ImageService) deleteImageFilesCollect(characterName, dirName, emotion string) ([]string, error) {
	deleted := []string{}
	for _, ext := range imageExtensions() {
		rel := characterImageRel(characterName, dirName, emotion+ext)
		abs, err := s.resolver.ResolveLexical(rel)
		if err != nil {
			return nil, err
		}
		if err := os.Remove(abs); err == nil {
			deleted = append(deleted, dirName+"/"+emotion+ext)
		} else if !errors.Is(err, fs.ErrNotExist) {
			return nil, err
		}
	}
	return deleted, nil
}

func (s *ImageService) deleteImageHash(characterName, emotion string) error {
	s.metaMu.Lock()
	defer s.metaMu.Unlock()
	path, err := s.resolver.ResolveLexical(characterInternalRel(characterName, config.CharacterImageHashesFileName))
	if err != nil {
		return err
	}
	var hashes imageHashesFile
	if err := readJSONFile(path, &hashes); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return err
	}
	if hashes.Hashes == nil {
		return nil
	}
	delete(hashes.Hashes, emotion)
	return writeJSONFile(path, hashes)
}

func (s *ImageService) saveImageHash(characterName, emotion, hash string) error {
	s.metaMu.Lock()
	defer s.metaMu.Unlock()
	path, err := s.resolver.ResolveForCreateMkdirAll(characterInternalRel(characterName, config.CharacterImageHashesFileName), config.DirPerm)
	if err != nil {
		return err
	}
	var hashes imageHashesFile
	if err := readJSONFile(path, &hashes); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if hashes.Hashes == nil {
		hashes.Hashes = map[string]string{}
	}
	hashes.Hashes[emotion] = hash
	return writeJSONFile(path, hashes)
}

func (s *ImageService) deleteCropData(characterName, emotion string) error {
	s.metaMu.Lock()
	defer s.metaMu.Unlock()
	path, err := s.resolver.ResolveLexical(characterInternalRel(characterName, config.CharacterImageCropDataFileName))
	if err != nil {
		return err
	}
	var raw struct {
		Crops map[string]any `json:"crops"`
	}
	if err := readJSONFile(path, &raw); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return err
	}
	if raw.Crops == nil {
		return nil
	}
	delete(raw.Crops, emotion)
	return writeJSONFile(path, raw)
}

func (s *ImageService) saveCropData(characterName, emotion string, cropData CropData) error {
	s.metaMu.Lock()
	defer s.metaMu.Unlock()
	path, err := s.resolver.ResolveForCreateMkdirAll(characterInternalRel(characterName, config.CharacterImageCropDataFileName), config.DirPerm)
	if err != nil {
		return err
	}
	var raw struct {
		Crops map[string]CropData `json:"crops"`
	}
	if err := readJSONFile(path, &raw); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if raw.Crops == nil {
		raw.Crops = map[string]CropData{}
	}
	raw.Crops[emotion] = cropData
	return writeJSONFile(path, raw)
}

func decodeCropSource(filePath string) (image.Image, string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, "", err
	}
	defer file.Close()
	ext := strings.ToLower(filepath.Ext(filePath))
	switch ext {
	case ".jpg", ".jpeg":
		img, err := jpeg.Decode(file)
		return img, "jpeg", err
	case ".png":
		img, err := png.Decode(file)
		return img, "png", err
	case ".webp":
		return nil, "webp", ErrUnsupportedCropImageType
	default:
		return nil, "", ErrUnsupportedCropImageType
	}
}

func cropAndResize(src image.Image, area CropAreaPixels, size int) (*image.RGBA, error) {
	rect := roundedCropRect(src.Bounds(), area)
	if rect.Empty() {
		return nil, ErrInvalidCropData
	}
	cropped := image.NewRGBA(image.Rect(0, 0, rect.Dx(), rect.Dy()))
	draw.Draw(cropped, cropped.Bounds(), src, rect.Min, draw.Src)
	return resizeNearest(cropped, size, size), nil
}

func roundedCropRect(bounds image.Rectangle, area CropAreaPixels) image.Rectangle {
	x := roundFloatToInt(area.X) + bounds.Min.X
	y := roundFloatToInt(area.Y) + bounds.Min.Y
	w := roundFloatToInt(area.Width)
	h := roundFloatToInt(area.Height)
	rect := image.Rect(x, y, x+w, y+h)
	return rect.Intersect(bounds)
}

func roundFloatToInt(value float64) int {
	if value < 0 {
		return int(value - 0.5)
	}
	return int(value + 0.5)
}

func resizeNearest(src image.Image, width, height int) *image.RGBA {
	dst := image.NewRGBA(image.Rect(0, 0, width, height))
	srcBounds := src.Bounds()
	for y := 0; y < height; y++ {
		srcY := srcBounds.Min.Y + y*srcBounds.Dy()/height
		for x := 0; x < width; x++ {
			srcX := srcBounds.Min.X + x*srcBounds.Dx()/width
			dst.Set(x, y, src.At(srcX, srcY))
		}
	}
	return dst
}

func md5Hash(data []byte) string {
	sum := md5.Sum(data)
	return hex.EncodeToString(sum[:])
}

func sanitizeImageSegment(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	replacer := strings.NewReplacer("\\", "", "/", "", ":", "", "*", "", "?", "", `"`, "", "<", "", ">", "", "|", "")
	value = replacer.Replace(value)
	value = strings.ReplaceAll(value, "..", "")
	if strings.TrimSpace(value) == "" {
		return "", ErrInvalidName
	}
	return value, nil
}

func extensionForImageContentType(contentType string) (string, error) {
	contentType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	switch contentType {
	case "image/jpeg", "image/jpg":
		return ".jpg", nil
	case "image/png":
		return ".png", nil
	case "image/webp":
		return ".webp", nil
	default:
		return "", ErrUnsupportedImageType
	}
}

func imageExtensions() []string {
	return []string{".webp", ".png", ".jpg", ".jpeg"}
}

func characterImageRel(characterName, dirName, filename string) string {
	return config.CharacterListDir + "/" + characterName + "/" + config.CharacterImageDirName + "/" + dirName + "/" + filename
}

func characterInternalRel(characterName, filename string) string {
	return config.CharacterListDir + "/" + characterName + "/" + config.CharacterInternalDataDirName + "/" + filename
}

func optionalString(value string, ok bool) *string {
	if !ok {
		return nil
	}
	return &value
}

func pathEscape(value string) string {
	return url.PathEscape(value)
}

func readJSONFile(path string, out any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

// writeJSONFile は jsonstore の「tmp→fsync→rename」規約でアトミックに書き込む。
// 直書き（os.WriteFile）は書き込み途中のクラッシュで JSON が破損するため使わない。
// 親ディレクトリの作成は呼び出し側の ResolveForCreateMkdirAll に寄せる。
func writeJSONFile(path string, value any) error {
	return jsonstore.WriteJSON(path, value)
}
