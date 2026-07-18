package presets

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	presetsvc "alslime/internal/domain/presets"
	"alslime/internal/storage/paths"
	"alslime/internal/storage/presetstore"
)

const baseDir = "ロールプレイ/グローバル/プリセット/SSRP_Mode"

// newTestMux は一時ワークスペースに紐づく SSRP_Mode 系のルートを持つ mux を返す。
func newTestMux(t *testing.T, meta presetsvc.MetaPolicy) *http.ServeMux {
	t.Helper()
	root := t.TempDir()
	resolver := paths.NewResolver(root)
	svc := presetsvc.New(presetstore.New(resolver, baseDir), meta)
	mux := http.NewServeMux()
	Register(mux, RouteSet{Kind: "presets", Service: svc})
	return mux
}

// do はリクエストを実行してレスポンスを返す。
func do(t *testing.T, mux *http.ServeMux, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body != nil {
		buf, _ := json.Marshal(body)
		r = httptest.NewRequest(method, path, bytes.NewReader(buf))
	} else {
		r = httptest.NewRequest(method, path, nil)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

// dataMap は getResponse.Data（JSON デコード後の any）を map として取り出す。
// ディレクトリ列挙型は data がオブジェクトのため、テストで中身を見るのに使う。
func dataMap(t *testing.T, g getResponse) map[string]any {
	t.Helper()
	m, ok := g.Data.(map[string]any)
	if !ok {
		t.Fatalf("data が map ではない: %#v", g.Data)
	}
	return m
}

func TestList_空は空配列(t *testing.T) {
	mux := newTestMux(t, presetsvc.MetaNone)
	w := do(t, mux, http.MethodGet, "/api/presets", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d want 200", w.Code)
	}
	var resp listResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("デコード失敗: %v body=%s", err, w.Body.String())
	}
	if resp.Presets == nil {
		t.Fatalf("presets は空配列であるべき（null 不可）: %s", w.Body.String())
	}
	if len(resp.Presets) != 0 {
		t.Fatalf("空であるべき: %#v", resp.Presets)
	}
}

func TestSaveGetListDelete_統一契約一巡(t *testing.T) {
	mux := newTestMux(t, presetsvc.MetaNone)

	// 保存（日本語名・{name, data} ボディ）。
	w := do(t, mux, http.MethodPost, "/api/presets", saveRequest{
		Name: "夜の設定",
		Data: map[string]any{"mood": "夜更かし"},
	})
	if w.Code != http.StatusOK {
		t.Fatalf("保存 status=%d want 200 body=%s", w.Code, w.Body.String())
	}
	var sresp saveResponse
	_ = json.Unmarshal(w.Body.Bytes(), &sresp)
	if !sresp.Success || sresp.Name != "夜の設定" {
		t.Fatalf("保存レスポンス想定外: %#v", sresp)
	}

	// 一覧。
	w = do(t, mux, http.MethodGet, "/api/presets", nil)
	var lresp listResponse
	_ = json.Unmarshal(w.Body.Bytes(), &lresp)
	if len(lresp.Presets) != 1 || lresp.Presets[0] != "夜の設定" {
		t.Fatalf("一覧想定外: %#v", lresp.Presets)
	}

	// 取得（{name, data} 形状）。
	w = do(t, mux, http.MethodGet, "/api/presets/"+"夜の設定", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("取得 status=%d want 200", w.Code)
	}
	var gresp getResponse
	_ = json.Unmarshal(w.Body.Bytes(), &gresp)
	if gresp.Name != "夜の設定" || dataMap(t, gresp)["mood"] != "夜更かし" {
		t.Fatalf("取得レスポンス想定外: %#v", gresp)
	}

	// 削除（{success} 形状）。
	w = do(t, mux, http.MethodDelete, "/api/presets/"+"夜の設定", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("削除 status=%d want 200", w.Code)
	}
	var dresp successResponse
	_ = json.Unmarshal(w.Body.Bytes(), &dresp)
	if !dresp.Success {
		t.Fatalf("削除レスポンス想定外: %#v", dresp)
	}
}

func TestSave_レスポンスのnameは正規化名(t *testing.T) {
	mux := newTestMux(t, presetsvc.MetaNone)
	// 前後空白付きで保存。
	w := do(t, mux, http.MethodPost, "/api/presets", saveRequest{
		Name: "  夜の設定  ",
		Data: map[string]any{"v": 1.0},
	})
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d want 200 body=%s", w.Code, w.Body.String())
	}
	var sresp saveResponse
	_ = json.Unmarshal(w.Body.Bytes(), &sresp)
	if sresp.Name != "夜の設定" {
		t.Fatalf("レスポンスの name は正規化名であるべき: got=%q", sresp.Name)
	}
	// 正本名で一覧に出る。
	w = do(t, mux, http.MethodGet, "/api/presets", nil)
	var lresp listResponse
	_ = json.Unmarshal(w.Body.Bytes(), &lresp)
	if len(lresp.Presets) != 1 || lresp.Presets[0] != "夜の設定" {
		t.Fatalf("一覧は正本名であるべき: %#v", lresp.Presets)
	}
}

