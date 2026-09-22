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
	// WorkspaceSessionsDir は対話作成のセッション履歴（中間ファイル）の置き場。
	// 1 セッション = 1 JSON。ファイル内容の写しは持たず、正本は正規位置の設定ファイル。
	WorkspaceSessionsDir = "configgen_workspace/sessions"
)

// ResearchMemoRelPath は調査メモの WORKSPACE_ROOT 相対パス（スラッシュ区切り）。
func ResearchMemoRelPath(categoryDir, dirName, characterName string) string {
	return categoryDir + "/" + dirName + "/" + ResearchDirName + "/" + characterName + ResearchMemoSuffix + ".md"
}

// SettingRelPath は設定ファイルの WORKSPACE_ROOT 相対パス（既存キャラ設定規約と同一）。
func SettingRelPath(categoryDir, dirName, fileName string) string {
	return categoryDir + "/" + dirName + "/settings/" + fileName + ".md"
}

// FlatSettingRelPath はキャラクター以外のカテゴリの設定ファイルパス
// （<categoryDir>/<fileName>.md。設定ファイルエディタの保存規則と同一）。
func FlatSettingRelPath(categoryDir, fileName string) string {
	return categoryDir + "/" + fileName + ".md"
}

// SettingRelPathFor はカテゴリ種別に応じた設定ファイルパスを返す。
func SettingRelPathFor(isCharacter bool, categoryDir, fileName string) string {
	if isCharacter {
		return SettingRelPath(categoryDir, fileName, fileName)
	}
	return FlatSettingRelPath(categoryDir, fileName)
}

// Method は作成方式。
const (
	// MethodTwoStep はじっくり作成（2段階。1段階目=調査、2段階目=設定作成）。
	MethodTwoStep = "two_step"
	// MethodOneShot は一括作成（調査から設定ファイル作成まで 1 回で行う）。
	MethodOneShot = "one_shot"
	// MethodDialog は対話作成の 1 ターン（作業コピーを AI が編集し、サーバーが正規位置へ反映する）。
	MethodDialog = "dialog"
	// MethodFromSession はセッションからの一時キャラクター取り込み（会話ログを根拠に
	// 1 キャラ分の設定本文を書かせ、正規位置へは置かず会話設定へ登録する）。
	MethodFromSession = "from_session"
)

// ResultKindTempCharacter は from_session の成果物種別（会話設定へ登録済み）。
const ResultKindTempCharacter = "tempCharacter"

// Payload は config-generate ジョブの実行指定。
//
// 設定ファイルの配置は常にキャラクター名基準（characters/<キャラ名>/settings/<キャラ名>.md）。
// DirName は調査メモの所在追跡にのみ使う（旧データはキャラ名と異なり得る）。
type Payload struct {
	CategoryID          string `json:"categoryId"`
	Method              string `json:"method"`
	Step                int    `json:"step,omitempty"` // two_step のみ 1 | 2
	CharacterName       string `json:"characterName"`
	WorkTitle           string `json:"workTitle"`
	DirName             string `json:"dirName"`
	Model               string `json:"model,omitempty"`
	ClaudeEffort        string `json:"claudeEffort,omitempty"`
	AntigravityThinking string `json:"antigravityThinking,omitempty"`
	TimeoutMinutes      int    `json:"timeoutMinutes,omitempty"`
	Locale              string `json:"locale,omitempty"`
	// Notes は設定作成備考（ユーザーの要望・指示。指示ファイルへ結合される）。
	Notes string `json:"notes,omitempty"`
	// FileName は成果物ファイル名（拡張子なし）。キャラクターでは CharacterName と同じ値。
	FileName string `json:"fileName,omitempty"`
	// EditorContent は左エディタの内容。一括作成では入力項目テンプレートの差し込みに、
	// 対話作成では作業コピーの初期内容に使う。空なら未指定。
	EditorContent string `json:"editorContent,omitempty"`
	// EditorHash は送信時点の左エディタ内容の sha256（対話作成のみ）。
	EditorHash string `json:"editorHash,omitempty"`
	// DialogSessionID / UserMessage は対話作成のみ。
	DialogSessionID string `json:"dialogSessionId,omitempty"`
	UserMessage     string `json:"userMessage,omitempty"`
	// SearchTemplate / SettingTemplate は使うテンプレート名（空なら既定）。
	SearchTemplate  string `json:"searchTemplate,omitempty"`
	SettingTemplate string `json:"settingTemplate,omitempty"`
	// SessionID / TargetCharacter / ManualTemplate は from_session のみ。
	// SessionID は分析元の会話セッション、TargetCharacter は抽出時の表示名（元のまま）、
	// ManualTemplate は手動作成用の雛形名。from_session では SettingTemplate（AI 用の
	// 設定ファイルテンプレート名）と ManualTemplate のどちらか一方を使い、両方空なら AI 用の既定。
	SessionID       string `json:"sessionId,omitempty"`
	TargetCharacter string `json:"targetCharacter,omitempty"`
	ManualTemplate  string `json:"manualTemplate,omitempty"`
}

// ResultFile はジョブ完走時に jobs.Result.Output へ JSON で格納する成果物情報。
// フロントはこれを使って設定エディタへ生成ファイルを読み込む。
type ResultFile struct {
	// Kind は成果物の種類。"research"（調査メモ）| "setting"（設定ファイル）
	// | "tempCharacter"（一時キャラクターとして会話設定へ登録済み。RelPath は仮想パス）。
	Kind string `json:"kind"`
	// CategoryID / DirName / FileName は config-editor API での取得キー（setting のとき）。
	CategoryID string `json:"categoryId"`
	DirName    string `json:"dirName"`
	FileName   string `json:"fileName"`
	// RelPath は WORKSPACE_ROOT 相対の実パス（research の取得や表示に使う）。
	RelPath string `json:"relPath"`
	// SessionID / FileHash は対話作成のみ（フロントが左エディタを差し替える判定に使う）。
	SessionID string `json:"sessionId,omitempty"`
	FileHash  string `json:"fileHash,omitempty"`
}
