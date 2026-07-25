package settingspack

import (
	"path"
	"sort"
	"strings"

	"alslime/internal/config"
	"alslime/internal/storage/safename"
)

// ComfyUIWorkflowTemplateNames は設定パックの適用結果から、利用可能になった
// ComfyUI workflow テンプレート名を返す。
//
// Written は実際の書き込み先（リネーム時は WrittenAs）を、Skipped は既存の
// 配置先を確認する。想定ディレクトリ直下の単一名/workflow.json だけを認め、
// 入れ子・非正規パス・安全でない名前は返さない。
func ComfyUIWorkflowTemplateNames(result ImportResult) []string {
	names := make([]string, 0)
	appendName := func(rel string) {
		name, ok := comfyUIWorkflowTemplateName(rel)
		if !ok {
			return
		}
		for _, existing := range names {
			if safename.EqualFold(existing, name) {
				return
			}
		}
		names = append(names, name)
	}

	for _, entry := range result.Written {
		rel := entry.Path
		if entry.WrittenAs != "" {
			rel = entry.WrittenAs
		}
		appendName(rel)
	}
	for _, entry := range result.Skipped {
		if entry.ReasonKey != reasonConflictSkipped {
			continue
		}
		appendName(entry.Path)
	}
	sort.Strings(names)
	return names
}

func comfyUIWorkflowTemplateName(rel string) (string, bool) {
	if rel == "" || path.IsAbs(rel) || strings.Contains(rel, `\`) || path.Clean(rel) != rel {
		return "", false
	}
	prefix := config.ComfyUITemplateDir + "/"
	if !strings.HasPrefix(rel, prefix) {
		return "", false
	}
	parts := strings.Split(strings.TrimPrefix(rel, prefix), "/")
	if len(parts) != 2 || parts[1] != config.ComfyUIWorkflowFileName {
		return "", false
	}
	name, err := safename.Validate(parts[0])
	if err != nil || name != parts[0] {
		return "", false
	}
	return name, true
}
