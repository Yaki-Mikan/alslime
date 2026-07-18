// 認証トークン付き fetch。
// axios を経由しない API 呼び出し（fetch 直）は lib/axios.ts のインターセプタを
// 通らず Authorization が付かないため、公開版（Firebase 有効時）で 401 になる。
// fetch を使う箇所は必ずこれを使うこと。
import { getIdToken, isFirebaseEnabled } from '../firebase';

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    if (isFirebaseEnabled) {
        try {
            const token = await getIdToken();
            if (token) {
                init = {
                    ...init,
                    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
                };
            }
        } catch (error) {
            console.error('[authFetch] Failed to get ID token:', error);
        }
    }
    return fetch(input, init);
}
