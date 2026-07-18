import { useState, useEffect } from 'react';
import { Chat } from './components/Chat';
import { EulaGate } from './components/EulaGate';
import { APP_I18N_KEYS, APP_TEXT_FALLBACK_JA, COMMON_I18N_KEYS, COMMON_TEXT_FALLBACK_JA } from './constants/i18n';

// ローカル実行版とインターネット公開版の分岐（ビルド時の env で確定）:
//   - VITE_FIREBASE_API_KEY 未設定 = ローカル実行版（GitHub配布・自PC完結）。
//     認証層を持たず、EULA同意後すぐアプリ本体を表示する。ログアウトも無い。
//   - VITE_FIREBASE_API_KEY 設定あり = インターネット公開版（Lightsail等の自前運用）。
//     Firebase Google認証＋許可UIDリストで入口を制限する。未配布・運用者向け。
const FIREBASE_CONFIGURED = !!import.meta.env.VITE_FIREBASE_API_KEY;

// Firebaseは動的importで読み込む（エラー耐性向上・未使用構成でのバンドル分離。
// PWA版と同じ方式。04調査 低#11）。ローカル実行版では一切ロードされない。
let firebaseModule: typeof import('./firebase') | null = null;

function App() {
  // 公開版はログイン → EULA → アプリの順。EulaGate の /api/settings は認証必須の
  // API なので、認証確立前（トークン無し）に叩くと 401 になるため内側に置く。
  // ローカル実行版は従来どおり EULA → アプリ。
  if (FIREBASE_CONFIGURED) {
    return <AuthGate />;
  }
  return (
    <EulaGate>
      <Chat />
    </EulaGate>
  );
}

// AuthGate はインターネット公開版のみが通る認証の門。
// Firebase Google認証と VITE_ALLOWED_UIDS（カンマ区切り）による入場制限を担う。
function AuthGate() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const t = (key: string) => APP_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key;

  // Firebase初期化
  useEffect(() => {
    const initFirebase = async () => {
      try {
        firebaseModule = await import('./firebase');
        console.log('Firebase module loaded');

        // 許可UIDリスト（カンマ区切り、空なら制限なし）
        const allowedUids = (import.meta.env.VITE_ALLOWED_UIDS || '')
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);

        // 認証状態を監視
        firebaseModule.onAuthChange(async (authUser: any) => {
          console.log('Auth state changed:', authUser ? authUser.email : 'null');
          if (authUser && allowedUids.length > 0 && !allowedUids.includes(authUser.uid)) {
            console.warn(`[Auth] UID not allowed: ${authUser.uid} (${authUser.email})`);
            setError(t(APP_I18N_KEYS.accessDenied));
            try {
              await firebaseModule?.firebaseSignOut();
            } catch (e) {
              console.error('Sign out failed:', e);
            }
            setUser(null);
            setLoading(false);
            return;
          }
          setUser(authUser);
          setLoading(false);
        });
      } catch (err: any) {
        console.error('Firebase init error:', err);
        setError(t(APP_I18N_KEYS.firebaseInitFailed));
        setLoading(false);
      }
    };

    initFirebase();
  }, []);

  // Googleログイン
  const handleLogin = async () => {
    if (!firebaseModule) return;
    setLoading(true);
    setError(null);
    try {
      await firebaseModule.signInWithGoogle();
    } catch (err: any) {
      console.error('Login failed:', err);
      setError(err.message || t(APP_I18N_KEYS.loginFailed));
      setLoading(false);
    }
  };

  // ログアウト処理
  const handleLogout = async () => {
    if (firebaseModule) {
      await firebaseModule.firebaseSignOut();
      setUser(null);
    }
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-900 text-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400 mx-auto mb-4"></div>
          <p className="text-gray-400">{t(COMMON_I18N_KEYS.loading)}</p>
        </div>
      </div>
    );
  }

  // 未ログイン状態
  if (!user) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
        <div className="bg-gray-800 p-8 rounded-2xl shadow-xl max-w-md w-full text-center space-y-6">
          <div className="flex justify-center items-end gap-2">
            <img src="/icons/app-192.png" alt="" aria-hidden="true" className="w-16 h-16" />
            <img src="/icons/app-192.png" alt="AlSlime" className="w-24 h-24" />
            <img src="/icons/app-192.png" alt="" aria-hidden="true" className="w-16 h-16" />
          </div>
          <h1 className="text-2xl font-bold">AlSlime</h1>
          <p className="text-gray-400">{t(APP_I18N_KEYS.googleLoginPrompt)}</p>
          {error && (
            <div className="text-red-400 text-sm bg-red-900/20 p-3 rounded-lg">
              {error}
            </div>
          )}
          <button
            onClick={handleLogin}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            {t(APP_I18N_KEYS.googleLogin)}
          </button>
        </div>
      </div>
    );
  }

  // 認証確立後に EULA 確認 → アプリ本体（EulaGate の API 呼び出しにトークンが乗る）。
  return (
    <EulaGate>
      <Chat onLogout={handleLogout} />
    </EulaGate>
  );
}

export default App;
