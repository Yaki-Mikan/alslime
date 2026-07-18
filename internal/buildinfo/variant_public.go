//go:build public

package buildinfo

// PublicBuild はインターネット公開運用向けビルドかどうか。
//
// public タグ付きビルドでは true になり、config.Load が FIREBASE_PROJECT_ID の
// 未設定を起動エラーにする（認証なしでの公開起動を構造的に不可能にする）。
const PublicBuild = true
