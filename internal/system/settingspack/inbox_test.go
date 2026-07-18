package settingspack

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"alslime/internal/config"
)

// placeInboxZip は inbox へテスト用 zip を配置する。
func placeInboxZip(t *testing.T, root, name string, entries map[string]string) {
	t.Helper()
	src := writeZip(t, t.TempDir(), entries)
	destDir := filepath.Join(root, filepath.FromSlash(config.SettingsPackInboxDir))
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		t.Fatalf("MkdirAll 失敗: %v", err)
	}
	data, err := os.ReadFile(src)
	if err != nil {
		t.Fatalf("zip 読み取り失敗: %v", err)
	}
	if err := os.WriteFile(filepath.Join(destDir, name), data, 0o644); err != nil {
		t.Fatalf("zip 配置失敗: %v", err)
	}
}

func listDir(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		t.Fatalf("ReadDir 失敗: %v", err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

func TestProcessInbox_取り込みと移動(t *testing.T) {
	m, root := newTestManager(t)
	writeWorkspaceFile(t, root, "roleplay/global/situations/既存.md", "古い内容")

	placeInboxZip(t, root, "a_ok.zip", map[string]string{
		"roleplay/global/situations/新規.md": "新規内容",
		"roleplay/global/situations/既存.md": "パック内容",
	})
	placeInboxZip(t, root, "b_auth.zip", map[string]string{
		"roleplay/auth/token": "secret",
	})
	// 壊れた zip（zip ですらないファイル）。
	brokenDir := filepath.Join(root, filepath.FromSlash(config.SettingsPackInboxDir))
	if err := os.WriteFile(filepath.Join(brokenDir, "c_broken.zip"), []byte("not a zip"), 0o644); err != nil {
		t.Fatalf("broken zip 配置失敗: %v", err)
	}

	report := m.ProcessInbox(false)
	if report.ErrorKey != "" {
		t.Fatalf("ErrorKey が入っている: %+v", report)
	}
	if len(report.Items) != 3 {
		t.Fatalf("3 件処理されるべき: %+v", report.Items)
	}

	// a_ok: 新規のみ書かれ、衝突はスキップ。
	if report.Items[0].File != "a_ok.zip" || report.Items[0].MessageKey != "settingsPack.imported" ||
		report.Items[0].Written != 1 || report.Items[0].Skipped != 1 {
		t.Fatalf("a_ok の結果が不正: %+v", report.Items[0])
	}
	if got := readWorkspaceFile(t, root, "roleplay/global/situations/新規.md"); got != "新規内容" {
		t.Fatalf("新規が書かれていない: %q", got)
	}
	if got := readWorkspaceFile(t, root, "roleplay/global/situations/既存.md"); got != "古い内容" {
		t.Fatalf("inbox は既存を変更してはいけない: %q", got)
	}

	// b_auth: 全体拒否・一切書かれない。
	if report.Items[1].MessageKey != "settingsPack.blocked.auth" {
		t.Fatalf("auth 入りは拒否キーのはず: %+v", report.Items[1])
	}
	if _, err := os.Stat(filepath.Join(root, "roleplay", "auth", "token")); !os.IsNotExist(err) {
		t.Fatal("auth 配下が書かれている")
	}

	// c_broken: 読めない zip はエラーキー。
	if report.Items[2].MessageKey != "settingsPack.error.manifestInvalid" {
		t.Fatalf("壊れた zip はエラーキーのはず: %+v", report.Items[2])
	}

	// 全件 processed/ へ移動し、inbox 直下は空になる。
	inboxNames := listDir(t, filepath.Join(root, filepath.FromSlash(config.SettingsPackInboxDir)))
	for _, n := range inboxNames {
		if strings.HasSuffix(n, ".zip") {
			t.Fatalf("inbox に zip が残っている: %v", inboxNames)
		}
	}
	processedNames := listDir(t, filepath.Join(root, filepath.FromSlash(config.SettingsPackInboxProcessedDir)))
	if len(processedNames) != 3 {
		t.Fatalf("processed へ 3 件移動されるべき: %v", processedNames)
	}

	// ログが追記される。
	logData, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(config.SettingsPackInboxLogFile)))
	if err != nil || !strings.Contains(string(logData), "a_ok.zip") {
		t.Fatalf("ログが書かれていない: err=%v data=%q", err, logData)
	}

	// 2回目の起動: 対象なし → 空レポート・再適用なし。
	report = m.ProcessInbox(false)
	if len(report.Items) != 0 || report.Deferred != 0 {
		t.Fatalf("2回目は空のはず: %+v", report)
	}
}

func TestProcessInbox_上限超過は持ち越し(t *testing.T) {
	m, root := newTestManager(t)
	total := config.SettingsPackInboxMaxPerBoot + 2
	for i := 0; i < total; i++ {
		placeInboxZip(t, root, "pack_"+string(rune('a'+i))+".zip", map[string]string{
			"roleplay/global/situations/f" + string(rune('a'+i)) + ".md": "内容",
		})
	}
	report := m.ProcessInbox(false)
	if len(report.Items) != config.SettingsPackInboxMaxPerBoot || report.Deferred != 2 {
		t.Fatalf("上限件数処理＋2件持ち越しのはず: items=%d deferred=%d", len(report.Items), report.Deferred)
	}
	// 持ち越し分は inbox に残る。
	names := listDir(t, filepath.Join(root, filepath.FromSlash(config.SettingsPackInboxDir)))
	zipCount := 0
	for _, n := range names {
		if strings.HasSuffix(n, ".zip") {
			zipCount++
		}
	}
	if zipCount != 2 {
		t.Fatalf("持ち越し 2 件が inbox に残るべき: %v", names)
	}
}

func TestProcessInbox_processedの保持期限掃除(t *testing.T) {
	m, root := newTestManager(t)
	processedDir := filepath.Join(root, filepath.FromSlash(config.SettingsPackInboxProcessedDir))
	if err := os.MkdirAll(processedDir, 0o755); err != nil {
		t.Fatalf("MkdirAll 失敗: %v", err)
	}
	oldZip := filepath.Join(processedDir, "old.zip")
	newZip := filepath.Join(processedDir, "new.zip")
	if err := os.WriteFile(oldZip, []byte("x"), 0o644); err != nil {
		t.Fatalf("WriteFile 失敗: %v", err)
	}
	if err := os.WriteFile(newZip, []byte("x"), 0o644); err != nil {
		t.Fatalf("WriteFile 失敗: %v", err)
	}
	// old.zip の mtime を保持期限より過去にする。
	past := time.Now().Add(-time.Duration(config.SettingsPackInboxProcessedMaxAgeSeconds+3600) * time.Second)
	if err := os.Chtimes(oldZip, past, past); err != nil {
		t.Fatalf("Chtimes 失敗: %v", err)
	}

	_ = m.ProcessInbox(false)

	if _, err := os.Stat(oldZip); !os.IsNotExist(err) {
		t.Fatal("期限切れの processed zip は削除されるべき")
	}
	if _, err := os.Stat(newZip); err != nil {
		t.Fatal("期限内の processed zip は残るべき")
	}
}
