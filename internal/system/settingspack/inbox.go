package settingspack

// import_inbox（「置くだけ」取り込み。設計 §5）。
//
// roleplay/import_inbox/ 直下の zip を起動時に1回だけ走査して取り込む。
// 常駐監視はしない。適用は「新規のみ・衝突全スキップ」固定で、無確認でも
// 既存ファイルを一切変更しない。処理した zip は成功・失敗を問わず
// processed/ へタイムスタンプ付きで移動し、再処理を防ぐ。
// processed/ 配下は保持期限（mtime ベース）を超えたものをここで削除する
// （ハウスキーピングの対象は roleplay/temp のみのため）。

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"alslime/internal/config"
)

// InboxItem は起動時取り込みの結果1件（zip 1個分）。
type InboxItem struct {
	// File は inbox に置かれていた zip 名。
	File string `json:"file"`
	// MessageKey は結果の i18n キー（成功: settingsPack.imported、
	// 拒否: settingsPack.blocked.* / settingsPack.error.*、想定外: settingsPack.inbox.failed）。
	MessageKey string `json:"messageKey"`
	// Written / Skipped は取り込み・スキップの件数（成功時のみ）。
	Written int `json:"written"`
	Skipped int `json:"skipped"`
}

// InboxReport は起動時取り込みの結果全体（/api/settings-pack/inbox で返す）。
type InboxReport struct {
	// ProcessedAt は処理時刻（RFC3339）。
	ProcessedAt string `json:"processedAt"`
	// Items は処理した zip の結果（処理順）。
	Items []InboxItem `json:"items"`
	// Deferred は上限超過で次回起動へ持ち越した zip 数。
	Deferred int `json:"deferred"`
	// ErrorKey は inbox 自体を処理できなかった場合の i18n キー（通常は空）。
	ErrorKey string `json:"errorKey,omitempty"`
}

const inboxFailedKey = "settingsPack.inbox.failed"

// ProcessInbox は inbox を1回走査して取り込む（起動時に呼ぶ）。
//
// inbox / processed ディレクトリが無ければ作成する（「置くだけ」フォルダを
// 初回起動から見つけられるようにする）。エラーはレポートへ集約し、
// 起動自体は止めない（戻り値はエラーを持たない）。
func (m *Manager) ProcessInbox(imageGenAllowed bool) InboxReport {
	report := InboxReport{
		ProcessedAt: m.now().Format(time.RFC3339),
		Items:       []InboxItem{},
	}
	inboxAbs, err := m.resolver.ResolveDirForMkdirAll(config.SettingsPackInboxDir, config.DirPerm)
	if err != nil {
		report.ErrorKey = inboxFailedKey
		return report
	}
	processedAbs, err := m.resolver.ResolveDirForMkdirAll(config.SettingsPackInboxProcessedDir, config.DirPerm)
	if err != nil {
		report.ErrorKey = inboxFailedKey
		return report
	}

	zips, err := listInboxZips(inboxAbs)
	if err != nil {
		report.ErrorKey = inboxFailedKey
		return report
	}
	if len(zips) > config.SettingsPackInboxMaxPerBoot {
		report.Deferred = len(zips) - config.SettingsPackInboxMaxPerBoot
		zips = zips[:config.SettingsPackInboxMaxPerBoot]
	}

	for _, name := range zips {
		item := InboxItem{File: name}
		result, err := m.Import(filepath.Join(inboxAbs, name), ImportOptions{
			// 無確認適用のため「新規のみ・衝突全スキップ」固定（設計 §5）。
			Policy:          PolicySkip,
			ImageGenAllowed: imageGenAllowed,
		})
		if err != nil {
			item.MessageKey = inboxMessageKey(err)
		} else {
			item.MessageKey = result.MessageKey
			item.Written = len(result.Written)
			item.Skipped = len(result.Skipped)
		}
		// 成功・失敗を問わず processed/ へ移動する（壊れた zip が毎起動
		// 再試行され続けるのを防ぐ）。移動に失敗した場合だけ inbox に残る。
		if err := moveToProcessed(inboxAbs, processedAbs, name, m.now()); err != nil {
			item.MessageKey = inboxFailedKey
		}
		report.Items = append(report.Items, item)
	}

	m.cleanProcessed(processedAbs)
	m.appendInboxLog(report)
	return report
}

