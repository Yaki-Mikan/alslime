// Go同梱フロントでは同一オリジンを既定にする。
// VITE_BACKEND_URL は外部バックエンドを明示したい開発時だけ使う。
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';
