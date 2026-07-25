// Package configgenjobs は設定ファイル自動作成 API からジョブ実行器へ渡す
// ペイロード契約と成果物パス規則を定義する（chatjobs と同じ配置規則）。
//
// パス規則は API 層（事前検証・調査メモ取得）と core 側 Runner（出力先指定・
// 書き込み検証）の双方が参照するため、本パッケージに正本を置く。
package configgenjobs

// 調査メモの配置規則（参考用テンプレートの既存運用に合わせた命名）。
const (
	ResearchDirName    = "設定作成前資料"
	ResearchMemoSuffix = "_設定作成前メモ"
)

// 専用作業ワークスペース（レビュー001対応 1章）。
//
// AI CLI の cwd はこのディレクトリになり、ルート直下のルールファイル
// （CLAUDE.md / GEMINI.md。firstrun が初回のみ配置、以後ユーザーが管理）を読む。
// AI の書き込み先は WorkspaceOutputsDir/<jobId>/ 配下に限定し、
// 検証後にサーバーが正規位置へ移動する。
const (
	WorkspaceDir        = "configgen_workspace"
	WorkspaceOutputsDir = "configgen_workspace/outputs"
)

// ResearchMemoRelPath は調査メモの WORKSPACE_ROOT 相対パス（スラッシュ区切り）。
func ResearchMemoRelPath(categoryDir, dirName, characterName string) string {
	return categoryDir + "/" + dirName + "/" + ResearchDirName + "/" + characterName + ResearchMemoSuffix + ".md"
}

// SettingRelPath は設定ファイルの WORKSPACE_ROOT 相対パス（既存キャラ設定規約と同一）。
func SettingRelPath(categoryDir, dirName, fileName string) string {
	return categoryDir + "/" + dirName + "/settings/" + fileName + ".md"
}

// Method は作成方式。
const (
	// MethodTwoStep はじっくり作成（2段階。1段階目=調査、2段階目=設定作成）。
	MethodTwoStep = "two_step"
	// MethodOneShot は一括作成（調査から設定ファイル作成まで 1 回で行う）。
	MethodOneShot = "one_shot"
)

// Payload は config-generate ジョブの実行指定。
//
// 設定ファイルの配置は常にキャラクター名基準（characters/<キャラ名>/settings/<キャラ名>.md）。
// DirName は調査メモの所在追跡にのみ使う（旧データはキャラ名と異なり得る）。
type Payload struct {
	CategoryID    string `json:"categoryId"`
	Method        string `json:"method"`
	Step          int    `json:"step,omitempty"` // two_step のみ 1 | 2
	CharacterName string `json:"characterName"`
	WorkTitle     string `json:"workTitle"`
	DirName       string `json:"dirName"`
	Model         string `json:"model,omitempty"`
	ClaudeEffort   string `json:"claudeEffort,omitempty"`
	TimeoutMinutes int    `json:"timeoutMinutes,omitempty"`
	Locale         string `json:"locale,omitempty"`
	// Notes は設定作成備考（ユーザーの要望・指示。指示ファイルへ結合される）。
	Notes string `json:"notes,omitempty"`
}

// ResultFile はジョブ完走時に jobs.Result.Output へ JSON で格納する成果物情報。
// フロントはこれを使って設定エディタへ生成ファイルを読み込む。
type ResultFile struct {
	// Kind は成果物の種類。"research"（調査メモ）| "setting"（設定ファイル）。
	Kind string `json:"kind"`
	// CategoryID / DirName / FileName は config-editor API での取得キー（setting のとき）。
	CategoryID string `json:"categoryId"`
	DirName    string `json:"dirName"`
	FileName   string `json:"fileName"`
	// RelPath は WORKSPACE_ROOT 相対の実パス（research の取得や表示に使う）。
	RelPath string `json:"relPath"`
}
