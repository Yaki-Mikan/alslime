package apiproviders

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"

	"alslime/internal/config"
	"alslime/internal/i18n"
)

// TestModel は接続テストで取得したモデル 1 件（ピッカー用）。
type TestModel struct {
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
}

// TestResult は接続テストのレスポンス契約。
type TestResult struct {
	Success           bool        `json:"success"`
	Models            []TestModel `json:"models"`
	SupportsModelsAPI bool        `json:"supportsModelsApi"`
	MessageKey        string      `json:"messageKey,omitempty"`
	FailureKind       string      `json:"failureKind,omitempty"`
	// Details はサニタイズ済みの可変詳細。接続テストの一時表示専用で、
	// チャット履歴・ジョブ結果・セッションへ保存しない。
	Details string `json:"details,omitempty"`
}

// Test は接続先の疎通・キー有効性を確認し、モデル一覧を返す。
//
// GET {baseUrl}/models を叩く。接続先が存在しない場合のみ ErrConnectionNotFound
// を返し、疎通・認証等の失敗は TestResult（Success=false）で表す。
func (s *Service) Test(ctx context.Context, id string) (TestResult, error) {
	conn, ok, err := s.Get(id)
	if err != nil {
		return TestResult{}, err
	}
	if !ok {
		return TestResult{}, ErrConnectionNotFound
	}
	secret, _, err := s.secrets.Get(id)
	if err != nil {
		return TestResult{}, err
	}
	// 認証必須の接続でキーが無い場合、匿名公開されている /models の成功を
	// 「チャット可能な接続成功」と誤認させない。none の接続だけは無キーを許可する。
	if conn.AuthScheme != AuthSchemeNone && strings.TrimSpace(secret.APIKey) == "" {
		return failure(FailureKindAuth, i18n.KeyAPIProvidersTestKeyRequired, ""), nil
	}

	endpoint, err := ResolveEndpoint(conn.BaseURL, "models")
	if err != nil {
		return failure(FailureKindInvalidResponse, i18n.KeyAPIProvidersTestFailedOther, ""), nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return failure(FailureKindInvalidResponse, i18n.KeyAPIProvidersTestFailedOther, ""), nil
	}
	req.Header.Set("Accept", "application/json")
	ApplyAuthHeader(req.Header, conn.AuthScheme, secret.APIKey)

	client := &http.Client{
		Timeout: time.Duration(config.APIProviderTestTimeoutSeconds) * time.Second,
		// 異なる origin へのリダイレクトは拒否する（認証情報の転送防止）。
		CheckRedirect: func(next *http.Request, via []*http.Request) error {
			if len(via) > config.APIProviderTestMaxRedirects {
				return fmt.Errorf("リダイレクト回数が上限を超過")
			}
			if !SameOrigin(via[0].URL, next.URL) {
				return fmt.Errorf("異なる origin へのリダイレクトは許可しない")
			}
			return nil
		},
	}
	resp, err := client.Do(req)
	if err != nil {
		return failure(FailureKindNetwork, i18n.KeyAPIProvidersTestFailedNetwork, ""), nil
	}
	defer func() { _ = resp.Body.Close() }()

	secretsToMask := []string{secret.APIKey}
	switch {
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		details := sanitizeErrorBody(resp, secretsToMask)
		return failure(FailureKindAuth, i18n.KeyAPIProvidersTestFailedAuth, details), nil
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusMethodNotAllowed || resp.StatusCode == http.StatusNotImplemented:
		// GET /models 非対応の接続先。手入力フォールバックへ案内する。
		return TestResult{
			Success:           false,
			Models:            []TestModel{},
			SupportsModelsAPI: false,
			MessageKey:        i18n.KeyAPIProvidersTestModelsUnavailable,
			FailureKind:       FailureKindModelsUnavailable,
		}, nil
	case resp.StatusCode < 200 || resp.StatusCode > 299:
		details := sanitizeErrorBody(resp, secretsToMask)
		return failure(FailureKindInvalidResponse, i18n.KeyAPIProvidersTestFailedOther, details), nil
	}

	models, err := decodeModelList(resp.Body)
	if err != nil {
		return failure(FailureKindInvalidResponse, i18n.KeyAPIProvidersTestFailedOther, ""), nil
	}
	return TestResult{Success: true, Models: models, SupportsModelsAPI: true}, nil
}

func failure(kind, messageKey, details string) TestResult {
	return TestResult{
		Success:     false,
		Models:      []TestModel{},
		MessageKey:  messageKey,
		FailureKind: kind,
		Details:     details,
	}
}

