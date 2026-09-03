package characters

import (
	"errors"
	"io/fs"
	"os"
	"strings"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
)

// ErrCharacterNotFound はキャラクターディレクトリ（settings）が存在しない場合のエラー。
// 本体 .md を一度も保存していないキャラクターへの付随設定の書き込みを弾く。
var ErrCharacterNotFound = errors.New("character not found")

// LinkedSettingsVersion は linked_settings.json の形式版。
const LinkedSettingsVersion = 1

// 追加設定の合成モード。
const (
	LinkedModeAppend  = "append"
	LinkedModeReplace = "replace"
)

// LinkedAdditional はキャラクター側の追加設定テキストと、
// プリセット側の同名欄と両方入力されたときの扱い（追記／置換）。
type LinkedAdditional struct {
	Mode string `json:"mode"`
	Text string `json:"text"`
}

// LinkedGroup は 1 種別（性格／服装・髪型／背景）の紐づけ。
// Files は WORKSPACE_ROOT 相対・"/" 区切りのパス（会話設定の選択値と同じ形）。
type LinkedGroup struct {
	Files      []string         `json:"files"`
	Additional LinkedAdditional `json:"additional"`
}

// LinkedSettings はキャラクターに紐づける設定の正本
// （roleplay/characters/<dirName>/settings/linked_settings.json）。
type LinkedSettings struct {
	Version       int         `json:"version"`
	Personalities LinkedGroup `json:"personalities"`
	Outfits       LinkedGroup `json:"outfits"`
	Backgrounds   LinkedGroup `json:"backgrounds"`
}

// DefaultLinkedSettings は未作成時の既定値（全て空・追記）。
func DefaultLinkedSettings() LinkedSettings {
	empty := func() LinkedGroup {
		return LinkedGroup{Files: []string{}, Additional: LinkedAdditional{Mode: LinkedModeAppend}}
	}
	return LinkedSettings{
		Version:       LinkedSettingsVersion,
		Personalities: empty(),
		Outfits:       empty(),
		Backgrounds:   empty(),
	}
}

// LinkedSettingsService は linked_settings.json の読み書きを担う。
type LinkedSettingsService struct {
	resolver *paths.Resolver
}

// NewLinkedSettingsService は LinkedSettingsService を生成する。
func NewLinkedSettingsService(resolver *paths.Resolver) *LinkedSettingsService {
	return &LinkedSettingsService{resolver: resolver}
}

// Get はキャラクターの紐づけ設定を返す。未作成なら既定値。
// 破損 JSON はエラーにする（利用者の編集内容が消えたように見せない）。
func (s *LinkedSettingsService) Get(dirName string) (LinkedSettings, error) {
	name, err := requireCharacterDirName(dirName)
	if err != nil {
		return LinkedSettings{}, err
	}
	abs, err := s.resolver.ResolveLexical(linkedSettingsRel(name))
	if err != nil {
		return LinkedSettings{}, err
	}
	if _, statErr := os.Stat(abs); errors.Is(statErr, fs.ErrNotExist) {
		return DefaultLinkedSettings(), nil
	}
	var loaded LinkedSettings
	if err := readJSONFile(abs, &loaded); err != nil {
		return LinkedSettings{}, err
	}
	return normalizeLinkedSettings(loaded), nil
}

// Save は紐づけ設定を正規化して書き込み、書き込んだ内容を返す。
// キャラクターディレクトリ（settings）が無ければ ErrCharacterNotFound。
func (s *LinkedSettingsService) Save(dirName string, in LinkedSettings) (LinkedSettings, error) {
	name, err := requireCharacterDirName(dirName)
	if err != nil {
		return LinkedSettings{}, err
	}
	settingsRel := config.CharacterListDir + "/" + name + "/" + config.CharacterSettingsDirName
	settingsAbs, err := s.resolver.ResolveLexical(settingsRel)
	if err != nil {
		return LinkedSettings{}, err
	}
	if info, statErr := os.Stat(settingsAbs); statErr != nil || !info.IsDir() {
		if statErr == nil || errors.Is(statErr, fs.ErrNotExist) {
			return LinkedSettings{}, ErrCharacterNotFound
		}
		return LinkedSettings{}, statErr
	}
	out := normalizeLinkedSettings(in)
	abs, err := s.resolver.ResolveForCreateMkdirAll(linkedSettingsRel(name), config.DirPerm)
	if err != nil {
		return LinkedSettings{}, err
	}
	if err := jsonstore.WriteJSONIndent(abs, out, "  "); err != nil {
		return LinkedSettings{}, err
	}
	return out, nil
}

func linkedSettingsRel(dirName string) string {
	return config.CharacterListDir + "/" + dirName + "/" + config.CharacterSettingsDirName + "/" + config.CharacterLinkedSettingsFileName
}

// requireCharacterDirName は画像 API と同じ規則で名前を検証し、空を拒否する。
func requireCharacterDirName(dirName string) (string, error) {
	name, err := sanitizeImageSegment(dirName)
	if err != nil {
		return "", err
	}
	if name == "" {
		return "", ErrInvalidName
	}
	return name, nil
}

// normalizeLinkedSettings は version 固定・files の整形（空除去・区切り統一・重複除去）・
// mode の既定化を行う。
func normalizeLinkedSettings(in LinkedSettings) LinkedSettings {
	return LinkedSettings{
		Version:       LinkedSettingsVersion,
		Personalities: normalizeLinkedGroup(in.Personalities),
		Outfits:       normalizeLinkedGroup(in.Outfits),
		Backgrounds:   normalizeLinkedGroup(in.Backgrounds),
	}
}

func normalizeLinkedGroup(in LinkedGroup) LinkedGroup {
	files := make([]string, 0, len(in.Files))
	seen := map[string]bool{}
	for _, f := range in.Files {
		f = strings.TrimSpace(strings.ReplaceAll(f, `\`, "/"))
		if f == "" || seen[f] {
			continue
		}
		seen[f] = true
		files = append(files, f)
	}
	mode := strings.TrimSpace(in.Additional.Mode)
	if mode != LinkedModeReplace {
		mode = LinkedModeAppend
	}
	return LinkedGroup{
		Files:      files,
		Additional: LinkedAdditional{Mode: mode, Text: in.Additional.Text},
	}
}