func TestGet_レスポンスのnameは正規化名(t *testing.T) {
	mux := newTestMux(t, presetsvc.MetaNone)
	// 正本名で保存。
	do(t, mux, http.MethodPost, "/api/presets", saveRequest{
		Name: "夜の設定", Data: map[string]any{"v": 1.0},
	})
	// 前後空白付きパスで取得（%20 = 半角空白）。
	w := do(t, mux, http.MethodGet, "/api/presets/%20夜の設定%20", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d want 200 body=%s", w.Code, w.Body.String())
	}
	var gresp getResponse
	_ = json.Unmarshal(w.Body.Bytes(), &gresp)
	if gresp.Name != "夜の設定" {
		t.Fatalf("Get レスポンスの name は正規化名であるべき: got=%q", gresp.Name)
	}
}

func TestGet_存在しないものは404(t *testing.T) {
	mux := newTestMux(t, presetsvc.MetaNone)
	w := do(t, mux, http.MethodGet, "/api/presets/無い", nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status=%d want 404 body=%s", w.Code, w.Body.String())
	}
}

func TestDelete_存在しないものは404(t *testing.T) {
	mux := newTestMux(t, presetsvc.MetaNone)
	w := do(t, mux, http.MethodDelete, "/api/presets/無い", nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status=%d want 404", w.Code)
	}
}

func TestSave_name欠落は400(t *testing.T) {
	mux := newTestMux(t, presetsvc.MetaNone)
	w := do(t, mux, http.MethodPost, "/api/presets", map[string]any{
		"data": map[string]any{"v": 1},
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400 body=%s", w.Code, w.Body.String())
	}
}

func TestSave_data欠落は400(t *testing.T) {
	mux := newTestMux(t, presetsvc.MetaNone)
	w := do(t, mux, http.MethodPost, "/api/presets", map[string]any{
		"name": "preset",
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400 body=%s", w.Code, w.Body.String())
	}
}

func TestSave_不正名は400(t *testing.T) {
	mux := newTestMux(t, presetsvc.MetaNone)
	w := do(t, mux, http.MethodPost, "/api/presets", saveRequest{
		Name: "../etc",
		Data: map[string]any{"v": 1.0},
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400 body=%s", w.Code, w.Body.String())
	}
}

func TestSave_大文字小文字違いは409(t *testing.T) {
	mux := newTestMux(t, presetsvc.MetaNone)
	// 先に "Test" を保存。
	do(t, mux, http.MethodPost, "/api/presets", saveRequest{
		Name: "Test", Data: map[string]any{"v": 1.0},
	})
	// "test" は衝突 → 409。
	w := do(t, mux, http.MethodPost, "/api/presets", saveRequest{
		Name: "test", Data: map[string]any{"v": 2.0},
	})
	if w.Code != http.StatusConflict {
		t.Fatalf("status=%d want 409 body=%s", w.Code, w.Body.String())
	}
}

func TestSave_MetaTimestamps_data内にメタが入る(t *testing.T) {
	mux := newTestMux(t, presetsvc.MetaTimestamps)
	do(t, mux, http.MethodPost, "/api/presets", saveRequest{
		Name: "preset", Data: map[string]any{"v": 1.0},
	})
	w := do(t, mux, http.MethodGet, "/api/presets/preset", nil)
	var gresp getResponse
	_ = json.Unmarshal(w.Body.Bytes(), &gresp)
	d := dataMap(t, gresp)
	if _, ok := d["createdAt"].(string); !ok {
		t.Fatalf("MetaTimestamps では data に createdAt が入るべき: %#v", d)
	}
	if _, ok := d["updatedAt"].(string); !ok {
		t.Fatalf("MetaTimestamps では data に updatedAt が入るべき: %#v", d)
	}
}
