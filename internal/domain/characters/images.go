package characters

import (
	"bytes"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	"image/draw"
	_ "image/jpeg"
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
	"time"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
	_ "golang.org/x/image/webp"
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
	// ErrEmotionNameInvalid は表情名に使用できない文字・形式が含まれる場合の利用者起因エラー。
	ErrEmotionNameInvalid = errors.New("invalid emotion name")
	// ErrEmotionNameDuplicate は表情名が重複する場合の利用者起因エラー。
	// 表情名は画像ファイル名になり、ファイル名の大小を区別しない環境があるため、
	// OS を問わず大文字小文字を無視した重複を拒否する。
	ErrEmotionNameDuplicate = errors.New("duplicate emotion name")
	// ErrEmotionDefaultRequired は default 表情の欠落・無効化を拒否する利用者起因エラー。
	// default は画像フォールバックの基点かつプロンプトの出力契約が参照する名前のため壊せない。
	ErrEmotionDefaultRequired = errors.New("default emotion required")
	// ErrEmotionCatalogMissing は表情定義が存在しない状態で一括削除を要求された場合のエラー。
	// 空定義のまま「定義に無いものは削除」を実行すると全キャラの全画像削除になるため拒否する。
	ErrEmotionCatalogMissing = errors.New("emotion catalog missing")
)

const (
	defaultEmotionName    = "default"
	emotionCatalogVersion = "1.0"
	// defaultEmotionDescription は default 表情の説明の規定値。
	// AI へそのまま渡る文言のため i18n を通さず日本語固定とし、
	// 保存・生成・マージのたびにサーバー側でこの値へ正規化する。
	defaultEmotionDescription = "特に際立った感情がなく、他のどの表情にも当てはまらない時の表情"
)

type ImageService struct {
	resolver *paths.Resolver
	// metaMu は image_hashes.json / crop data の「読み→変更→書き戻し」直列化用
	//（並行アップロード・削除での更新消失防止）。
	metaMu sync.Mutex
}

// EmotionCatalogData は表情種別の管理用ファイル（emotion_catalog.json）の全体。
// 無効な表情も含む正本で、AI 送信用の emotion_definitions.json は
// ここから有効な表情だけを抽出して生成する。
type EmotionCatalogData struct {
	Version      string                `json:"version"`
	Emotions     []EmotionCatalogEntry `json:"emotions"`
	LastModified string                `json:"lastModified"`
}

// EmotionCatalogEntry は表情種別 1 件。
type EmotionCatalogEntry struct {
	// Name は表情の識別子。AI が出力する値で、画像ファイル名にもなる。
	Name string `json:"name"`
	// Label は UI 表示用の名称。AI へは渡さない。
	Label string `json:"label"`
	// Description は AI へ渡す説明。どんな時にする表情かを伝える。
	Description string `json:"description"`
	// Enabled が false の表情は AI へ候補として渡さない。
	Enabled bool `json:"enabled"`
}

// emotionDefinitionDetail は AI 送信用ファイル（emotion_definitions.json）の 1 件。
type emotionDefinitionDetail struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type emotionDefinitionDetailFile struct {
	Emotions []emotionDefinitionDetail `json:"emotions"`
}

