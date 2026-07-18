package parameters

import "testing"

// validGroup は最小の妥当なグループを返す。
func validGroup(id string) map[string]any {
	return map[string]any{
		"id":             id,
		"displayName":    map[string]any{"ja": "グループ"},
		"isFixed":        false,
		"defaultOpen":    true,
		"defaultEnabled": true,
		"elements":       []any{},
	}
}

// validSchema は最小の妥当なスキーマを返す。
func validSchema() map[string]any {
	return map[string]any{
		"schemaId":   "default",
		"schemaName": map[string]any{"ja": "デフォルト"},
		"groups":     []any{validGroup("g1")},
	}
}

func TestValidateSchema_妥当なスキーマ(t *testing.T) {
	if errs := ValidateSchema(validSchema()); len(errs) != 0 {
		t.Fatalf("妥当なスキーマでエラー: %#v", errs)
	}
}

func TestValidateSchema_schemaName欠落(t *testing.T) {
	s := validSchema()
	delete(s, "schemaName")
	if errs := ValidateSchema(s); len(errs) == 0 {
		t.Fatalf("schemaName 欠落は拒否すべき")
	}
}

func TestValidateSchema_LocalizedString_ja必須(t *testing.T) {
	s := validSchema()
	s["schemaName"] = map[string]any{"en": "default"} // ja 無し
	if errs := ValidateSchema(s); len(errs) == 0 {
		t.Fatalf("schemaName.ja 欠落は拒否すべき")
	}
}

func TestValidateSchema_groups上限(t *testing.T) {
	s := validSchema()
	groups := make([]any, maxGroups+1)
	for i := range groups {
		groups[i] = validGroup("g")
	}
	s["groups"] = groups
	if errs := ValidateSchema(s); len(errs) == 0 {
		t.Fatalf("groups 上限超過は拒否すべき")
	}
}

func TestValidateSchema_elements上限(t *testing.T) {
	s := validSchema()
	g := validGroup("g1")
	elements := make([]any, maxElementsPerGroup+1)
	for i := range elements {
		elements[i] = map[string]any{
			"id":           "e",
			"type":         "toggle",
			"displayName":  map[string]any{"ja": "x"},
			"description":  map[string]any{"ja": "x"},
			"defaultValue": false,
		}
	}
	g["elements"] = elements
	s["groups"] = []any{g}
	if errs := ValidateSchema(s); len(errs) == 0 {
		t.Fatalf("elements 上限超過は拒否すべき")
	}
}

func TestValidateSchema_slider必須フィールド(t *testing.T) {
	s := validSchema()
	g := validGroup("g1")
	g["elements"] = []any{
		map[string]any{
			"id":           "sl",
			"type":         "slider",
			"displayName":  map[string]any{"ja": "x"},
			"description":  map[string]any{"ja": "x"},
			"defaultValue": 0.0,
			// config.min / max 欠落
		},
	}
	s["groups"] = []any{g}
	if errs := ValidateSchema(s); len(errs) == 0 {
		t.Fatalf("slider の min/max 欠落は拒否すべき")
	}
}

func TestValidateSchema_slider_min_max逆転(t *testing.T) {
	s := validSchema()
	g := validGroup("g1")
	g["elements"] = []any{
		map[string]any{
			"id":           "sl",
			"type":         "slider",
			"displayName":  map[string]any{"ja": "x"},
			"description":  map[string]any{"ja": "x"},
			"defaultValue": 0.0,
			"config":       map[string]any{"min": 10.0, "max": 5.0},
		},
	}
	s["groups"] = []any{g}
	if errs := ValidateSchema(s); len(errs) == 0 {
		t.Fatalf("slider の min>=max は拒否すべき")
	}
}

func TestValidateSchema_parentId整合(t *testing.T) {
	s := validSchema()
	g := validGroup("g1")
	g["elements"] = []any{
		map[string]any{
			"id":           "child",
			"type":         "toggle",
			"displayName":  map[string]any{"ja": "x"},
			"description":  map[string]any{"ja": "x"},
			"defaultValue": false,
			"parentId":     "存在しない親",
		},
	}
	s["groups"] = []any{g}
	if errs := ValidateSchema(s); len(errs) == 0 {
		t.Fatalf("存在しない parentId は拒否すべき")
	}
}

func TestValidateSchema_未知のelementタイプ(t *testing.T) {
	s := validSchema()
	g := validGroup("g1")
	g["elements"] = []any{
		map[string]any{
			"id":           "x",
			"type":         "unknown-type",
			"displayName":  map[string]any{"ja": "x"},
			"description":  map[string]any{"ja": "x"},
			"defaultValue": nil,
		},
	}
	s["groups"] = []any{g}
	if errs := ValidateSchema(s); len(errs) == 0 {
		t.Fatalf("未知の element タイプは拒否すべき")
	}
}

func TestValidateSchema_dropdown_options必須(t *testing.T) {
	s := validSchema()
	g := validGroup("g1")
	g["elements"] = []any{
		map[string]any{
			"id":           "dd",
			"type":         "dropdown",
			"displayName":  map[string]any{"ja": "x"},
			"description":  map[string]any{"ja": "x"},
			"defaultValue": "a",
			"config":       map[string]any{"options": []any{}}, // 空
		},
	}
	s["groups"] = []any{g}
	if errs := ValidateSchema(s); len(errs) == 0 {
		t.Fatalf("dropdown の空 options は拒否すべき")
	}
}
