package sponsor

import (
	"context"
	"errors"
	"os"
	"path/filepath"

	"alslime/internal/logging"
	"alslime/internal/storage/safename"
)

// サイドカーのクリーン再導入（ファイル自動更新、確認 01番 7章）。
//
// companion pack の取り込みは既存テンプレートを上書きしない（PolicySkip）ため、
// 通常の更新ではテンプレートが古いまま残る。配布物一式を消してから入れ直す
// 本処理が、最新サンプルへ完全リフレッシュする唯一の手段になる。
//
// 削除対象はレシートに記録した配布物のみ。ユーザーが別名で自作したテンプレートは
// レシートに載らないため触れない。レシートが無い旧環境では、何を配布したか
// 確定できないためテンプレートには触れず、exe とレシートだけを対象にする（安全側）。

// ErrModuleCleanFailed はクリーン処理（削除フェーズ）の失敗。
var ErrModuleCleanFailed = errors.New("sponsor: module clean failed")

// CleanPreview はクリーン再導入の削除対象（確認モーダルの表示用）。
type CleanPreview struct {
	ID           string `json:"id"`
	ExeInstalled bool   `json:"exeInstalled"`
	ReceiptFound bool   `json:"receiptFound"`
	// WorkflowTemplates は削除される workflow テンプレート名（レシート記録分）。
	WorkflowTemplates []string `json:"workflowTemplates"`
}

// CleanPreviewFor は指定モジュールの削除対象一覧を返す（削除は行わない）。
func (s *Service) CleanPreviewFor(moduleID string) (CleanPreview, error) {
	target, ok := s.modules[moduleID]
	if !ok {
		return CleanPreview{}, ErrModuleUnknown
	}
	preview := CleanPreview{ID: moduleID, WorkflowTemplates: []string{}}
	if _, err := os.Stat(target.InstallPath); err == nil {
		preview.ExeInstalled = true
	}
	if receipt, receiptOK := s.readReceipt(target.ReceiptPath); receiptOK {
		preview.ReceiptFound = true
		if receipt.CompanionPack != nil && target.WorkflowTemplateDir != "" {
			for _, name := range receipt.CompanionPack.Files {
				if validated, err := safename.Validate(name); err == nil && validated == name {
					preview.WorkflowTemplates = append(preview.WorkflowTemplates, name)
				}
			}
		}
	}
	return preview, nil
}

// CleanModule は配布物一式（テンプレート → exe → レシート）を削除し、
// reinstall が true なら続けて最新版を配置する。
// 同時実行は ErrModuleBusy で拒否する（install と同じ排他境界。交換日記 005-3）。
func (s *Service) CleanModule(ctx context.Context, moduleID string, reinstall bool) (ModuleInstallResult, error) {
	if !s.moduleOpMu.TryLock() {
		return ModuleInstallResult{}, ErrModuleBusy
	}
	defer s.moduleOpMu.Unlock()

	target, ok := s.modules[moduleID]
	if !ok {
		return ModuleInstallResult{}, ErrModuleUnknown
	}

	// 1. workflow テンプレートの削除（レシート記録分のみ。名前は safename 検証を
	//    通ったものだけを使い、削除先の組み立てにパス走査が混じらないようにする）。
	if receipt, receiptOK := s.readReceipt(target.ReceiptPath); receiptOK &&
		receipt.CompanionPack != nil && target.WorkflowTemplateDir != "" {
		for _, name := range receipt.CompanionPack.Files {
			validated, err := safename.Validate(name)
			if err != nil || validated != name {
				logging.Info("sponsor: module %s clean skipped unsafe template name %q", moduleID, name)
				continue
			}
			dir := filepath.Join(target.WorkflowTemplateDir, name)
			if err := os.RemoveAll(dir); err != nil {
				return ModuleInstallResult{}, errors.Join(ErrModuleCleanFailed, err)
			}
		}
	}

	// 2. exe の削除。実行中（Active）の Windows では削除できないため、
	//    失敗時は .old へ待避する（起動時掃除 module.CleanupStaleFiles が回収）。
	if _, err := os.Stat(target.InstallPath); err == nil {
		if err := os.Remove(target.InstallPath); err != nil {
			oldPath := target.InstallPath + ".old"
			_ = os.Remove(oldPath)
			if renameErr := os.Rename(target.InstallPath, oldPath); renameErr != nil {
				return ModuleInstallResult{}, errors.Join(ErrModuleCleanFailed, renameErr)
			}
		}
	}

	// 3. レシートの削除（未作成は無視）。
	if target.ReceiptPath != "" {
		if err := os.Remove(target.ReceiptPath); err != nil && !os.IsNotExist(err) {
			return ModuleInstallResult{}, errors.Join(ErrModuleCleanFailed, err)
		}
	}
	logging.Info("sponsor: module %s cleaned", moduleID)

	// 4. 再導入（最新版の取得・検証・配置・レシート再作成）。
	// ロック取得済みのため内部実体を直接呼ぶ（公開 InstallModule 経由だと
	// TryLock が自分のロックと競合して常に ErrModuleBusy になる）。
	if !reinstall {
		return ModuleInstallResult{}, nil
	}
	return s.installModuleLocked(ctx, moduleID)
}
