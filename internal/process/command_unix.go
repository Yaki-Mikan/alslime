//go:build !windows

package process

import (
	"os/exec"
	"syscall"
)

// setupProcessGroup は子プロセスを独立したプロセスグループで起動させる。
// kill 時にグループごと止めることで、CLI ランチャー配下の孫プロセス残留を防ぐ
// （従来は Process.Kill のみで、Node ランチャー等の孫が残り得た）。
func setupProcessGroup(command *exec.Cmd) {
	if command.SysProcAttr == nil {
		command.SysProcAttr = &syscall.SysProcAttr{}
	}
	command.SysProcAttr.Setpgid = true
}

// killProcessTree はプロセスグループごと SIGKILL で停止する。
// グループ kill に失敗した場合（Setpgid が効いていない等）も単体 kill は必ず行う。
func killProcessTree(command *exec.Cmd) {
	if command == nil || command.Process == nil {
		return
	}
	pid := command.Process.Pid
	if pgid, err := syscall.Getpgid(pid); err == nil && pgid == pid {
		_ = syscall.Kill(-pgid, syscall.SIGKILL)
	}
	_ = command.Process.Kill()
}
