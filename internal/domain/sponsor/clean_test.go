package sponsor

import (
	"context"
	"errors"
	"testing"
)

// モジュール変更操作の排他（TryLock。交換日記 005-3）。

func TestModuleOperations_進行中はErrModuleBusy(t *testing.T) {
	svc, _ := newTestService(t, "")

	// 別の操作がロックを保持している状況を再現する。
	svc.moduleOpMu.Lock()
	defer svc.moduleOpMu.Unlock()

	if _, err := svc.InstallModule(context.Background(), "comfy"); !errors.Is(err, ErrModuleBusy) {
		t.Fatalf("進行中の InstallModule が ErrModuleBusy にならなかった: %v", err)
	}
	if _, err := svc.CleanModule(context.Background(), "comfy", true); !errors.Is(err, ErrModuleBusy) {
		t.Fatalf("進行中の CleanModule が ErrModuleBusy にならなかった: %v", err)
	}
}
