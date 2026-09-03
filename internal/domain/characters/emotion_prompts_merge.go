package characters

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"io"
	"path"
	"strings"
)

// emotionPromptsPackFileName はサンプルパック zip 内の対象ファイル名。
const emotionPromptsPackFileName = "emotion_prompts.json"

// emotionPromptsPackMaxBytes はパック内 JSON の読み込み上限（表情プロンプトは数 KB 程度）。
const emotionPromptsPackMaxBytes = 4 << 20

// ErrEmotionPromptsPackMissing は zip に emotion_prompts.json が無い。
var ErrEmotionPromptsPackMissing = errors.New("emotion prompts pack: emotion_prompts.json not found")

// EmotionPromptsMergeResult はサンプル取り込みの結果。
type EmotionPromptsMergeResult struct {
	Added   int            `json:"added"`
	Skipped int            `json:"skipped"`
	Prompts EmotionPrompts `json:"prompts"`
}

// MergeFromZip は zip 内の emotion_prompts.json を読み、表情ごとに「無いタイトルだけ追加」で
// 既存の一覧へ合成して保存する。既存タイトルは利用者の編集を保つため残す（Skipped に数える）。
// workflow はパックからは取り込まない。zip のエントリ名は末尾一致で探し、親参照を含むものは無視する。
func (s *EmotionPromptsService) MergeFromZip(zipPath string) (EmotionPromptsMergeResult, error) {
	incoming, err := readEmotionPromptsFromZip(zipPath)
	if err != nil {
		return EmotionPromptsMergeResult{}, err
	}
	current, err := s.Get()
	if err != nil {
		return EmotionPromptsMergeResult{}, err
	}
	merged, added, skipped := mergeEmotionPrompts(current, incoming)
	saved, err := s.Save(merged)
	if err != nil {
		return EmotionPromptsMergeResult{}, err
	}
	return EmotionPromptsMergeResult{Added: added, Skipped: skipped, Prompts: saved}, nil
}

func readEmotionPromptsFromZip(zipPath string) (EmotionPrompts, error) {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return EmotionPrompts{}, err
	}
	defer func() { _ = zr.Close() }()
	for _, f := range zr.File {
		name := strings.ReplaceAll(f.Name, `\`, "/")
		if strings.Contains(name, "..") || path.Base(name) != emotionPromptsPackFileName || f.FileInfo().IsDir() {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return EmotionPrompts{}, err
		}
		data, readErr := io.ReadAll(io.LimitReader(rc, emotionPromptsPackMaxBytes+1))
		_ = rc.Close()
		if readErr != nil {
			return EmotionPrompts{}, readErr
		}
		if len(data) > emotionPromptsPackMaxBytes {
			return EmotionPrompts{}, errors.New("emotion prompts pack: file too large")
		}
		var loaded EmotionPrompts
		if err := json.Unmarshal(data, &loaded); err != nil {
			return EmotionPrompts{}, err
		}
		return normalizeEmotionPrompts(loaded), nil
	}
	return EmotionPrompts{}, ErrEmotionPromptsPackMissing
}

// mergeEmotionPrompts は current に incoming の「無いタイトル」だけを追加する。
func mergeEmotionPrompts(current, incoming EmotionPrompts) (EmotionPrompts, int, int) {
	out := normalizeEmotionPrompts(current)
	added, skipped := 0, 0
	for name, entries := range incoming.Emotions {
		existing := out.Emotions[name]
		titles := map[string]bool{}
		for _, e := range existing {
			titles[e.Title] = true
		}
		for _, e := range entries {
			if titles[e.Title] {
				skipped++
				continue
			}
			existing = append(existing, e)
			titles[e.Title] = true
			added++
		}
		if len(existing) > 0 {
			out.Emotions[name] = existing
		}
	}
	return out, added, skipped
}
