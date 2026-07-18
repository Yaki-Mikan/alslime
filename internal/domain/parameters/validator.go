// validator.go は項目設定スキーマ（ParameterSchema）のバリデーションを担う。
//
// 現行 Node 版 core/parameter-validator.ts の忠実移植（交換日記 17）。
// スキーマは固定構造体に縛らず map[string]any として走査する。
// 理由: 現行も any を受けて検証しており、未知フィールドを落とさず保存するため。
//
// 落としてはならない拒否条件（交換日記 17）:
//   - groups 最大 10 / group 内 element 最大 20
//   - element type 別必須フィールド
//   - parentId 整合（同一グループ内に存在）
//   - LocalizedString.ja 必須
//   - schemaId 形式（呼び出し側 schemaid.Validate でも担保するが、ここでも存在を確認）
//   - schemaName 必須
package parameters

import "fmt"

// 上限値（現行 MAX_GROUPS / MAX_ELEMENTS_PER_GROUP と同値）。
const (
	maxGroups           = 10
	maxElementsPerGroup = 20
)

// 許可する要素タイプ（現行 validateElementConfig の switch と同集合）。
var validElementTypes = map[string]bool{
	"slider":    true,
	"dropdown":  true,
	"text":      true,
	"textarea":  true,
	"toggle":    true,
	"composite": true,
}

// ValidationError は1件のバリデーションエラー（現行 ParameterValidationError と同形）。
type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// ValidateSchema は項目設定スキーマを検証し、エラー一覧を返す。
// エラーが空なら妥当。現行 validateParameterSchema の判定を移植する。
func ValidateSchema(data map[string]any) []ValidationError {
	var errs []ValidationError

	// schemaId
	if s, ok := data["schemaId"].(string); !ok || s == "" {
		errs = append(errs, ValidationError{Field: "schemaId", Message: "schemaId is required and must be a string"})
	}

	// schemaName (LocalizedString)
	errs = validateLocalizedString(data["schemaName"], "schemaName", errs)

	// groups
	groups, ok := data["groups"].([]any)
	if !ok {
		errs = append(errs, ValidationError{Field: "groups", Message: "groups must be an array"})
		return errs
	}
	if len(groups) > maxGroups {
		errs = append(errs, ValidationError{
			Field:   "groups",
			Message: fmt.Sprintf("Schema has %d groups, maximum is %d", len(groups), maxGroups),
		})
	}
	for _, g := range groups {
		group, ok := g.(map[string]any)
		if !ok {
			errs = append(errs, ValidationError{Field: "groups[]", Message: "group must be an object"})
			continue
		}
		errs = validateGroup(group, errs)
	}
	return errs
}

// validateGroup はグループ単体を検証する（現行 validateGroup 移植）。
func validateGroup(group map[string]any, errs []ValidationError) []ValidationError {
	groupID, _ := group["id"].(string)
	prefix := "groups." + groupID

	if groupID == "" {
		errs = append(errs, ValidationError{Field: "groups[].id", Message: "group.id is required and must be a string"})
	}
	errs = validateLocalizedString(group["displayName"], prefix+".displayName", errs)

	for _, key := range []string{"isFixed", "defaultOpen", "defaultEnabled"} {
		if _, ok := group[key].(bool); !ok {
			errs = append(errs, ValidationError{Field: prefix + "." + key, Message: "group." + key + " must be a boolean"})
		}
	}

	elements, ok := group["elements"].([]any)
	if !ok {
		errs = append(errs, ValidationError{Field: prefix + ".elements", Message: "group.elements must be an array"})
		return errs
	}
	if len(elements) > maxElementsPerGroup {
		errs = append(errs, ValidationError{
			Field:   prefix + ".elements",
			Message: fmt.Sprintf("group has %d elements, maximum is %d", len(elements), maxElementsPerGroup),
		})
	}

	// 同一グループ内の全要素 ID を収集（parentId 整合チェック用）。
	ids := make(map[string]bool, len(elements))
	for _, e := range elements {
		if el, ok := e.(map[string]any); ok {
			if id, ok := el["id"].(string); ok {
				ids[id] = true
			}
		}
	}
	for _, e := range elements {
		el, ok := e.(map[string]any)
		if !ok {
			errs = append(errs, ValidationError{Field: prefix + ".elements[]", Message: "element must be an object"})
			continue
		}
		errs = validateElement(el, groupID, ids, errs)
	}
	return errs
}

