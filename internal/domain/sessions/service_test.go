package sessions

import (
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
)

func TestSaveWritesUnifiedSessionToHistoryDir(t *testing.T) {
	t.Parallel()
	root := testRoot(t)
	service := New(paths.NewResolver(root))

	session := testSession("session-save")
	if err := service.Save(session); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	path := filepath.Join(root, filepath.FromSlash(config.UnifiedSessionsDir), "session-save.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("new unified session path was not created: %v", err)
	}
}

func TestListCopiesLegacyUnifiedSessions(t *testing.T) {
	t.Parallel()
	root := testRoot(t)
	legacyDir := filepath.Join(root, filepath.FromSlash(config.LegacyUnifiedSessionsDir))
	if err := os.MkdirAll(legacyDir, config.DirPerm); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	session := testSession("legacy-session")
	if err := jsonstore.WriteJSON(filepath.Join(legacyDir, "legacy-session.json"), session); err != nil {
		t.Fatalf("WriteJSON() error = %v", err)
	}

	service := New(paths.NewResolver(root))
	items, err := service.List()
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(items) != 1 || items[0].ID != "legacy-session" {
		t.Fatalf("List() items = %#v, want legacy-session", items)
	}

	newPath := filepath.Join(root, filepath.FromSlash(config.UnifiedSessionsDir), "legacy-session.json")
	if _, err := os.Stat(newPath); err != nil {
		t.Fatalf("legacy session was not copied to new path: %v", err)
	}
}

func TestSaveReadPreservesGenerationAndImportState(t *testing.T) {
	t.Parallel()
	root := testRoot(t)
	service := New(paths.NewResolver(root))

	session := testSession("session-generation")
	session.Generation = map[string]any{
		"gemini": map[string]any{"dummyUserId": "dummy-user"},
	}
	session.ImportState = map[string]any{
		"sourceModelType": "gemini",
		"sourceMtimeMs":   float64(123),
	}
	if err := service.Save(session); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	got, err := service.Read("session-generation")
	if err != nil {
		t.Fatalf("Read() error = %v", err)
	}
	generation := got.Generation.(map[string]any)["gemini"].(map[string]any)
	if generation["dummyUserId"] != "dummy-user" {
		t.Fatalf("generation should be preserved: %#v", got.Generation)
	}
	importState := got.ImportState.(map[string]any)
	if importState["sourceModelType"] != "gemini" || importState["sourceMtimeMs"] != float64(123) {
		t.Fatalf("importState should be preserved: %#v", got.ImportState)
	}
}

func TestDeleteRemovesCanonicalAndReturnsBindings(t *testing.T) {
	t.Parallel()
	root := testRoot(t)
	service := New(paths.NewResolver(root))

	session := testSession("session-del")
	session.Bindings.Claude = &Binding{NativeSessionID: "native-claude-del"}
	if err := service.Save(session); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	path := filepath.Join(root, filepath.FromSlash(config.UnifiedSessionsDir), "session-del.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("precondition: session file missing: %v", err)
	}

	deleted, err := service.Delete("session-del")
	if err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	if deleted.Bindings.Claude == nil || deleted.Bindings.Claude.NativeSessionID != "native-claude-del" {
		t.Errorf("Delete() must return bindings for native cleanup, got %+v", deleted.Bindings)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("canonical session file must be removed")
	}
}

func TestDeleteMissingSessionErrors(t *testing.T) {
	t.Parallel()
	service := New(paths.NewResolver(testRoot(t)))
	if _, err := service.Delete("no-such-session"); err == nil {
		t.Errorf("Delete() on missing session must error")
	}
}

func testSession(id string) UnifiedSession {
	return UnifiedSession{
		SchemaVersion: 1,
		SessionID:     id,
		Title:         "テストセッション",
		LastUpdated:   "2026-06-30T00:00:00Z",
		Bindings: Bindings{
			ActiveModelType: ModelGemini,
		},
		ContextEntries: []any{},
		Messages: []Message{
			{ID: "m1", Role: "user", Content: "こんにちは"},
		},
	}
}

func testRoot(t *testing.T) string {
	t.Helper()
	root, err := os.MkdirTemp(".", ".sessions-test-*")
	if err != nil {
		t.Fatalf("MkdirTemp() error = %v", err)
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		t.Fatalf("Abs() error = %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(abs) })
	return abs
}
