/**
 * constants.ts - ComfyUI設定画面共通の定数定義
 *
 * モーダル・統合設定画面で使用するラベル、プレースホルダー、メッセージ等を一元管理する。
 */

// ===== モーダル・セクション名 =====

/** 統合設定画面のタイトル */
export const INTEGRATED_SETTINGS_TITLE = '画像生成設定';

/** 各セクション名 */
export const SECTION_NAMES = {
    CHARACTER_SETTINGS: 'キャラクター画像生成設定',
    TAG_MAPPING: 'タグマッピング設定',
    GENERATE_TEST: '画像生成テスト',
    GENERATE_RESULT: '生成結果',
    RESOLVED_PROMPT: '解決済みプロンプト',
    SETTINGS: 'ComfyUI 画像生成設定',
    CONNECTION_SETTINGS: '接続設定',
    TAG_JUDGE_SETTINGS: 'タグ判定プロンプト設定',
    TAG_JUDGE_PROMPT_FORMAT: 'タグ判定プロンプト形式',
    WORKFLOW_SETTINGS: 'ワークフロー設定',
    DANBOORU_FORMAT: 'Danbooruタグ取得形式',
    TRIGGER_FORMAT: 'トリガーワード取得形式',
    TAG_TRIGGER_FORMAT: 'タグ・トリガーワード形式',
    LIGHTWEIGHT_SAVE: 'Yakimikan軽量画像保存',
    WORKFLOW_TEMPLATE: 'ワークフローテンプレート',
    WORKFLOW_SELECT: 'ワークフロー選択',
    WORKFLOW_IMPORT: 'ワークフローインポート',
    OTHER_IMAGE_SETTINGS: 'タグマッピング設定',
    LORA_DIR_SETTINGS: 'LoRAディレクトリ設定',
} as const;

export const DIRECTIVE_MODE_OPTIONS = {
    DANBOORU_ONLY: 'Danbooruタグのみ',
    NATURAL_LANGUAGE: '自然言語混在（Anima等向け）',
} as const;

// ===== 統合設定画面固有 =====

export const INTEGRATED = {
    /** キャラ設定連動トグルのラベル */
    USE_LEFT_CHARACTER_TOGGLE: '左のキャラ設定を使用',
    /** 統合設定を開くボタンのラベル */
    OPEN_BUTTON_LABEL: '画像生成設定',
    /** 統合設定ボタン表示の最小画面幅 (px) */
    MIN_SCREEN_WIDTH: 1280,
} as const;

// ===== キャラクター設定 =====

export const CHARACTER = {
    LABELS: {
        CHARACTER: 'キャラクター',
        CHARACTER_NAME: 'キャラクター名',
        WORK_NAME: '作品名',
        CHARACTER_AND_WORK: 'キャラクター名 / 作品名',
        ALIASES: 'エイリアス（別名）',
        CHARACTER_PROMPT: 'キャラクタープロンプト',
        PHYSICAL_FEATURES: '身体的特徴',
        LORA: 'LoRA（チェックポイント直後に自動挿入）',
        OUTFIT_SETTINGS: '服装設定',
        OUTFIT_LORA: '服装LoRA',
        EXTRA_POSITIVE: '追加ポジティブ',
        EXTRA_NEGATIVE: '追加ネガティブ',
    },
    PLACEHOLDERS: {
        SELECT_CHARACTER: '-- 選択してください --',
        SEARCH_CHARACTER: 'キャラクターを検索...',
        CHARACTER_NAME: '例: maya_diesel',
        WORK_NAME: '例: code_geass',
        ALIASES: '例: 夕夏, 北野夕夏',
        CHARACTER_PROMPT: '例: 1girl, twin tails',
        PHYSICAL_FEATURES: '例: black hair, twin tails, small breasts, red eyes, fair skin',
        EXTRA_POSITIVE: '例: detailed eyes, shiny hair',
        EXTRA_NEGATIVE: '例: large breasts',
        OUTFIT_NAME: '服装名（例: 私服）',
        OUTFIT_PROMPT: 'プロンプト（例: casual clothes, white blouse, black skirt）',
    },
    HELP: {
        CHARACTER_JOINED: "→ '__CHARACTER__' に結合",
        FEATURES_PLACEHOLDER: "→ '__FEATURES__'",
        EXTRA_POSITIVE_PLACEHOLDER: "→ '__EXTRA_POSITIVE__'",
        EXTRA_NEGATIVE_PLACEHOLDER: "→ '__EXTRA_NEGATIVE__'",
        CHARACTER_PROMPT_DESC: '追加のbooru系タグ（キャラ名・作品名と結合されます）',
        PHYSICAL_FEATURES_DESC: '髪色・髪型・体型・目の色など外見タグ',
        ALIASES_DESC: 'ファイル名と異なるキャラ名でTURNタグが出力される場合に設定（カンマ区切り）',
        OUTFIT_DESC: 'AIが服装名を返した場合、対応するプロンプトとLoRAを画像生成に使用します',
    },
    MESSAGES: {
        SELECT_CHARACTER: 'キャラクターを選択してください',
        NO_RESULTS: '該当なし',
    },
} as const;

