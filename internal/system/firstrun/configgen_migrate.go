package firstrun

import (
	"bytes"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"

	"alslime/internal/config"
	"alslime/internal/domain/configeditor"
)

// MigrateConfigGenLayout は設定自動生成の指示・テンプレート群を
// 旧構成（<対象>/<locale>/... と <対象>/<方式>.<locale>.md）から
// 新構成（<locale>/<対象>/...）へ転置する。起動時のほか、旧構成の
// 設定パック取込後の寄せ直しにも使う。
//
// 利用者ファイルの保全を最優先とし、内容の書き換えは一切行わない。
//   - 移動は「新位置へコピー → 内容検証 → 旧位置を削除」の順で行い、
//     途中で失敗しても内容の消失・破損が起きない。
//   - 移動先に既にファイルがある場合は移動せず旧ファイルを残す。
//   - 既知の対象・ロケール・方式に一致しないファイルは触らない。
//   - 移動が済んで空になった旧ディレクトリだけを削除する。
//
// 新構成のワークスペースでは旧構成のディレクトリが存在せず何もしないため冪等。
func MigrateConfigGenLayout(workspaceRoot string) error {
	root := filepath.Join(workspaceRoot, filepath.FromSlash(config.ConfigGenPromptsDir))
	if _, err := os.Stat(root); errors.Is(err, fs.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}

	methods := []string{
		configeditor.ConfigGenMethodSearchTemplate,
		configeditor.ConfigGenMethodSettingTemplate,
		configeditor.ConfigGenMethodTwoStep1,
		configeditor.ConfigGenMethodTwoStep2,
		configeditor.ConfigGenMethodOneShot,
		configeditor.ConfigGenMethodDialog,
	}
	templateDirs := []string{"search_templates", "setting_templates"}

	for _, c := range configeditor.Categories() {
		oldTargetDir := filepath.Join(root, c.ID)
		if _, err := os.Stat(oldTargetDir); errors.Is(err, fs.ErrNotExist) {
			continue
		} else if err != nil {
			return err
		}
		for _, loc := range configeditor.ConfigGenInstructionLocales {
			newTargetDir := filepath.Join(root, loc, c.ID)
			for _, td := range templateDirs {
				if err := moveDirFiles(filepath.Join(oldTargetDir, loc, td), filepath.Join(newTargetDir, td)); err != nil {
					return err
				}
			}
			if err := removeIfEmptyDir(filepath.Join(oldTargetDir, loc)); err != nil {
				return err
			}
			for _, m := range methods {
				if err := moveFileKeepExisting(filepath.Join(oldTargetDir, m+"."+loc+".md"), filepath.Join(newTargetDir, m+".md")); err != nil {
					return err
				}
			}
		}
		if err := removeIfEmptyDir(oldTargetDir); err != nil {
			return err
		}
	}
	return migrateConfigGenDefaults(filepath.Join(root, "_defaults.json"))
}

// moveFileKeepExisting は src を dst へ移す。src が無ければ何もしない。
// dst が既にあれば移動せず src を残す。コピー後に内容一致を検証してから src を消す。
func moveFileKeepExisting(src, dst string) error {
	data, err := os.ReadFile(src)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	if _, err := os.Stat(dst); err == nil {
		return nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), config.DirPerm); err != nil {
		return err
	}
	if err := os.WriteFile(dst, data, config.FilePerm); err != nil {
		return err
	}
	written, err := os.ReadFile(dst)
	if err != nil {
		return err
	}
	if !bytes.Equal(data, written) {
		return errors.New("firstrun: configgen 移行のコピー検証に失敗: " + dst)
	}
	return os.Remove(src)
}

// moveDirFiles は oldDir 直下のファイルを newDir へ移す。oldDir が無ければ何もしない。
// サブディレクトリは既知の構成に無いため触らない。移動後に空になれば oldDir を消す。
func moveDirFiles(oldDir, newDir string) error {
	entries, err := os.ReadDir(oldDir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if err := moveFileKeepExisting(filepath.Join(oldDir, e.Name()), filepath.Join(newDir, e.Name())); err != nil {
			return err
		}
	}
	return removeIfEmptyDir(oldDir)
}

// removeIfEmptyDir は空ディレクトリのみ削除する。無い・空でない場合は何もしない。
func removeIfEmptyDir(dir string) error {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	if len(entries) > 0 {
		return nil
	}
	return os.Remove(dir)
}

// migrateConfigGenDefaults は _defaults.json の旧ネスト（対象 → 言語 → 種類）を
// 検出した場合のみ、新ネスト（言語 → 対象 → 種類）へ転置する。
// 最上位キーに既知の対象 ID が無ければ旧形式ではないとみなし何もしない。
// 既知の対象 ID 以外の最上位キーは転置せずそのまま持ち越す。
func migrateConfigGenDefaults(path string) error {
	raw, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	var parsed map[string]json.RawMessage
	if err := json.Unmarshal(raw, &parsed); err != nil {
		// 破損ファイルは読み込み側が空フォールバックするため、移行では触らない。
		return nil
	}
	oldForm := false
	for key := range parsed {
		if _, ok := configeditor.FindCategory(key); ok {
			oldForm = true
			break
		}
	}
	if !oldForm {
		return nil
	}
	out := map[string]map[string]json.RawMessage{}
	carried := map[string]json.RawMessage{}
	for key, value := range parsed {
		if _, ok := configeditor.FindCategory(key); !ok {
			carried[key] = value
			continue
		}
		var byLocale map[string]json.RawMessage
		if err := json.Unmarshal(value, &byLocale); err != nil {
			carried[key] = value
			continue
		}
		for locale, kinds := range byLocale {
			if out[locale] == nil {
				out[locale] = map[string]json.RawMessage{}
			}
			out[locale][key] = kinds
		}
	}
	merged := map[string]any{}
	for locale, byTarget := range out {
		merged[locale] = byTarget
	}
	for key, value := range carried {
		if _, exists := merged[key]; !exists {
			merged[key] = value
		}
	}
	data, err := json.MarshalIndent(merged, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), config.FilePerm)
}
