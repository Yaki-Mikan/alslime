// Package auth は Firebase Authentication の IDトークン検証ミドルウェアを提供する。
//
// 責務: FIREBASE_PROJECT_ID が設定された公開運用（Lightsail 等）で、/api/* への
// リクエストの Authorization: Bearer <IDトークン> を検証する。検証は Google の
// securetoken 公開証明書（x509）による RS256 署名検証と iss/aud/exp/sub の
// クレーム検証で行い、外部 SDK には依存しない。
// FIREBASE_PROJECT_ID 未設定時はこのパッケージ自体を組み込まない
// （ローカル利用は従来どおり認証なし。判断は app 側が行う）。
package auth

import (
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
)

// clockSkew は exp/iat 検証で許容する時計ずれ。
const clockSkew = 5 * time.Minute

// certsFallbackTTL は Cache-Control が読めなかった場合の証明書キャッシュ保持時間。
const certsFallbackTTL = 30 * time.Minute

// Middleware は Firebase IDトークン検証の本体。
type Middleware struct {
	projectID   string
	allowedUIDs map[string]struct{}

	mu        sync.Mutex
	certs     map[string]*rsa.PublicKey
	certsWait time.Time // このキャッシュの有効期限
	client    *http.Client
	now       func() time.Time
}

// New は検証ミドルウェアを組み立てる。projectID は空であってはならない。
func New(projectID string, allowedUIDs []string) *Middleware {
	uidSet := make(map[string]struct{}, len(allowedUIDs))
	for _, uid := range allowedUIDs {
		uidSet[uid] = struct{}{}
	}
	return &Middleware{
		projectID:   projectID,
		allowedUIDs: uidSet,
		client:      &http.Client{Timeout: 10 * time.Second},
		now:         time.Now,
	}
}

// Wrap は /api/* へ IDトークン検証を挟んだハンドラを返す。
// フロント静的配信（/api 以外）はログイン画面自体の配信が必要なため検証しない。
// GET /api/health のみ疎通確認用に素通しする。
func (m *Middleware) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, config.APIPrefix+"/") && r.URL.Path != config.APIPrefix {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method == http.MethodGet && r.URL.Path == config.APIPrefix+"/health" {
			next.ServeHTTP(w, r)
			return
		}

		token, ok := bearerToken(r)
		if !ok {
			_ = apiresponse.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized: No token provided"})
			return
		}
		uid, err := m.verifyIDToken(token)
		if err != nil {
			_ = apiresponse.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized: Invalid token"})
			return
		}
		if len(m.allowedUIDs) > 0 {
			if _, allowed := m.allowedUIDs[uid]; !allowed {
				_ = apiresponse.WriteJSON(w, http.StatusForbidden, map[string]string{"error": "Forbidden: User not allowed"})
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// bearerToken は Authorization ヘッダから Bearer トークンを取り出す。
func bearerToken(r *http.Request) (string, bool) {
	header := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return "", false
	}
	token := strings.TrimSpace(header[len(prefix):])
	return token, token != ""
}

// idTokenClaims は検証に使う最小限のクレーム。
type idTokenClaims struct {
	Iss string `json:"iss"`
	Aud string `json:"aud"`
	Exp int64  `json:"exp"`
	Iat int64  `json:"iat"`
	Sub string `json:"sub"`
}

// verifyIDToken は Firebase IDトークンを検証し、成功時に UID（sub）を返す。
func (m *Middleware) verifyIDToken(token string) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", errors.New("トークンが JWT 形式ではない")
	}

	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", fmt.Errorf("ヘッダの base64 復号に失敗: %w", err)
	}
	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := json.Unmarshal(headerJSON, &header); err != nil {
		return "", fmt.Errorf("ヘッダの JSON 解釈に失敗: %w", err)
	}
	if header.Alg != "RS256" {
		return "", fmt.Errorf("未対応の署名アルゴリズム: %q", header.Alg)
	}

	key, err := m.publicKey(header.Kid)
	if err != nil {
		return "", err
	}

	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return "", fmt.Errorf("署名の base64 復号に失敗: %w", err)
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], sig); err != nil {
		return "", fmt.Errorf("署名検証に失敗: %w", err)
	}

	payloadJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("ペイロードの base64 復号に失敗: %w", err)
	}
	var claims idTokenClaims
	if err := json.Unmarshal(payloadJSON, &claims); err != nil {
		return "", fmt.Errorf("クレームの JSON 解釈に失敗: %w", err)
	}

	now := m.now()
	if claims.Exp <= 0 || now.After(time.Unix(claims.Exp, 0).Add(clockSkew)) {
		return "", errors.New("トークンの有効期限切れ")
	}
	if claims.Iat > 0 && time.Unix(claims.Iat, 0).After(now.Add(clockSkew)) {
		return "", errors.New("トークンの発行時刻が未来")
	}
	if claims.Aud != m.projectID {
		return "", fmt.Errorf("aud が一致しない: %q", claims.Aud)
	}
	if claims.Iss != config.FirebaseIssuerPrefix+m.projectID {
		return "", fmt.Errorf("iss が一致しない: %q", claims.Iss)
	}
	if claims.Sub == "" {
		return "", errors.New("sub が空")
	}
	return claims.Sub, nil
}