// PruneOrphanImagesResult は定義に無い表情画像の一括削除の結果。
type PruneOrphanImagesResult struct {
	ScannedCharacters  int `json:"scannedCharacters"`
	AffectedCharacters int `json:"affectedCharacters"`
	DeletedFiles       int `json:"deletedFiles"`
	DeletedEntries     int `json:"deletedEntries"`
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
	// 走査対象は管理用カタログ（無効含む全表情）。
	// 送信用ファイルを走査すると無効化した表情が応答から消え、
	// 画像管理パネルの操作とチャットの過去ログのアイコン解決が壊れる。
	catalog, err := s.EmotionCatalog()
	if err != nil {
		return CharacterImagesData{}, err
	}
	out := CharacterImagesData{
		CharacterName: characterName,
		Images:        map[string]ImageInfo{},
	}
	// image_hashes.json は心情数ぶん繰り返し読まず、ループ前に 1 回だけ読む。
	imageHashes := s.loadImageHashes(characterName)
	for _, emotion := range catalog.Emotions {
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

func (s *ImageService) Upload(characterName, emotion, _ string, r io.Reader) (UploadResult, error) {
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
	ext, err := extensionForImageContentType(sniffed)
	if err != nil {
		return UploadResult{}, err
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
	src, _, err := decodeCropSource(originalAbs)
	if err != nil {
		return CropResult{}, err
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

// EmotionCatalog は管理用ファイルを読み、送信用ファイルとマージした結果を返す。
// 管理用が無い場合は送信用から生成する（初回・既存環境・旧形式パックのインポート後）。
// 返り値は正規化済みだがディスクへは書かない。永続化は SaveEmotionCatalog が行う。
func (s *ImageService) EmotionCatalog() (EmotionCatalogData, error) {
	catalog, _, err := s.emotionCatalogWithPresence()
	return catalog, err
}

// emotionCatalogWithPresence は EmotionCatalog の実体。
// 管理用・送信用のどちらかが存在したかを返す（PruneOrphanImages の安全装置用）。
func (s *ImageService) emotionCatalogWithPresence() (EmotionCatalogData, bool, error) {
	found := false
	var catalog EmotionCatalogData
	if path, err := s.resolver.ResolveLexical(config.EmotionCatalogFile); err == nil {
		switch err := readJSONFile(path, &catalog); {
		case err == nil:
			found = true
		case errors.Is(err, fs.ErrNotExist):
			// 未作成。送信用からの生成に回す。
		default:
			return EmotionCatalogData{}, false, err
		}
	} else {
		return EmotionCatalogData{}, false, err
	}
	var definitions emotionDefinitionDetailFile
	if path, err := s.resolver.ResolveLexical(config.EmotionDefinitionsFile); err == nil {
		switch err := readJSONFile(path, &definitions); {
		case err == nil:
			found = true
		case errors.Is(err, fs.ErrNotExist):
			// 送信用も無い。マージ対象なしとして続行する。
		default:
			return EmotionCatalogData{}, false, err
		}
	} else {
		return EmotionCatalogData{}, false, err
	}
	return mergeEmotionCatalog(catalog, definitions.Emotions), found, nil
}

// mergeEmotionCatalog は送信用にのみ存在する表情を enabled: true で管理用へ取り込む。
// 旧形式の設定パック（送信用のみ）をインポートしても表情を持ち込めるようにするための
// 「足りない分を増やす」方向のみのマージで、減らす操作は管理モーダルからのみ行う。
// 照合は OS を問わず大文字小文字を無視する。
func mergeEmotionCatalog(catalog EmotionCatalogData, definitions []emotionDefinitionDetail) EmotionCatalogData {
	seen := map[string]bool{}
	for _, entry := range catalog.Emotions {
		seen[strings.ToLower(strings.TrimSpace(entry.Name))] = true
	}
	for _, def := range definitions {
		name := strings.TrimSpace(def.Name)
		key := strings.ToLower(name)
		if name == "" || seen[key] {
			continue
		}
		seen[key] = true
		label := strings.TrimSpace(def.Description)
		if label == "" {
			label = name
		}
		catalog.Emotions = append(catalog.Emotions, EmotionCatalogEntry{
			Name:        name,
			Label:       label,
			Description: def.Description,
			Enabled:     true,
		})
	}
	catalog.Emotions = normalizeDefaultEmotion(catalog.Emotions)
	if catalog.Version == "" {
		catalog.Version = emotionCatalogVersion
	}
	return catalog
}

// normalizeDefaultEmotion は default 行を規定値で作り直して先頭へ置く。
// default は全項目編集不可（利用者決定）のため、入力に何が来ても規定値を正とする。
func normalizeDefaultEmotion(entries []EmotionCatalogEntry) []EmotionCatalogEntry {
	out := make([]EmotionCatalogEntry, 0, len(entries)+1)
	out = append(out, EmotionCatalogEntry{
		Name:        defaultEmotionName,
		Label:       defaultEmotionName,
		Description: defaultEmotionDescription,
		Enabled:     true,
	})
	for _, entry := range entries {
		if strings.EqualFold(strings.TrimSpace(entry.Name), defaultEmotionName) {
			continue
		}
		out = append(out, entry)
	}
	return out
}

// SaveEmotionCatalog は入力を検証して管理用ファイルへ書き、送信用ファイルを再生成する。
// 管理用の書き込み後に送信用の生成が失敗した場合はエラーを返す。
// 送信用は次回保存で必ず再生成されるため、復旧は保存のやり直しで足りる。
func (s *ImageService) SaveEmotionCatalog(input EmotionCatalogData) (EmotionCatalogData, error) {
	entries, err := validateEmotionCatalogEntries(input.Emotions)
	if err != nil {
		return EmotionCatalogData{}, err
	}
	out := EmotionCatalogData{
		Version:      emotionCatalogVersion,
		Emotions:     entries,
		LastModified: time.Now().UTC().Format(time.RFC3339),
	}
	catalogAbs, err := s.resolver.ResolveForCreateMkdirAll(config.EmotionCatalogFile, config.DirPerm)
	if err != nil {
		return EmotionCatalogData{}, err
	}
	if err := writeJSONFile(catalogAbs, out); err != nil {
		return EmotionCatalogData{}, err
	}
	enabled := []emotionDefinitionDetail{}
	for _, entry := range entries {
		if !entry.Enabled {
			continue
		}
		enabled = append(enabled, emotionDefinitionDetail{Name: entry.Name, Description: entry.Description})
	}
	definitionsAbs, err := s.resolver.ResolveForCreateMkdirAll(config.EmotionDefinitionsFile, config.DirPerm)
	if err != nil {
		return EmotionCatalogData{}, err
	}
	if err := writeJSONFile(definitionsAbs, emotionDefinitionDetailFile{Emotions: enabled}); err != nil {
		return EmotionCatalogData{}, err
	}
	return out, nil
}

// validateEmotionCatalogEntries は保存入力を検証し、正規化済みの一覧を返す。
// 表情名が空の行は除外する（モーダルの自動追加行の保険）。
func validateEmotionCatalogEntries(entries []EmotionCatalogEntry) ([]EmotionCatalogEntry, error) {
	out := []EmotionCatalogEntry{}
	seen := map[string]bool{}
	hasDefault := false
	for _, entry := range entries {
		name := strings.TrimSpace(entry.Name)
		if name == "" {
			continue
		}
		if err := validateEmotionName(name); err != nil {
			return nil, err
		}
		key := strings.ToLower(name)
		if seen[key] {
			return nil, ErrEmotionNameDuplicate
		}
		seen[key] = true
		if key == defaultEmotionName {
			hasDefault = true
			if !entry.Enabled {
				return nil, ErrEmotionDefaultRequired
			}
		}
		entry.Name = name
		if strings.TrimSpace(entry.Label) == "" {
			entry.Label = entry.Description
		}
		out = append(out, entry)
	}
	if !hasDefault {
		return nil, ErrEmotionDefaultRequired
	}
	return normalizeDefaultEmotion(out), nil
}

// validateEmotionName は表情名として使えない値を拒否する。
// 表情名は画像ファイル名になるため sanitizeImageSegment が除去する文字と揃えるが、
// 黙って除去すると利用者の入力と保存結果が食い違うため、エラーで返して修正させる。
// 末尾のドットはファイル名として扱えない環境があるため OS を問わず拒否する。
func validateEmotionName(name string) error {
	if strings.ContainsAny(name, "\\/:*?\"<>|") || strings.Contains(name, "..") {
		return ErrEmotionNameInvalid
	}
	if strings.HasSuffix(name, ".") {
		return ErrEmotionNameInvalid
	}
	return nil
}

// PruneOrphanImages は定義に無い表情の画像・ハッシュ・切り抜きデータを全キャラから削除する。
// 有効・無効を問わず、定義に存在する表情はすべて残す。
// 照合は OS を問わず大文字小文字を無視し、「残し過ぎ」側に倒す。
func (s *ImageService) PruneOrphanImages() (PruneOrphanImagesResult, error) {
	result := PruneOrphanImagesResult{}
	catalog, found, err := s.emotionCatalogWithPresence()
	if err != nil {
		return result, err
	}
	if !found {
		// 定義ファイルがどこにも無い状態で実行すると全画像削除になるため中断する。
		return result, ErrEmotionCatalogMissing
	}
	keep := map[string]bool{}
	for _, entry := range catalog.Emotions {
		keep[strings.ToLower(strings.TrimSpace(entry.Name))] = true
	}
	if !keep[defaultEmotionName] {
		// 正規化により通常発生しないが、全削除事故の最終防壁として残す。
		return result, ErrEmotionCatalogMissing
	}
	rootAbs, err := s.resolver.ResolveLexical(config.CharacterListDir)
	if err != nil {
		return result, err
	}
	characterDirs, err := os.ReadDir(rootAbs)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return result, nil
		}
		return result, err
	}
	for _, characterDir := range characterDirs {
		if !characterDir.IsDir() {
			continue
		}
		characterName := characterDir.Name()
		result.ScannedCharacters++
		deletedFiles, err := s.pruneCharacterImageFiles(rootAbs, characterName, keep)
		if err != nil {
			return result, err
		}
		deletedEntries, err := s.pruneCharacterImageMetadata(characterName, keep)
		if err != nil {
			return result, err
		}
		result.DeletedFiles += deletedFiles
		result.DeletedEntries += deletedEntries
		if deletedFiles > 0 || deletedEntries > 0 {
			result.AffectedCharacters++
		}
	}
	return result, nil
}

// pruneCharacterImageFiles は 1 キャラの icons/originals から定義に無い表情の画像を削除する。
func (s *ImageService) pruneCharacterImageFiles(rootAbs, characterName string, keep map[string]bool) (int, error) {
	deleted := 0
	for _, dirName := range []string{config.CharacterOriginalImageDirName, config.CharacterIconImageDirName} {
		imagesDir := filepath.Join(rootAbs, characterName, config.CharacterImageDirName, dirName)
		files, err := os.ReadDir(imagesDir)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				continue
			}
			return deleted, err
		}
		for _, file := range files {
			if file.IsDir() {
				continue
			}
			base := strings.TrimSuffix(file.Name(), filepath.Ext(file.Name()))
			if keep[strings.ToLower(base)] {
				continue
			}
			if err := os.Remove(filepath.Join(imagesDir, file.Name())); err != nil {
				return deleted, err
			}
			deleted++
		}
	}
	return deleted, nil
}

// pruneCharacterImageMetadata は image_hashes.json / crop_data.json から定義に無いキーを削除する。
// JSON として読めないファイルは触らず残す（読めないものを消すのは危険なため）。
func (s *ImageService) pruneCharacterImageMetadata(characterName string, keep map[string]bool) (int, error) {
	s.metaMu.Lock()
	defer s.metaMu.Unlock()
	removed := 0
	hashesPath, err := s.resolver.ResolveLexical(characterInternalRel(characterName, config.CharacterImageHashesFileName))
	if err != nil {
		return removed, err
	}
	var hashes imageHashesFile
	if err := readJSONFile(hashesPath, &hashes); err == nil && hashes.Hashes != nil {
		changed := false
		for key := range hashes.Hashes {
			if keep[strings.ToLower(strings.TrimSpace(key))] {
				continue
			}
			delete(hashes.Hashes, key)
			removed++
			changed = true
		}
		if changed {
			if err := writeJSONFile(hashesPath, hashes); err != nil {
				return removed, err
			}
		}
	}
	cropPath, err := s.resolver.ResolveLexical(characterInternalRel(characterName, config.CharacterImageCropDataFileName))
	if err != nil {
		return removed, err
	}
	var crops struct {
		Crops map[string]CropData `json:"crops"`
	}
	if err := readJSONFile(cropPath, &crops); err == nil && crops.Crops != nil {
		changed := false
		for key := range crops.Crops {
			if keep[strings.ToLower(strings.TrimSpace(key))] {
				continue
			}
			delete(crops.Crops, key)
			removed++
			changed = true
		}
		if changed {
			if err := writeJSONFile(cropPath, crops); err != nil {
				return removed, err
			}
		}
	}
	return removed, nil
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
	img, format, err := image.Decode(file)
	if err != nil {
		if errors.Is(err, image.ErrFormat) {
			return nil, "", ErrUnsupportedCropImageType
		}
		return nil, "", err
	}
	switch format {
	case "jpeg", "png", "webp":
		return img, format, nil
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