// ===== タグマッピング設定 =====

export const TAG_MAPPING = {
    LABELS: {
        CATEGORY: 'カテゴリ',
        LORA_DIRECTORY: 'LoRAディレクトリ（このカテゴリ用）',
        TAG_LIST: 'タグ一覧',
        MATCH_KEY: '照合キー',
        AI_DESCRIPTION: 'AIへの説明',
        DANBOORU_PROMPT: 'danbooru語 (プロンプト)',
        NEGATIVE_PROMPT: 'ネガティブプロンプト',
        LORA: 'LoRA',
        EDIT_TAG: '選択中のタグ編集',
        DANBOORU_PROMPT_SHORT: 'danbooru語',
        PRIORITY_WORKFLOW: '優先ワークフロー',
    },
    PLACEHOLDERS: {
        LORA_DIRECTORY: '例: pose',
        MATCH_KEY: '例: 正常位, missionary',
        AI_DESCRIPTION: '例: 男女が向き合って横になっている体位の場面',
        DANBOORU_PROMPT: '例: missionary position, lying on back, legs spread',
        NEGATIVE_PROMPT: '例: standing',
    },
    HELP: {
        LORA_DIRECTORY_DESC: 'ComfyUIのLoRAフォルダ内のサブディレクトリ名。LoRA選択時のフィルタに使用。',
    },
    MESSAGES: {
        NO_TAGS: 'タグが登録されていません',
        NOT_SET: '(未設定)',
        NO_LORA_FOUND: 'LoRAが見つかりません',
        USE_CURRENT_WORKFLOW: '現在のワークフロー設定を使用',
    },
} as const;

// ===== 画像生成テスト =====

