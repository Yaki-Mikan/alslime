//go:build windows

package process

import (
	"os/exec"
	"strconv"
)

// setupProcessGroup は Windows では何もしない（停止は taskkill /T がツリーごと担う）。
func setupProcessGroup(*exec.Cmd) {}

// killProcessTree は taskkill /T /F でプロセスツリーごと停止する。
func killProcessTree(command *exec.Cmd) {
	if command == nil || command.Process == nil {
		return
	}
	_ = exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(command.Process.Pid)).Run()
	_ = command.Process.Kill()
}