// publicKey は kid に対応する Google 公開証明書の RSA 公開鍵を返す。
// 証明書は Cache-Control の max-age に従いメモリキャッシュする。
func (m *Middleware) publicKey(kid string) (*rsa.PublicKey, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.certs == nil || m.now().After(m.certsWait) {
		certs, ttl, err := m.fetchCerts()
		if err != nil {
			// 取得失敗時、期限切れでも手元のキャッシュがあれば継続利用する
			// （Google 側の一時障害で全リクエストを落とさないため）。
			if m.certs == nil {
				return nil, err
			}
		} else {
			m.certs = certs
			m.certsWait = m.now().Add(ttl)
		}
	}

	key, ok := m.certs[kid]
	if !ok {
		return nil, fmt.Errorf("kid %q に対応する公開鍵が見つからない", kid)
	}
	return key, nil
}

// fetchCerts は Google の公開証明書一覧を取得し、kid→RSA公開鍵の表と
// Cache-Control 由来のキャッシュ保持時間を返す。
func (m *Middleware) fetchCerts() (map[string]*rsa.PublicKey, time.Duration, error) {
	resp, err := m.client.Get(config.FirebaseSecureTokenCertsURL)
	if err != nil {
		return nil, 0, fmt.Errorf("公開証明書の取得に失敗: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, 0, fmt.Errorf("公開証明書の取得が HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, 0, fmt.Errorf("公開証明書の読み取りに失敗: %w", err)
	}
	var raw map[string]string
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, 0, fmt.Errorf("公開証明書の JSON 解釈に失敗: %w", err)
	}

	certs := make(map[string]*rsa.PublicKey, len(raw))
	for kid, pemText := range raw {
		block, _ := pem.Decode([]byte(pemText))
		if block == nil {
			continue
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			continue
		}
		if pub, ok := cert.PublicKey.(*rsa.PublicKey); ok {
			certs[kid] = pub
		}
	}
	if len(certs) == 0 {
		return nil, 0, errors.New("有効な公開証明書が 1 件も得られなかった")
	}
	return certs, cacheTTL(resp.Header.Get("Cache-Control")), nil
}

// cacheTTL は Cache-Control ヘッダの max-age を解釈する。読めなければ既定値。
func cacheTTL(header string) time.Duration {
	for _, part := range strings.Split(header, ",") {
		part = strings.TrimSpace(part)
		if rest, ok := strings.CutPrefix(part, "max-age="); ok {
			if sec, err := strconv.Atoi(rest); err == nil && sec > 0 {
				return time.Duration(sec) * time.Second
			}
		}
	}
	return certsFallbackTTL
}
