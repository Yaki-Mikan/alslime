package configeditor

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	storage "alslime/internal/storage/configeditor"
	"alslime/internal/storage/paths"
)

func newService(t *testing.T) (*Service, string) {
	t.Helper()
	root := t.TempDir()
	real, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	return New(storage.New(paths.NewResolver(real))), real
}

func TestCategories(t *testing.T) {
	cats := Categories()
	if len(cats) != 10 {
		t.Fatalf("カテゴリは 10 件のはず: %d", len(cats))
	}
	// character は isCharacter、Label と TemplateDirName が分離されていること。
	c, ok := FindCategory("character")
	if !ok || !c.IsCharacter {
		t.Fatalf("character カテゴリ想定外: %#v", c)
	}
	if c.Label == "" || c.TemplateDirName == "" {
		t.Fatalf("Label / TemplateDirName が空: %#v", c)
	}
	// writingStyle は settingspack の種別 ID と互換の ID で、SSRP と同じ保存先を指すこと。
	w, ok := FindCategory("writingStyle")
	if !ok || w.IsCharacter {
		t.Fatalf("writingStyle カテゴリ想定外: %#v", w)
	}
	if w.Dir != "roleplay/global/writing_styles" || w.TemplateDirName != "writing_styles" {
		t.Fatalf("writingStyle の保存先想定外: %#v", w)
	}
}

