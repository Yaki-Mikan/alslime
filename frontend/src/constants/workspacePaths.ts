/**
 * workspacePaths.ts - WORKSPACE_ROOT 相対の物理パス定数
 *
 * ワークスペース構造は英語 snake_case（設定設定大設定/ワークスペース英語化_設計.md）。
 * パスをコンポーネントに直書きせず、必ずここを参照する。
 * バックエンド側の正本は alslime/internal/config/constants.go。
 */

export const WORKSPACE_PATHS = {
    /** シチュエーション設定（MD） */
    SITUATIONS: 'roleplay/global/situations',
    /** ユーザー設定（MD） */
    USERS: 'roleplay/users',
    /** 世界観設定（MD） */
    WORLDVIEWS: 'roleplay/global/worldviews',
    /** 舞台設定（MD） */
    STAGES: 'roleplay/global/stages',
    /** 文体設定（MD） */
    WRITING_STYLES: 'roleplay/global/writing_styles',
    /** 個別性格設定（MD） */
    PERSONALITIES: 'roleplay/global/personalities',
    /** 個別服装・髪型設定（MD） */
    OUTFITS_HAIR: 'roleplay/global/outfits_hair',
    /** 個別背景設定（MD） */
    BACKGROUNDS: 'roleplay/global/backgrounds',
} as const;

/** キャラディレクトリ配下のサブディレクトリ名（<characters>/<キャラ>/ 直下） */
export const CHARACTER_SUBDIRS = {
    PERSONALITIES: 'personalities',
    OUTFITS_HAIR: 'outfits_hair',
    BACKGROUNDS: 'backgrounds',
} as const;