// ApplyAuthHeader は AuthScheme に応じた認証ヘッダーを付与する。
func ApplyAuthHeader(h http.Header, scheme, apiKey string) {
	switch scheme {
	case AuthSchemeBearer:
		h.Set("Authorization", "Bearer "+apiKey)
	case AuthSchemeAPIKeyHeader:
		h.Set("api-key", apiKey)
	case AuthSchemeXAPIKeyHeader:
		h.Set("x-api-key", apiKey)
	case AuthSchemeNone:
		// 認証ヘッダーなし。
	}
}

// SameOrigin は 2 つの URL が同一 origin（scheme・hostname・port）かを返す。
// HTTPS→HTTP のダウングレードは scheme 不一致として拒否される。
func SameOrigin(a, b *url.URL) bool {
	return strings.EqualFold(a.Scheme, b.Scheme) &&
		strings.EqualFold(a.Hostname(), b.Hostname()) &&
		portOrDefault(a) == portOrDefault(b)
}

func portOrDefault(u *url.URL) string {
	if p := u.Port(); p != "" {
		return p
	}
	switch strings.ToLower(u.Scheme) {
	case "https":
		return "443"
	case "http":
		return "80"
	}
	return ""
}

// decodeModelList は GET /models 応答（{"data":[{"id","name"}]}）を読む。
//
// 上限判定は「上限+1 バイトまで読み、長さを検査してから decode」する。
// Decoder を LimitReader へ直結すると、先頭に完結 JSON があった場合に後続の
// 超過分を検出できないため。
func decodeModelList(body io.Reader) ([]TestModel, error) {
	raw, err := io.ReadAll(io.LimitReader(body, config.APIProviderTestMaxModelsBodyBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > config.APIProviderTestMaxModelsBodyBytes {
		return nil, errors.New("apiproviders: models 応答が上限を超過")
	}
	var payload struct {
		Data []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	if payload.Data == nil {
		return nil, errors.New("apiproviders: models 応答に data がない")
	}
	out := make([]TestModel, 0, len(payload.Data))
	for _, m := range payload.Data {
		id := strings.TrimSpace(m.ID)
		if id == "" {
			continue
		}
		out = append(out, TestModel{ID: id, Name: strings.TrimSpace(m.Name)})
	}
	return out, nil
}

// sanitizeErrorBody はエラーボディから表示可能な details を作る。
//
// 処理順序は次に固定: 1) 上限付き読み取り → 2) error.message のみ抽出
// （非 JSON・途中切断 JSON は中立文言化）→ 3) 秘密値の完全一致マスク →
// 4) 制御文字除去 → 5) 文字数上限で切り詰め（マスクを切り詰めより先に行う）。
func sanitizeErrorBody(resp *http.Response, secrets []string) string {
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, config.APIProviderTestMaxErrorBodyBytes+1))
	truncated := len(raw) > config.APIProviderTestMaxErrorBodyBytes

	neutral := fmt.Sprintf("HTTP %d (%s)", resp.StatusCode, strings.TrimSpace(resp.Header.Get("Content-Type")))

	message := ""
	if !truncated {
		message = extractErrorMessage(raw)
	}
	if message == "" {
		return sanitizeText(neutral, secrets)
	}
	return sanitizeText(message, secrets)
}

// extractErrorMessage は JSON ボディから error.message（または error 文字列）だけを
// 抽出する。構文不正・非 JSON は空を返す（中立文言へフォールバック）。
func extractErrorMessage(raw []byte) string {
	var payload struct {
		Error json.RawMessage `json:"error"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil || len(payload.Error) == 0 {
		return ""
	}
	var asString string
	if err := json.Unmarshal(payload.Error, &asString); err == nil {
		return strings.TrimSpace(asString)
	}
	var asObject struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(payload.Error, &asObject); err == nil {
		return strings.TrimSpace(asObject.Message)
	}
	return ""
}

// sanitizeText はマスク→制御文字除去→切り詰めを順に適用する。
func sanitizeText(text string, secrets []string) string {
	// 3) 完全一致マスク（Bearer 形式含む。空文字の秘密値は対象にしない）。
	for _, secret := range secrets {
		if secret == "" {
			continue
		}
		text = strings.ReplaceAll(text, "Bearer "+secret, "[MASKED]")
		text = strings.ReplaceAll(text, secret, "[MASKED]")
	}
	// 4) 制御文字（改行・タブ以外）を除去。
	text = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' {
			return r
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, text)
	// 5) 最後に文字数上限で切り詰める（マスクより後。秘密断片を残さない）。
	runes := []rune(text)
	if len(runes) > config.APIProviderTestMaxDetailChars {
		return string(runes[:config.APIProviderTestMaxDetailChars])
	}
	return text
}
