package apiproviders

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"alslime/internal/config"
)

func errorResponse(status int, contentType, body string) *http.Response {
	header := http.Header{}
	header.Set("Content-Type", contentType)
	return &http.Response{
		StatusCode: status,
		Header:     header,
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestSanitizeText_マスクを切り詰めより先に行う(t *testing.T) {
	// 秘密値が表示上限境界をまたいでも断片が残らない（マスク後に切り詰めるため）。
	// 検証文字 Z は置換後の "[MASKED]" に含まれない文字を選ぶ。
	secret := strings.Repeat("Z", 40)
	padding := strings.Repeat("x", config.APIProviderTestMaxDetailChars-20)
	got := sanitizeText(padding+"key="+secret+" trailing", []string{secret})
	if strings.Contains(got, "Z") {
		t.Fatalf("秘密値の断片が残っている: %q", got)
	}
	if len([]rune(got)) > config.APIProviderTestMaxDetailChars {
		t.Fatalf("文字数上限を超過: %d", len([]rune(got)))
	}
}

func TestSanitizeText_Bearer形式と空秘密値と制御文字(t *testing.T) {
	got := sanitizeText("auth Bearer sk-abc raw sk-abc\x00\x1b end", []string{"sk-abc", ""})
	if strings.Contains(got, "sk-abc") {
		t.Fatalf("Bearer 形式・生値ともマスクされるべき: %q", got)
	}
	if strings.ContainsAny(got, "\x00\x1b") {
		t.Fatalf("制御文字は除去されるべき: %q", got)
	}
	// 空文字の秘密値は置換対象にしない。
	if got := sanitizeText("plain", []string{""}); got != "plain" {
		t.Fatalf("空秘密値で本文が壊れた: %q", got)
	}
}

func TestExtractErrorMessage(t *testing.T) {
	if got := extractErrorMessage([]byte(`{"error":{"message":"quota exceeded"}}`)); got != "quota exceeded" {
		t.Fatalf("object 形式: %q", got)
	}
	if got := extractErrorMessage([]byte(`{"error":"plain error"}`)); got != "plain error" {
		t.Fatalf("string 形式: %q", got)
	}
	for name, raw := range map[string]string{
		"非JSON":    "<html>oops</html>",
		"途中切断JSON": `{"error":{"message":"trunc`,
		"errorなし":  `{"ok":true}`,
	} {
		if got := extractErrorMessage([]byte(raw)); got != "" {
			t.Fatalf("%s は空（中立文言へフォールバック）のはず: %q", name, got)
		}
	}
}

func TestSanitizeErrorBody_上限境界(t *testing.T) {
	// 上限内: JSON として完結していれば error.message を抽出できる。
	message := "boundary ok"
	got := sanitizeErrorBody(errorResponse(429, "application/json", `{"error":{"message":"`+message+`"}}`), nil)
	if got != message {
		t.Fatalf("上限内 JSON は message 抽出のはず: %q", got)
	}

	// 上限+1 超過: 部分本文を表示に使わず中立文言（HTTP ステータス＋Content-Type）へ。
	huge := `{"error":{"message":"` + strings.Repeat("a", config.APIProviderTestMaxErrorBodyBytes) + `"}}`
	got = sanitizeErrorBody(errorResponse(502, "application/json", huge), nil)
	if !strings.Contains(got, "HTTP 502") || strings.Contains(got, "aaa") {
		t.Fatalf("超過は中立文言のはず: %q", got)
	}

	// 非 JSON（HTML 等）も全文を保存せず中立文言へ。
	got = sanitizeErrorBody(errorResponse(500, "text/html", "<html>secret path /var/www</html>"), nil)
	if !strings.Contains(got, "HTTP 500") || strings.Contains(got, "/var/www") {
		t.Fatalf("非 JSON は中立文言のはず: %q", got)
	}
}

func TestSanitizeErrorBody_キー値反射のマスク(t *testing.T) {
	got := sanitizeErrorBody(
		errorResponse(401, "application/json", `{"error":{"message":"bad key sk-reflected here"}}`),
		[]string{"sk-reflected"},
	)
	if strings.Contains(got, "sk-reflected") || !strings.Contains(got, "[MASKED]") {
		t.Fatalf("反射キーがマスクされるべき: %q", got)
	}
}
