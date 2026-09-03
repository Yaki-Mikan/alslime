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

// EmotionPromptsVersion は emotion_prompts.json の形式版。
const EmotionPromptsVersion = 1

// EmotionPromptEntry は 1 表情に保存するプロンプト 1 件（タイトルで識別）。
type EmotionPromptEntry struct {
	Title  string `json:"title"`
	Prompt string `json:"prompt"`
}

// EmotionPrompts は表情画像生成で使う表情ごとのプロンプト一覧（キャラクター共通）。
// 表情名 → 一覧。表情カタログに無い名前の項目も残す（カタログへ戻したとき復活する）。
type EmotionPrompts struct {
	Version int `json:"version"`
	// Workflow は表情画像生成で選択中のワークフロー（テンプレート名）。
	// 画像生成統合設定の既定（defaultTemplateId）とは別に保持する。
	Workflow string                          `json:"workflow"`
	Emotions map[string][]EmotionPromptEntry `json:"emotions"`
}

// DefaultEmotionPrompts は未作成時の既定値。
func DefaultEmotionPrompts() EmotionPrompts {
	return EmotionPrompts{Version: EmotionPromptsVersion, Emotions: map[string][]EmotionPromptEntry{}}
}

// EmotionPromptsService は emotion_prompts.json の読み書きを担う。
type EmotionPromptsService struct {
	resolver *paths.Resolver
}

// NewEmotionPromptsService は EmotionPromptsService を生成する。
func NewEmotionPromptsService(resolver *paths.Resolver) *EmotionPromptsService {
	return &EmotionPromptsService{resolver: resolver}
}

// Get は表情プロンプト一覧を返す。未作成なら既定値。破損 JSON はエラー。
func (s *EmotionPromptsService) Get() (EmotionPrompts, error) {
	abs, err := s.resolver.ResolveLexical(config.EmotionPromptsFile)
	if err != nil {
		return EmotionPrompts{}, err
	}
	if _, statErr := os.Stat(abs); errors.Is(statErr, fs.ErrNotExist) {
		return DefaultEmotionPrompts(), nil
	}
	var loaded EmotionPrompts
	if err := readJSONFile(abs, &loaded); err != nil {
		return EmotionPrompts{}, err
	}
	return normalizeEmotionPrompts(loaded), nil
}

// Save は正規化して書き込み、書き込んだ内容を返す。
func (s *EmotionPromptsService) Save(in EmotionPrompts) (EmotionPrompts, error) {
	out := normalizeEmotionPrompts(in)
	abs, err := s.resolver.ResolveForCreateMkdirAll(config.EmotionPromptsFile, config.DirPerm)
	if err != nil {
		return EmotionPrompts{}, err
	}
	if err := jsonstore.WriteJSONIndent(abs, out, "  "); err != nil {
		return EmotionPrompts{}, err
	}
	return out, nil
}

// normalizeEmotionPrompts は version 固定・表情名の検証・タイトルの整形（空除去・同名は後勝ち）を行う。
func normalizeEmotionPrompts(in EmotionPrompts) EmotionPrompts {
	out := DefaultEmotionPrompts()
	out.Workflow = strings.TrimSpace(in.Workflow)
	for rawName, entries := range in.Emotions {
		name, err := sanitizeImageSegment(rawName)
		if err != nil || name == "" {
			continue
		}
		byTitle := map[string]int{}
		normalized := make([]EmotionPromptEntry, 0, len(entries))
		for _, e := range entries {
			title := strings.TrimSpace(e.Title)
			if title == "" {
				continue
			}
			entry := EmotionPromptEntry{Title: title, Prompt: strings.TrimSpace(e.Prompt)}
			if idx, ok := byTitle[title]; ok {
				normalized[idx] = entry
				continue
			}
			byTitle[title] = len(normalized)
			normalized = append(normalized, entry)
		}
		if len(normalized) == 0 {
			continue
		}
		out.Emotions[name] = normalized
	}
	return out
}
