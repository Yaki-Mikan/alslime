package coreapi

// 行動選択肢サイドカーモジュールと本体の間の RPC 契約。
//
// 画像生成（module.go）とは独立した支援者向け機能のため、契約もここへ分離する。
// 起動・認証・ポート報告のインフラ規約（ModuleAuthHeader / ModuleSecretEnv /
// ModulePortPrefix / ModuleHealthzRoute）は module.go の共通定数を再利用する。
// リクエスト/レスポンスのボディは ChatHook 境界の型（chathook.go）をそのまま使う
//（境界型は JSON シリアライズ可能を保つ方針のため）。

const (
	// ModuleChatPreSendRoute は送信前フック委譲の内部 RPC ルート。
	ModuleChatPreSendRoute = "/module/chat-presend"
	// ModuleChatPostReceiveRoute は受信後フック委譲の内部 RPC ルート。
	ModuleChatPostReceiveRoute = "/module/chat-postreceive"
)
