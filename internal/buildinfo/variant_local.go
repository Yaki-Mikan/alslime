//go:build !public

package buildinfo

// PublicBuild はインターネット公開運用向けビルドかどうか。
//
// 正本はビルドタグ（-tags public）。環境変数では切り替えられない
// （パッケージドキュメントの「環境変数は正本にしない」方針に従う）。
// ローカル版（タグ無し）は false で、Firebase 認証は任意（環境変数での opt-in）。
const PublicBuild = false
