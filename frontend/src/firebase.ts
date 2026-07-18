// Firebase 設定とエクスポート
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import type { Auth, User } from 'firebase/auth';

// 環境変数からFirebase設定を読み込み
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Firebaseが有効かどうか（環境変数が設定されているか）
export const isFirebaseEnabled = !!firebaseConfig.apiKey;

// Firebase初期化（設定がある場合のみ、エラーハンドリング付き）
let auth: Auth | null = null;

if (isFirebaseEnabled) {
    try {
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        console.log('Firebase initialized successfully');
    } catch (error) {
        console.error('Firebase initialization failed:', error);
    }
}

export { auth };
export type { User };

// Google認証プロバイダー
const googleProvider = new GoogleAuthProvider();

// Googleでサインイン
export const signInWithGoogle = async () => {
    if (!auth) {
        throw new Error('Firebase is not configured');
    }
    return signInWithPopup(auth, googleProvider);
};

// サインアウト
export const firebaseSignOut = async () => {
    if (!auth) return;
    return signOut(auth);
};

// 認証状態監視
export const onAuthChange = (callback: (user: User | null) => void): (() => void) => {
    if (!auth) {
        // Firebase未設定の場合はnullを渡す（開発モード）
        setTimeout(() => callback(null), 0);
        return () => { };
    }
    return onAuthStateChanged(auth, callback);
};

// IDトークン取得
export const getIdToken = async (): Promise<string | null> => {
    if (!auth || !auth.currentUser) return null;
    return auth.currentUser.getIdToken();
};