export const GENERATE_TEST = {
    LABELS: {
        TEMPLATE: 'テンプレート',
        CHARACTER: 'キャラクター',
        CHARACTER_SETTINGS: 'キャラクター設定',
        TAG_SELECTION: 'タグ選択',
        DIRECT_PLACEHOLDERS: 'その他（プレースホルダ直指定）',
        DIRECT_TEXT: '直テキスト',
        DIRECT_SHORT: '直',
        CHAR_NAME: 'キャラ名',
        CHAR_WORK_NAME: '作品名',
        POSITIVE_PROMPT: 'ポジティブ',
        NEGATIVE_PROMPT: 'ネガティブ',
        RESULT: '生成結果',
        RESOLVED_PROMPT: '解決済みプロンプト',
    },
    PLACEHOLDERS: {
        DIRECT_TEXT_CHARACTER: '例: 1girl, hatsune_miku, vocaloid, twin tails, blue hair',
        DIRECT_PLACEHOLDERS: '1行1件で「プレースホルダ名: 値」\n例: QUALITY_EXTRA: masterpiece, best quality',
        DIRECT_TAG_PROMPT: '{{label}}のプロンプトを直接入力...',
        NOT_SELECTED: '(未選択)',
        NOT_SET: '(未設定)',
        NONE: '(なし)',
    },
    MESSAGES: {
        NO_CHARACTER_FOUND: 'キャラクターが見つかりません',
        NO_CATEGORY: 'カテゴリが登録されていません',
        GENERATE_FAILED: '生成に失敗しました',
        TEST_DONE: '✓ テスト生成完了',
        TEST_RESULT_ALT: 'テスト生成結果',
        GENERATING: '生成中... (最大120秒)',
        CLICK_TO_ZOOM: 'クリックで拡大',
        CLICK_TO_ZOOM_DISPLAY: 'クリックで拡大表示',
        RESEED_TOOLTIP: 'seed違いで再生成',
        DIRECT_TEXT_INPUT: '直テキスト入力',
        APPLIED_LORA: '適用LoRA',
    },
} as const;

// ===== プレースホルダプリセット =====

export const PLACEHOLDER_PRESET = {
    TITLE: 'プレースホルダ設定',
    LABELS: {
        SECTION: 'プレースホルダ変換',
        PRESET: 'プリセット',
        NAME: 'プリセット名',
        FROM: '変換元',
        TO: '変換先',
        DESCRIPTION: 'AIへの説明',
        DIRECT_MODE: '直接指定',
    },
    PLACEHOLDERS: {
        NAME: '例: 標準セット',
        FROM: '例: QUALITY_EXTRA',
        TO: '例: masterpiece, best quality',
        DESCRIPTION: '例: 屋外のシーンの場合',
        NO_PRESET: '(なし)',
        NEW_PRESET: '(新規作成)',
    },
    MESSAGES: {
        SECTION_INFO: 'ワークフローテンプレート内のプレースホルダ（__変換元__ または {{変換元}}）へ変換先の値を注入します。チャットからの画像生成では、「AIへの説明」を設定した項目のみタグ判定AIが状況に該当すると判断した場合に注入され、テスト生成ではプリセットの全項目が注入されます。',
        DESCRIPTION_HELP: '「AIへの説明」を設定すると、チャットからの画像生成時にタグ判定AIがその状況に該当すると判断した項目だけが注入されます。空欄の項目は判定対象外です。',
        OPEN_SETTINGS_TOOLTIP: 'プレースホルダ設定を開く',
        DELETE_CONFIRM: 'プリセット「{{name}}」を削除しますか？',
        DELETE_PRESET_TOOLTIP: '選択中のプリセットを削除',
        NO_PRESETS: '保存済みプリセットはありません',
        NAME_REQUIRED: 'プリセット名を入力してください',
        SAVE_FAILED: '保存に失敗しました',
        DELETE_FAILED: '削除に失敗しました',
        SAVED: '保存しました',
        EXPORT_TOOLTIP: '編集中の内容をJSONファイルとして保存',
        IMPORT_SECTION: 'インポート',
        DROP_TEXT: 'プレースホルダ設定のJSONファイル',
        DROP_ACTION: 'ドラッグ&ドロップ、またはクリックして選択',
        DROP_HINT: 'エクスポートで保存したJSONファイル（name / entries 形式）',
        IMPORTED: '読み込みました。保存ボタンで確定してください',
        IMPORT_FAILED: '読み込みに失敗しました',
        IMPORT_INVALID: '有効なエントリが見つかりません（from / to を持つ entries 配列が必要です）',
    },
} as const;

// ===== Danbooruタグ検索 =====

