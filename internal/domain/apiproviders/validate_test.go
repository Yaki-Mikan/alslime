package apiproviders

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateBaseURL(t *testing.T) {
	cases := []struct {
		name    string
		input   string
		want    string
		wantErr error
	}{
		{"https許可", "https://openrouter.ai/api/v1", "https://openrouter.ai/api/v1", nil},
		{"末尾スラッシュ正規化", "https://api.example.com/v1/", "https://api.example.com/v1", nil},
		{"複数末尾スラッシュ正規化", "https://api.example.com/v1///", "https://api.example.com/v1", nil},
		{"http localhost許可", "http://localhost:8080/v1", "http://localhost:8080/v1", nil},
		{"http 127.0.0.1許可", "http://127.0.0.1:1234", "http://127.0.0.1:1234", nil},
		{"http IPv6ループバック許可", "http://[::1]:8080", "http://[::1]:8080", nil},
		{"http 外部ホスト拒否", "http://example.com/v1", "", ErrHTTPNotAllowed},
		{"userinfo拒否", "https://user:pass@example.com/v1", "", ErrInvalidBaseURL},
		{"query拒否", "https://example.com/v1?key=x", "", ErrInvalidBaseURL},
		{"fragment拒否", "https://example.com/v1#frag", "", ErrInvalidBaseURL},
		{"scheme不正拒否", "ftp://example.com/v1", "", ErrInvalidBaseURL},
		{"ホスト無し拒否", "https:///v1", "", ErrInvalidBaseURL},
		{"空拒否", "  ", "", ErrInvalidBaseURL},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := ValidateBaseURL(c.input)
			if !errors.Is(err, c.wantErr) {
				t.Fatalf("err = %v, want %v", err, c.wantErr)
			}
			if got != c.want {
				t.Fatalf("got = %q, want %q", got, c.want)
			}
		})
	}
}

func TestResolveEndpoint_既存pathを保持する(t *testing.T) {
	cases := []struct {
		base    string
		segment string
		want    string
	}{
		{"https://openrouter.ai/api/v1", "chat/completions", "https://openrouter.ai/api/v1/chat/completions"},
		{"https://api.deepseek.com", "models", "https://api.deepseek.com/models"},
		{"https://example.com/deep/path", "models", "https://example.com/deep/path/models"},
	}
	for _, c := range cases {
		got, err := ResolveEndpoint(c.base, c.segment)
		if err != nil {
			t.Fatalf("ResolveEndpoint(%q) failed: %v", c.base, err)
		}
		if got != c.want {
			t.Fatalf("ResolveEndpoint(%q, %q) = %q, want %q", c.base, c.segment, got, c.want)
		}
	}
}

func TestValidateExtraParams(t *testing.T) {
	cases := []struct {
		name    string
		params  map[string]any
		wantErr error
	}{
		{"通常キー許可", map[string]any{"temperature": 0.7, "reasoning_effort": "high"}, nil},
		{"予約キーmodel拒否", map[string]any{"model": "x"}, ErrExtraParamsReservedKey},
		{"予約キーmessages拒否", map[string]any{"messages": []any{}}, ErrExtraParamsReservedKey},
		{"予約キーstream拒否", map[string]any{"stream": false}, ErrExtraParamsReservedKey},
		{"予約キー大小文字無視", map[string]any{"Stream_Options": map[string]any{}}, ErrExtraParamsReservedKey},
		{"キャッシュ識別子拒否", map[string]any{"prompt_cache_key": "x"}, ErrExtraParamsReservedKey},
		{"秘密キーapi_key拒否", map[string]any{"api_key": "sk-x"}, ErrExtraParamsSecretKey},
		{"秘密キーauthorization拒否", map[string]any{"Authorization": "Bearer x"}, ErrExtraParamsSecretKey},
		{"空キー拒否", map[string]any{"  ": "x"}, ErrExtraParamsEmptyKey},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if err := ValidateExtraParams(c.params); !errors.Is(err, c.wantErr) {
				t.Fatalf("err = %v, want %v", err, c.wantErr)
			}
		})
	}
}

func TestValidateRemoteModelID(t *testing.T) {
	if got, err := ValidateRemoteModelID("  deepseek/deepseek-chat-v3 "); err != nil || got != "deepseek/deepseek-chat-v3" {
		t.Fatalf("トリム済みIDが返るべき: got=%q err=%v", got, err)
	}
	for name, input := range map[string]string{
		"空拒否":    "   ",
		"制御文字拒否": "model\x00id",
		"長さ超過拒否": strings.Repeat("a", 257),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := ValidateRemoteModelID(input); !errors.Is(err, ErrRemoteModelInvalid) {
				t.Fatalf("ErrRemoteModelInvalid のはず: %v", err)
			}
		})
	}
}

func TestPresetCatalog(t *testing.T) {
	// 5 プリセット・表示順・固定プリセット基本指示は 3 種のみ。
	presets := Presets()
	if len(presets) != 5 {
		t.Fatalf("プリセットは5種のはず: %d", len(presets))
	}
	wantOrder := []string{PresetOpenRouter, PresetOpenAI, PresetDeepSeek, PresetOpenCodeGo, PresetCustom}
	for i, want := range wantOrder {
		if presets[i].ID != want {
			t.Fatalf("表示順が不正: idx=%d got=%q want=%q", i, presets[i].ID, want)
		}
	}
	instr := InstructionPresetIDs()
	if len(instr) != 3 {
		t.Fatalf("固定プリセット基本指示は3種のはず: %v", instr)
	}
	for _, id := range instr {
		if id == PresetOpenAI || id == PresetCustom {
			t.Fatalf("openai / custom は固定プリセット基本指示を持たない: %v", instr)
		}
	}
	// custom は baseUrl 既定なし・失敗時手入力フォールバックの前提で models API 対応扱い。
	if custom, ok := PresetByID(PresetCustom); !ok || custom.BaseURL != "" || !custom.SupportsModelsAPI {
		t.Fatalf("custom プリセットの既定が不正: %+v", custom)
	}
}