// listInboxZips は inbox 直下の zip 名を名前順で返す（ディレクトリ・symlink 除外）。
func listInboxZips(inboxAbs string) ([]string, error) {
	entries, err := os.ReadDir(inboxAbs)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".zip") {
			continue
		}
		info, err := e.Info()
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			continue
		}
		names = append(names, e.Name())
	}
	sort.Strings(names)
	return names, nil
}

// inboxMessageKey は Import のエラーを表示用の i18n キーへ丸める。
// domain 層のエラーは Error() がそのままキー（settingsPack.*）になっている。
func inboxMessageKey(err error) string {
	if msg := err.Error(); strings.HasPrefix(msg, "settingsPack.") {
		return msg
	}
	return inboxFailedKey
}

// moveToProcessed は zip を processed/ へタイムスタンプ付きで移動する。
func moveToProcessed(inboxAbs, processedAbs, name string, now time.Time) error {
	base := now.Format("20060102-150405") + "_" + name
	dest := filepath.Join(processedAbs, base)
	for n := 2; ; n++ {
		if _, err := os.Lstat(dest); errors.Is(err, fs.ErrNotExist) {
			break
		}
		if n >= 1000 {
			return fmt.Errorf("settingspack: processed の空き名を確保できない: %s", name)
		}
		dest = filepath.Join(processedAbs, fmt.Sprintf("%d_%s", n, base))
	}
	return os.Rename(filepath.Join(inboxAbs, name), dest)
}

// cleanProcessed は processed/ 配下の保持期限切れ zip を削除する。
// 掃除の失敗は取り込み結果に影響させない（次回起動で再試行される）。
func (m *Manager) cleanProcessed(processedAbs string) {
	entries, err := os.ReadDir(processedAbs)
	if err != nil {
		return
	}
	cutoff := m.now().Add(-time.Duration(config.SettingsPackInboxProcessedMaxAgeSeconds) * time.Second)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			continue
		}
		if info.ModTime().Before(cutoff) {
			_ = os.Remove(filepath.Join(processedAbs, e.Name()))
		}
	}
}

// appendInboxLog は取り込み結果を roleplay/log/import_inbox.log へ追記する。
// ログ書き込みの失敗で取り込み自体は失敗させない。
func (m *Manager) appendInboxLog(report InboxReport) {
	if len(report.Items) == 0 && report.Deferred == 0 && report.ErrorKey == "" {
		return
	}
	abs, err := m.resolver.ResolveForCreateMkdirAll(config.SettingsPackInboxLogFile, config.DirPerm)
	if err != nil {
		return
	}
	f, err := os.OpenFile(abs, os.O_APPEND|os.O_CREATE|os.O_WRONLY, config.FilePerm)
	if err != nil {
		return
	}
	defer func() { _ = f.Close() }()

	var b strings.Builder
	for _, item := range report.Items {
		fmt.Fprintf(&b, "%s\t%s\t%s\twritten=%d\tskipped=%d\n",
			report.ProcessedAt, item.File, item.MessageKey, item.Written, item.Skipped)
	}
	if report.Deferred > 0 {
		fmt.Fprintf(&b, "%s\tdeferred=%d\n", report.ProcessedAt, report.Deferred)
	}
	if report.ErrorKey != "" {
		fmt.Fprintf(&b, "%s\terror=%s\n", report.ProcessedAt, report.ErrorKey)
	}
	_, _ = f.WriteString(b.String())
}