export const DANBOORU = {
    LABELS: {
        TAG_SEARCH: 'Danbooruタグ検索',
        DANBOORU_TAGS: 'Danbooruタグ',
        TRIGGER_WORDS: 'トリガーワード',
        CHARA_WORK_ONLY: 'キャラ/作品のみ',
        FILTER_ON_DESC: 'キャラクター名・作品名のみ',
        FILTER_OFF_DESC: '全カテゴリ',
    },
    PLACEHOLDERS: {
        SEARCH_CHARA: '例: 初音ミク、Fate',
        SEARCH_ALL: '例: 正常位、ツインテール',
    },
    MESSAGES: {
        CLICK_TO_COPY: 'クリックでコピー',
        COPIED: '✓',
        POST_COUNT: '投稿数',
    },
    /** Danbooruカテゴリ番号→表示名 */
    CATEGORY_NAMES: {
        0: '一般',
        1: 'artist',
        3: '作品',
        4: 'キャラ',
        5: 'meta',
    } as Record<number, string>,
} as const;

// ===== LoRA共通 =====

export const LORA = {
    LABELS: {
        MODEL_STRENGTH: 'M',
        CLIP_STRENGTH: 'C',
        STRENGTH: '強度',
        DETAIL_MODE: '詳細',
        SIMPLE_MODE: 'M/C',
    },
    PLACEHOLDERS: {
        DIRECTORY_NAME: 'ディレクトリ名',
        SELECT_LORA: 'LoRAを選択...',
        SEARCH_LORA: 'LoRAを検索...',
    },
    HELP: {
        SELECT_AUTO_ADD: '選択すると次の行が自動追加',
        DETAIL_DESC: '詳細: M(Model) C(CLIP)個別設定',
        DETAIL_MODE_TOOLTIP: '詳細モード（M/C個別）',
        SIMPLE_MODE_TOOLTIP: '簡易モードに切替',
    },
    MESSAGES: {
        NO_RESULTS: '該当なし',
    },
} as const;

// ===== トリガーワード =====

export const TRIGGER_WORDS = {
    LABELS: {
        FETCHING: '⏳ 取得中...',
        FETCHED: 'トリガーワード取得済み',
        FETCH: '▶ トリガーワード取得',
        ADD: '追加',
    },
    PLACEHOLDERS: {
        INPUT: 'トリガーワード（取得ボタンで追加 or 手動入力）',
    },
    MESSAGES: {
        NONE: 'トリガーワードなし',
        ADD_TOOLTIP: 'このLoRAのトリガーワード欄に追加',
    },
} as const;

// ===== 共通ボタン・メッセージ =====