// validateElement は要素単体を検証する（現行 validateElement 移植）。
func validateElement(el map[string]any, groupID string, ids map[string]bool, errs []ValidationError) []ValidationError {
	elID, _ := el["id"].(string)
	prefix := fmt.Sprintf("groups.%s.elements.%s", groupID, elID)

	if elID == "" {
		errs = append(errs, ValidationError{Field: prefix + ".id", Message: "element.id is required and must be a string"})
	}
	elType, _ := el["type"].(string)
	if elType == "" {
		errs = append(errs, ValidationError{Field: prefix + ".type", Message: "element.type is required"})
	}
	errs = validateLocalizedString(el["displayName"], prefix+".displayName", errs)
	errs = validateLocalizedString(el["description"], prefix+".description", errs)
	if _, ok := el["promptDescription"]; ok {
		errs = validateLocalizedString(el["promptDescription"], prefix+".promptDescription", errs)
	}
	if _, ok := el["defaultValue"]; !ok {
		errs = append(errs, ValidationError{Field: prefix + ".defaultValue", Message: "element.defaultValue is required"})
	}

	// 親子関係: parentId は同一グループ内に存在すること。
	if parentID, ok := el["parentId"].(string); ok && parentID != "" {
		if !ids[parentID] {
			errs = append(errs, ValidationError{
				Field:   prefix + ".parentId",
				Message: fmt.Sprintf("parentId %q does not exist in the same group", parentID),
			})
		}
	}

	return validateElementConfig(el, elType, prefix, errs)
}

// validateElementConfig は要素タイプ別の必須フィールドを検証する（現行移植）。
func validateElementConfig(el map[string]any, elType, prefix string, errs []ValidationError) []ValidationError {
	cfg, _ := el["config"].(map[string]any)

	switch elType {
	case "slider":
		min, hasMin := numberField(cfg, "min")
		max, hasMax := numberField(cfg, "max")
		if !hasMin {
			errs = append(errs, ValidationError{Field: prefix + ".config.min", Message: "slider requires config.min"})
		}
		if !hasMax {
			errs = append(errs, ValidationError{Field: prefix + ".config.max", Message: "slider requires config.max"})
		}
		if hasMin && hasMax && min >= max {
			errs = append(errs, ValidationError{Field: prefix + ".config", Message: "slider config.min must be less than config.max"})
		}

	case "dropdown":
		opts, ok := cfg["options"].([]any)
		if !ok {
			errs = append(errs, ValidationError{Field: prefix + ".config.options", Message: "dropdown requires config.options array"})
		} else if len(opts) == 0 {
			errs = append(errs, ValidationError{Field: prefix + ".config.options", Message: "dropdown requires at least one option"})
		} else {
			for i, o := range opts {
				opt, _ := o.(map[string]any)
				field := fmt.Sprintf("%s.config.options[%d]", prefix, i)
				if opt == nil {
					errs = append(errs, ValidationError{Field: field, Message: "option must be an object"})
					continue
				}
				if _, ok := opt["value"]; !ok {
					errs = append(errs, ValidationError{Field: field + ".value", Message: "option requires value"})
				}
				errs = validateLocalizedString(opt["label"], field+".label", errs)
			}
		}

	case "composite":
		if ct, _ := cfg["compositeType"].(string); ct == "yearMonthDay" {
			for _, r := range []string{"yearRange", "monthRange", "dayRange"} {
				if !isRangePair(cfg[r]) {
					errs = append(errs, ValidationError{
						Field:   prefix + ".config." + r,
						Message: "yearMonthDay requires config." + r + " [min, max]",
					})
				}
			}
		}

	case "text", "textarea", "toggle":
		// 追加の必須フィールドなし。

	default:
		// type が未知（空含む）の場合。空は別途 element.type required で報告済みだが、
		// 非空かつ未知のタイプはここで報告する（現行 default 分岐相当）。
		if elType != "" && !validElementTypes[elType] {
			errs = append(errs, ValidationError{Field: prefix + ".type", Message: "Unknown element type: " + elType})
		}
	}
	return errs
}

// validateLocalizedString は LocalizedString（{ ja: string, en?: string }）を検証する。
// ja が文字列であることを要求する（現行 isValidLocalizedString 移植）。
func validateLocalizedString(value any, field string, errs []ValidationError) []ValidationError {
	m, ok := value.(map[string]any)
	if !ok {
		return append(errs, ValidationError{Field: field, Message: field + " must be an object with 'ja' key"})
	}
	if _, ok := m["ja"].(string); !ok {
		return append(errs, ValidationError{Field: field + ".ja", Message: field + ".ja must be a string"})
	}
	return errs
}

// numberField は cfg[key] を float64 として取り出す。JSON 数値は float64 になる。
func numberField(cfg map[string]any, key string) (float64, bool) {
	if cfg == nil {
		return 0, false
	}
	v, ok := cfg[key].(float64)
	return v, ok
}

// isRangePair は v が長さ 2 の配列（[min, max]）かを返す。
func isRangePair(v any) bool {
	arr, ok := v.([]any)
	return ok && len(arr) == 2
}
