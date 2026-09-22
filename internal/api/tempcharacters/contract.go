// Package tempcharacters はセッション内の一時キャラクターに対する操作 API を提供する。
//
// 一時キャラクターの本文更新（簡易エディタの保存）・削除（スロットのごみ箱）・
// キャラ設定登録（正規のキャラクターディレクトリと設定ファイルの作成）の 3 つ。
// 分析ジョブの投入は config-gen API（from-session）側にある。
package tempcharacters

// route 断片。
const (
	routeUpdate   = "/temp-characters/update"
	routeRemove   = "/temp-characters/remove"
	routeRegister = "/temp-characters/register"
)

// contentMaxBytes は簡易エディタから受け付ける設定本文の上限（設定自動生成の成果物上限と同じ 2MiB）。
const contentMaxBytes = 2 * 1024 * 1024