export const COMMON = {
    BUTTONS: {
        SAVE: '保存',
        SAVING: '保存中...',
        CLOSE: '閉じる',
        CANCEL: 'キャンセル',
        TEST: 'テスト',
        EDIT: '編集',
        DELETE: '削除',
        ADD: '追加',
        GENERATE: '生成',
        REGENERATE: '再生成',
        RESET: 'リセット',
        SEARCH: '検索',
        SEARCHING: '検索中...',
        NEW_ADD: '新規追加',
        REFRESH_LORA: '再読込',
        ADD_OUTFIT: '服装設定を追加',
        ANALYSIS_AI: '分析AI',
        ANALYSIS_MODEL: '分析モデル',
        TAG_JUDGE_TIMEOUT_SECONDS: 'タグ判定タイムアウト（秒）',
        FORMAT: '形式',
        UNSAVED: '未保存',
    },
    MESSAGES: {
        SAVED: '保存しました',
        SAVE_FAILED: '保存に失敗しました',
        TEMPLATE_NAME_REQUIRED: 'テンプレート名を入力してください',
        TEMPLATE_NAME_PLACEHOLDER: '例: アニメ調 標準',
        DELETE_SELECTED_TEMPLATE_TOOLTIP: '選択中のテンプレートを削除',
        SAVE_DEFAULT_TEMPLATE_TOOLTIP: '選択中のワークフローをデフォルトとして保存',
        DEFAULT_TEMPLATE_SAVED: 'デフォルトのワークフローとして保存しました',
        WORKFLOW_SELECT_DESC: '画像生成とテスト生成で使用するワークフローを選択します。',
        NO_TEMPLATE: 'テンプレートが登録されていません',
        CONNECTION_TEST_FAILED: '接続テストに失敗しました',
        JSON_ONLY: 'JSONファイルのみ対応しています。',
        JSON_READ_FAILED: 'JSONファイルの読み込みに失敗しました。',
        ADD_FAILED: '追加に失敗しました',
        DELETE_TEMPLATE_CONFIRM: 'テンプレート「{{name}}」を削除しますか？',
        DEFAULT_PORT_DESC: 'ComfyUIのデフォルトポートは 8188 です。',
        DIRECTIVE_MODE_DESC: 'チャット履歴分析時にAIへ渡す指示文の形式を選択します。自然言語混在はAnimaなど自然言語追従性の高いモデル向けです。',
        TAG_JUDGE_DESC: 'チャット履歴から画像生成タグを判定するAIとモデルを選択します。',
        DANBOORU_FORMAT_DESC: 'Danbooru検索結果のコピーと、取得タグを欄へ追加するときの区切り形式に使用します。',
        TRIGGER_FORMAT_DESC: 'トリガーワードを行コピーするときの変換形式です。「そのまま」は元の表記を変更しません。',
        FORMAT_AUTO_SAVE_DESC: '変更は自動保存されます。Danbooruは検索結果コピー、トリガーワードは行コピー時の変換に使用します。',
        LIGHTWEIGHT_SAVE_LABEL: '画像生成時に保存形式を上書きする',
        LIGHTWEIGHT_SAVE_DESC: 'ワークフロー内に Yakimikan Save Image Lightweight ノードがある場合のみ反映します。',
        WORKFLOW_DROP_TEXT: 'ワークフローJSONファイルを',
        WORKFLOW_DROP_ACTION: 'ドラッグ&ドロップ、またはクリックして選択',
        WORKFLOW_DROP_HINT: 'ComfyUIの「Save (API Format)」で保存したJSONファイル',
        TEMPLATE_SELECT_DESC: '画像生成時に使用するワークフローテンプレートを選択してください。',
        INTEGRATED_SETTINGS_DESC: 'キャラクター設定・タグマッピング・テスト生成を1画面で操作できます。',
        CHARACTER_SETTINGS_DESC: 'キャラクターごとのプロンプト・LoRA・身体的特徴を設定します。',
        OTHER_IMAGE_SETTINGS_DESC: '体位・構図・服装等のタグマッピング（danbooru語・LoRA紐づけ）を設定します。',
        LORA_DIR_SETTINGS_DESC: '各カテゴリに対応するLoRAフォルダのパスを設定します。',
        GENERATE_TEST_DESC: 'テンプレート・キャラクター・タグを選択してプレースホルダ置換込みの画像生成をテストします。',
        COUNT_SUFFIX: '件',
        JAPANESE_SEARCH_TO_COPY: '日本語で検索 → {{action}}',
        RAW: 'そのまま',
        UNDERSCORE: 'アンダーバー',
        SPACE: '半角スペース',
        LORA_DIR_DESCRIPTION: 'ComfyUIのLoRAディレクトリ内のサブディレクトリ名を各カテゴリに指定してください。',
        DEFAULT_VALUE: 'デフォルト値: {{value}}',
        COPY_ROW_TOOLTIP: 'クリックでこの行をまるごとコピー',
        DOWNLOAD: 'ダウンロード',
        REFRESH_TOOLTIP: 'LoRA一覧を再読み込み',
        REFRESH_OUTFIT_TOOLTIP: '服装LoRA一覧を再読み込み',
        DELETE_OUTFIT_TOOLTIP: '服装設定を削除',
    },
    /** 値なし表示 */
    EMPTY_MARKER: '-',
    /** LoRA有無表示 */
    HAS_LORA: '有',
} as const;
