// Axios設定とAuth Interceptor
import axios from 'axios';
import { getIdToken, isFirebaseEnabled } from '../firebase';

// リクエスト時にAuthorizationヘッダーを追加
axios.interceptors.request.use(async (config) => {
    if (isFirebaseEnabled) {
        try {
            const token = await getIdToken();
            if (token) {
                config.headers.Authorization = `Bearer ${token}`;
            }
        } catch (error) {
            console.error('Failed to get ID token:', error);
        }
    }
    return config;
}, (error) => {
    return Promise.reject(error);
});

export default axios;
