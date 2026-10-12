package characters

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"alslime/internal/config"
)

// CharacterImageStatus は素材づくりのキャラ一覧に出す、1キャラ分の表情画像の作成状況。
type CharacterImageStatus struct {
	// DirName はキャラクターのディレクトリ名（キャラ一覧の dirName と同じ値）。
	DirName string `json:"dirName"`
	// Originals は元画像がある有効な表情の数。
	Originals int `json:"originals"`
	// Icons はアイコンがある有効な表情の数。
	Icons int `json:"icons"`
}

// ImageStatusData は全キャラの表情画像の作成状況。
type ImageStatusData struct {
	// EnabledEmotions は有効な表情の数（作成状況の分母）。
	EnabledEmotions int                    `json:"enabledEmotions"`
	Characters      []CharacterImageStatus `json:"characters"`
}

// ImageStatus は全キャラの表情画像の作成状況をまとめて返す。読むだけで書き込みはしない。
// 1キャラずつ Images を呼ぶと数百人で数百回の問い合わせになるため、一覧用にまとめて数える。
// 数えるのは有効な表情だけで、同じ表情の拡張子違いは1つとして数える。
func (s *ImageService) ImageStatus() (ImageStatusData, error) {
	out := ImageStatusData{Characters: []CharacterImageStatus{}}
	catalog, err := s.EmotionCatalog()
	if err != nil {
		return out, err
	}
	enabled := map[string]bool{}
	for _, entry := range catalog.Emotions {
		if !entry.Enabled {
			continue
		}
		name := strings.ToLower(strings.TrimSpace(entry.Name))
		if name != "" {
			enabled[name] = true
		}
	}
	out.EnabledEmotions = len(enabled)

	rootAbs, err := s.resolver.ResolveLexical(config.CharacterListDir)
	if err != nil {
		return out, err
	}
	characterDirs, err := os.ReadDir(rootAbs)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return out, nil
		}
		return out, err
	}
	for _, characterDir := range characterDirs {
		if !characterDir.IsDir() {
			continue
		}
		imagesDir := filepath.Join(rootAbs, characterDir.Name(), config.CharacterImageDirName)
		originals, err := countEnabledImages(filepath.Join(imagesDir, config.CharacterOriginalImageDirName), enabled)
		if err != nil {
			return out, err
		}
		icons, err := countEnabledImages(filepath.Join(imagesDir, config.CharacterIconImageDirName), enabled)
		if err != nil {
			return out, err
		}
		out.Characters = append(out.Characters, CharacterImageStatus{
			DirName:   characterDir.Name(),
			Originals: originals,
			Icons:     icons,
		})
	}
	sort.Slice(out.Characters, func(i, j int) bool { return out.Characters[i].DirName < out.Characters[j].DirName })
	return out, nil
}

// countEnabledImages はディレクトリの中の画像のうち、有効な表情の名前のものを数える。
// ディレクトリが無ければ 0。拡張子違いの同じ表情は1つとして数える。
func countEnabledImages(dir string, enabled map[string]bool) (int, error) {
	files, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return 0, nil
		}
		return 0, err
	}
	extensions := map[string]bool{}
	for _, ext := range imageExtensions() {
		extensions[strings.ToLower(ext)] = true
	}
	seen := map[string]bool{}
	for _, file := range files {
		if file.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(file.Name()))
		if !extensions[ext] {
			continue
		}
		base := strings.ToLower(strings.TrimSuffix(file.Name(), filepath.Ext(file.Name())))
		if enabled[base] {
			seen[base] = true
		}
	}
	return len(seen), nil
}