func TestFile_非characterのCRUD(t *testing.T) {
	svc, _ := newService(t)
	// situation は非 character（<dir>/<name>.md）。
	if err := svc.WriteFile("situation", "学校", "学校", "# 学校の設定"); err != nil {
		t.Fatalf("Write: %v", err)
	}
	// 一覧に出る（dirName == name）。
	files, err := svc.ListFiles("situation")
	if err != nil {
		t.Fatalf("ListFiles: %v", err)
	}
	if len(files) != 1 || files[0].Name != "学校" || files[0].DirName != "学校" {
		t.Fatalf("一覧想定外: %#v", files)
	}
	// 取得。
	content, err := svc.ReadFile("situation", "学校", "学校")
	if err != nil || content != "# 学校の設定" {
		t.Fatalf("Read 想定外: content=%q err=%v", content, err)
	}
	// 存在確認。
	if ok, _ := svc.FileExists("situation", "学校", "学校"); !ok {
		t.Fatalf("exists=true のはず")
	}
	// 削除。
	if err := svc.DeleteFile("situation", "学校", "学校"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := svc.ReadFile("situation", "学校", "学校"); err == nil {
		t.Fatalf("削除後の Read はエラーのはず")
	}
}

func TestFile_characterのパス形(t *testing.T) {
	svc, root := newService(t)
	// character は <dir>/<dirName>/settings/<fileName>.md。dirName != fileName あり得る。
	if err := svc.WriteFile("character", "雪", "雪_裏設定", "secret"); err != nil {
		t.Fatalf("Write: %v", err)
	}
	// 実ファイルが想定位置にあること。
	want := filepath.Join(root, "roleplay", "characters", "雪", "settings", "雪_裏設定.md")
	if _, err := os.Stat(want); err != nil {
		t.Fatalf("character のパスが想定外: %v", err)
	}
	// 一覧に dirName=雪 / name=雪_裏設定 で出る。
	files, _ := svc.ListFiles("character")
	if len(files) != 1 || files[0].DirName != "雪" || files[0].Name != "雪_裏設定" {
		t.Fatalf("character 一覧想定外: %#v", files)
	}
}

func TestFile_未知カテゴリは400相当(t *testing.T) {
	svc, _ := newService(t)
	if _, err := svc.ListFiles("nope"); !errors.Is(err, ErrUnknownCategory) {
		t.Fatalf("未知カテゴリは ErrUnknownCategory: %v", err)
	}
}

func TestFile_不正名は拒否(t *testing.T) {
	svc, _ := newService(t)
	// 非 character は dirName を使わない（<dir>/<fileName>.md）。fileName を検証する。
	if err := svc.WriteFile("situation", "x", "../etc", "y"); err == nil {
		t.Fatalf("不正 fileName は拒否すべき")
	}
	// character は dirName が実パスに使われるため検証する。
	if err := svc.WriteFile("character", "../etc", "x", "y"); err == nil {
		t.Fatalf("character の不正 dirName は拒否すべき")
	}
	if err := svc.WriteFile("character", "雪", "../etc", "y"); err == nil {
		t.Fatalf("character の不正 fileName は拒否すべき")
	}
}

func TestFileExists_境界外はエラー(t *testing.T) {
	svc, _ := newService(t)
	// character の dirName が脱出を試みる場合、exists は false に潰さずエラーを返す
	// （safename 検証で弾かれ、handler は 400/403 へ。燈レビュー34 指摘1）。
	if _, err := svc.FileExists("character", "../etc", "x"); err == nil {
		t.Fatalf("不正 dirName の FileExists はエラーを返すべき")
	}
}

func TestListCharacterFiles_不正dirNameはスキップ(t *testing.T) {
	svc, root := newService(t)
	// 正規のキャラと、不正名（".." 含み）のキャラディレクトリを手で置く。
	for _, dir := range []string{"雪", "a..b"} {
		settings := filepath.Join(root, "roleplay", "characters", dir, "settings")
		if err := os.MkdirAll(settings, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(settings, "設定.md"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	files, err := svc.ListFiles("character")
	if err != nil {
		t.Fatalf("ListFiles: %v", err)
	}
	// 不正 dirName（a..b）はスキップされ、雪だけ残る。
	for _, f := range files {
		if f.DirName == "a..b" {
			t.Fatalf("不正 dirName が一覧に出ている: %#v", files)
		}
	}
	if len(files) != 1 || files[0].DirName != "雪" {
		t.Fatalf("一覧想定外: %#v", files)
	}
}

func TestTemplate_CRUDと初期本文(t *testing.T) {
	svc, _ := newService(t)

	// テンプレ 1 件保存。
	if err := svc.WriteTemplate("worldview", "ファンタジー", "# 剣と魔法"); err != nil {
		t.Fatalf("WriteTemplate: %v", err)
	}
	names, _ := svc.ListTemplates("worldview")
	if len(names) != 1 || names[0] != "ファンタジー" {
		t.Fatalf("テンプレ一覧想定外: %#v", names)
	}

	// テンプレ 1 件のみ → 初期本文に自動適用される（現行フォールバック）。
	content, err := svc.InitialContent("worldview")
	if err != nil || content != "# 剣と魔法" {
		t.Fatalf("初期本文（1件自動適用）想定外: content=%q err=%v", content, err)
	}
}

func TestDefaults_設定と初期本文優先(t *testing.T) {
	svc, _ := newService(t)
	// 2 件テンプレ。
	_ = svc.WriteTemplate("stage", "教室", "# 教室")
	_ = svc.WriteTemplate("stage", "屋上", "# 屋上")

	// 2 件あると自動適用されない → defaults 未設定なら初期本文は空。
	if c, _ := svc.InitialContent("stage"); c != "" {
		t.Fatalf("2件・defaults未設定の初期本文は空のはず: %q", c)
	}

	// defaults に「屋上」を設定 → 初期本文は屋上。
	if err := svc.SaveDefault("stage", "屋上"); err != nil {
		t.Fatalf("SaveDefault: %v", err)
	}
	if c, _ := svc.InitialContent("stage"); c != "# 屋上" {
		t.Fatalf("defaults 優先の初期本文想定外: %q", c)
	}

	// defaults 取得。
	d, _ := svc.Defaults()
	if d["stage"] != "屋上" {
		t.Fatalf("defaults 想定外: %#v", d)
	}
}

func TestSaveDefault_未知カテゴリと不正名(t *testing.T) {
	svc, _ := newService(t)
	if err := svc.SaveDefault("nope", "x"); !errors.Is(err, ErrUnknownCategory) {
		t.Fatalf("未知カテゴリは ErrUnknownCategory: %v", err)
	}
	if err := svc.SaveDefault("stage", "../etc"); err == nil {
		t.Fatalf("不正 templateName は拒否すべき")
	}
	// 空 templateName は許可（デフォルト解除）。
	if err := svc.SaveDefault("stage", ""); err != nil {
		t.Fatalf("空 templateName は許可すべき: %v", err)
	}
}

func TestWriteFileUnique_重複時リネーム(t *testing.T) {
	svc, _ := newService(t)

	// 空きなら指定名のまま保存される。
	name, err := svc.WriteFileUnique("situation", "カフェ", "内容1")
	if err != nil || name != "カフェ" {
		t.Fatalf("初回は指定名のはず: name=%q err=%v", name, err)
	}
	// 同名なら「名前 (2)」へリネームされ、既存は変わらない。
	name, err = svc.WriteFileUnique("situation", "カフェ", "内容2")
	if err != nil || name != "カフェ (2)" {
		t.Fatalf("2回目は連番リネームのはず: name=%q err=%v", name, err)
	}
	name, err = svc.WriteFileUnique("situation", "カフェ", "内容3")
	if err != nil || name != "カフェ (3)" {
		t.Fatalf("3回目は (3) のはず: name=%q err=%v", name, err)
	}
	content, err := svc.ReadFile("situation", "カフェ", "カフェ")
	if err != nil || content != "内容1" {
		t.Fatalf("既存が変わっている: content=%q err=%v", content, err)
	}
	content, err = svc.ReadFile("situation", "カフェ (2)", "カフェ (2)")
	if err != nil || content != "内容2" {
		t.Fatalf("リネーム先の内容が不正: content=%q err=%v", content, err)
	}

	// character カテゴリでも dirName == fileName の規約で保存される。
	name, err = svc.WriteFileUnique("character", "雪", "# 雪")
	if err != nil || name != "雪" {
		t.Fatalf("character 初回: name=%q err=%v", name, err)
	}
	name, err = svc.WriteFileUnique("character", "雪", "# 雪2")
	if err != nil || name != "雪 (2)" {
		t.Fatalf("character 2回目: name=%q err=%v", name, err)
	}
	if content, err := svc.ReadFile("character", "雪 (2)", "雪 (2)"); err != nil || content != "# 雪2" {
		t.Fatalf("character リネーム先が不正: content=%q err=%v", content, err)
	}

	// 未知カテゴリは ErrUnknownCategory。
	if _, err := svc.WriteFileUnique("unknown", "x", "y"); !errors.Is(err, ErrUnknownCategory) {
		t.Fatalf("未知カテゴリはエラーのはず: %v", err)
	}
}

func TestProviderInstructions_一覧と読み書き(t *testing.T) {
	svc, root := newService(t)

	// 定義は 3 件（antigravity / claude / gemini）。
	list, err := svc.ListProviderInstructions()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 3 {
		t.Fatalf("3 件のはず: %d", len(list))
	}
	for _, p := range list {
		if p.Exists {
			t.Fatalf("未作成なのに exists=true: %#v", p)
		}
	}

	// 未作成の読み取りは空文字（404 にしない）。
	content, err := svc.ReadProviderInstruction("claude")
	if err != nil || content != "" {
		t.Fatalf("未作成は空のはず: content=%q err=%v", content, err)
	}

	// 書き込み → WORKSPACE_ROOT 直下の固定名に保存される。
	if err := svc.WriteProviderInstruction("claude", "# 指示"); err != nil {
		t.Fatalf("Write: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(root, "CLAUDE.md"))
	if err != nil || string(data) != "# 指示" {
		t.Fatalf("CLAUDE.md へ保存されるはず: data=%q err=%v", data, err)
	}
	content, err = svc.ReadProviderInstruction("claude")
	if err != nil || content != "# 指示" {
		t.Fatalf("Read: content=%q err=%v", content, err)
	}
	list, _ = svc.ListProviderInstructions()
	for _, p := range list {
		if p.ID == "claude" && !p.Exists {
			t.Fatalf("書き込み後は exists=true のはず: %#v", p)
		}
	}

	// 未知 ID は ErrUnknownProviderInstruction。
	if _, err := svc.ReadProviderInstruction("unknown"); !errors.Is(err, ErrUnknownProviderInstruction) {
		t.Fatalf("未知 ID はエラーのはず: %v", err)
	}
	if err := svc.WriteProviderInstruction("unknown", "x"); !errors.Is(err, ErrUnknownProviderInstruction) {
		t.Fatalf("未知 ID はエラーのはず: %v", err)
	}

	// Antigravity は入れ子パス（.agents/rules/AGENTS.md）へ親ディレクトリごと作成される。
	if err := svc.WriteProviderInstruction("antigravity", "# ルール"); err != nil {
		t.Fatalf("Write(antigravity): %v", err)
	}
	data, err = os.ReadFile(filepath.Join(root, ".agents", "rules", "AGENTS.md"))
	if err != nil || string(data) != "# ルール" {
		t.Fatalf(".agents/rules/AGENTS.md へ保存されるはず: data=%q err=%v", data, err)
	}
}

func TestComfyDirectives_一覧と読み書き(t *testing.T) {
	svc, root := newService(t)

	list, err := svc.ListComfyDirectives()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("2 件のはず: %d", len(list))
	}

	// 未作成の読み取りは空文字。
	content, err := svc.ReadComfyDirective("danbooru")
	if err != nil || content != "" {
		t.Fatalf("未作成は空のはず: content=%q err=%v", content, err)
	}

	// 書き込み → ComfyUI ディレクトリ配下の固定名に保存される。
	if err := svc.WriteComfyDirective("danbooru", "# directive"); err != nil {
		t.Fatalf("Write: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(root, "roleplay", "global", "ComfyUI", "image_gen_directive.md"))
	if err != nil || string(data) != "# directive" {
		t.Fatalf("image_gen_directive.md へ保存されるはず: data=%q err=%v", data, err)
	}
	if content, err := svc.ReadComfyDirective("danbooru"); err != nil || content != "# directive" {
		t.Fatalf("Read: content=%q err=%v", content, err)
	}

	// 未知 ID は ErrUnknownComfyDirective。
	if _, err := svc.ReadComfyDirective("unknown"); !errors.Is(err, ErrUnknownComfyDirective) {
		t.Fatalf("未知 ID はエラーのはず: %v", err)
	}
}
