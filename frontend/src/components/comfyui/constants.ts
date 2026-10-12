/**
 * constants.ts - ComfyUI設定画面共通の定数定義
 *
 * 画像生成まわりの画面で使用するラベル、プレースホルダー、メッセージ等を一元管理する。
 */

// ===== モーダル・セクション名 =====

/** 各セクション名 */
export const SECTION_NAMES = {
    TAG_MAPPING: 'タグマッピング設定',
    GENERATE_TEST: '画像生成テスト',
    GENERATE_RESULT: '生成結果',
    RESOLVED_PROMPT: '解決済みプロンプト',
    CONNECTION_SETTINGS: '接続設定',
    TAG_JUDGE_GENERATION_SETTINGS: 'タグ判定・生成設定',
    TAG_ENABLE: 'タグ有効/無効設定',
    USER_APPEARANCE: 'ユーザーの容姿設定',
    DANBOORU_FORMAT: 'Danbooruタグ取得形式',
    TRIGGER_FORMAT: 'トリガーワード取得形式',
    TEST_WORKFLOW_SELECT: 'テスト生成用ワークフロー',
    WORKFLOW_IMPORT: 'ワークフローインポート',
} as const;

export const DIRECTIVE_MODE_OPTIONS = {
    NATURAL_LANGUAGE: '自然言語混在（Anima等向け・一人称視点）',
    NATURAL_SHORT: '自然言語混在（Anima等向け・一人称視点・短縮版）',
    NATURAL_THIRD: '自然言語混在（Anima等向け・三人称視点）',
    NATURAL_THIRD_SHORT: '自然言語混在（Anima等向け・三人称視点・短縮版）',
    DANBOORU_ONLY: 'Danbooruタグのみ（一人称視点）',
    DANBOORU_THIRD: 'Danbooruタグのみ（三人称視点）',
} as const;

// API サービス用の指示ファイルは ComfyUI 用とは別のファイルで、対象のモデルも違う。
// 選択肢の文言も別に持つ（ComfyUI 用の「Anima等向け」は API サービスには当てはまらない）。
export const DIRECTIVE_MODE_OPTIONS_API = {
    NATURAL_LANGUAGE: '自然言語混在（一人称視点）',
    NATURAL_SHORT: '自然言語混在（一人称視点・短縮版）',
    NATURAL_THIRD: '自然言語混在（三人称視点）',
    NATURAL_THIRD_SHORT: '自然言語混在（三人称視点・短縮版）',
    DANBOORU_ONLY: 'Danbooruタグのみ（一人称視点）',
    DANBOORU_THIRD: 'Danbooruタグのみ（三人称視点）',
} as const;

// ===== 素材づくりのキャラ画像の「試しに生成」 =====

export const INTEGRATED = {
    /** 選んでいるキャラの保存した画像設定を試しに生成へ使うかのトグルのラベル（保存前の編集は使わない） */
    USE_LEFT_CHARACTER_TOGGLE: 'このキャラの画像設定を使う',
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
        BACKEND_TAB_COMFYUI: 'ComfyUI 用',
        BACKEND_TAB_API: 'APIサービス用',
        USER_NAMES: '呼び名（カンマ区切り）',
        REFERENCE_IMAGES: '参照画像',
        OUTPUT_COMFYUI: 'ComfyUI 用の出力',
        OUTPUT_API: 'APIサービス用の出力',
        OUTPUT_EMPTY: '（未入力）',
    },
    PLACEHOLDERS: {
        SELECT_CHARACTER: '-- 選択してください --',
        USER_NAMES: '例: あなた, ご主人様, 先輩',
        SEARCH_CHARACTER: 'キャラクターを検索...',
        CHARACTER_NAME: '例: original_character_a',
        WORK_NAME: '例: original_work',
        ALIASES: '例: 夕夏, 北野夕夏',
        CHARACTER_PROMPT: '例: 1girl, twin tails',
        PHYSICAL_FEATURES: '例: black hair, twin tails, red eyes, fair skin',
        EXTRA_POSITIVE: '例: detailed eyes, shiny hair',
        EXTRA_NEGATIVE: '例: blurry, low quality',
        OUTFIT_NAME: '服装名（例: 私服）',
        OUTFIT_PROMPT: 'プロンプト（例: casual clothes, white blouse, black skirt）',
    },
    HELP: {
        CHARACTER_JOINED: "→ '__CHARACTER__' に結合",
        IDENTITY_OUTPUT_DESC: 'キャラクター名と作品名は ComfyUI 用と APIサービス用で共用です。プロンプトへ出すときに、それぞれの区切りへ変換されます。',
        FEATURES_PLACEHOLDER: "→ '__FEATURES__'",
        EXTRA_POSITIVE_PLACEHOLDER: "→ '__EXTRA_POSITIVE__'",
        EXTRA_NEGATIVE_PLACEHOLDER: "→ '__EXTRA_NEGATIVE__'",
        CHARACTER_PROMPT_DESC: '追加のbooru系タグ（キャラ名・作品名と結合されます）',
        PHYSICAL_FEATURES_DESC: '髪色・髪型・体型・目の色など外見タグ',
        ALIASES_DESC: '会話内の話者名が設定ファイル名と異なる場合に、別名をカンマ区切りで指定します。',
        OUTFIT_DESC: 'AIが服装名を返した場合、対応するプロンプトとLoRAを画像生成に使用します',
        API_OUTFIT_DESC: 'AIが服装名を返した場合、対応するプロンプトを人物プロンプトに使用します',
        API_PROMPT_DESC: 'API サービスへ送信する人物用のプロンプトです。API サービスでは LoRA を利用できません。キャラクター名、作品名、別名は ComfyUI の設定と共通です。',
        USER_NAMES_DESC: '会話文でユーザーを指す呼び名。登場人物の判定に使います。',
        USER_APPEARANCE_DESC: 'ユーザー（会話の相手）を 1 人の人物として画像に入れるための容姿設定です。ComfyUI 連携には使われません。',
    },
    MESSAGES: {
        SELECT_CHARACTER: 'キャラクターを選択してください',
        NO_RESULTS: '該当なし',
    },
    BUTTONS: {
        APPEARANCE_PROMPT: 'AI で容姿プロンプトを作成',
    },
} as const;

// ===== タグマッピング設定 =====

export const TAG_MAPPING = {
    LABELS: {
        LORA_DIRECTORY: 'LoRAディレクトリ（このカテゴリ用）',
        TAG_LIST: 'タグ一覧',
        EDIT_TAG: '選択中のタグ編集',
        MATCH_KEY: '照合キー',
        AI_DESCRIPTION: 'AIへの説明',
        DANBOORU_PROMPT: 'danbooru語 (プロンプト)',
        NEGATIVE_PROMPT: 'ネガティブプロンプト',
        LORA: 'LoRA',
        DANBOORU_PROMPT_SHORT: 'danbooru語',
        PRIORITY_WORKFLOW: '優先ワークフロー',
        PRIORITY_PRESET: '優先プリセット',
        ENABLED: '有効',
        TARGET_COMFYUI: 'ComfyUI',
        TARGET_API: 'API',
    },
    PLACEHOLDERS: {
        LORA_DIRECTORY: '例: pose',
        MATCH_KEY: '例: 立ち姿, standing',
        AI_DESCRIPTION: '例: 人物が立っている場面',
        DANBOORU_PROMPT: '例: standing, full body',
        NEGATIVE_PROMPT: '例: sitting',
        SEARCH_KEY: '照合キーで検索...',
    },
    HELP: {
        LORA_DIRECTORY_DESC: 'ComfyUIのLoRAフォルダ内のサブディレクトリ名。LoRA選択時のフィルタに使用。',
        DISABLED_HINT: '無効にしたタグは、タグ判定AIへの提示・照合・プロンプト解決から除外されます。',
    },
    MESSAGES: {
        NO_TAGS: 'タグが登録されていません',
        NO_MATCH: '該当するタグがありません',
        UPDATE_FAILED: '更新に失敗しました',
        AUTO_SAVE: '切り替えは即座に保存されます',
        NOT_SET: '(未設定)',
        NO_LORA_FOUND: 'LoRAが見つかりません',
        USE_CURRENT_WORKFLOW: '現在のワークフロー設定を使用',
        USE_CURRENT_PRESET: '現在のプリセット設定を使用',
    },
} as const;

// ===== 画像生成テスト =====

export const GENERATE_TEST = {
    LABELS: {
        TEMPLATE: 'テンプレート',
        CHARACTER: 'キャラクター',
        TAG_SELECTION: 'タグ選択',
        DIRECT_TEXT: 'プロンプトを直接入力',
        DIRECT_SHORT: '直接入力',
        POSITIVE_PROMPT: 'ポジティブ',
        NEGATIVE_PROMPT: 'ネガティブ',
        RESOLVED_PROMPT: '解決済みプロンプト',
        PRESET: '生成プリセット',
        PERSON_PROMPTS: '人物プロンプト',
        ANLAS_ESTIMATE: 'Anlas 概算',
        WARNINGS: '注意',
        EXTRA_PROMPT: '追加プロンプト（自由入力）',
        SOUND_EFFECTS: '生成へ指定した効果音',
    },
    PLACEHOLDERS: {
        DIRECT_TEXT_CHARACTER: '例: 1girl, original, twin tails, blue hair',
        DIRECT_TAG_PROMPT: '{{label}}のプロンプトを直接入力...',
        NOT_SELECTED: '(未選択)',
        NOT_SET: '(未設定)',
        NONE: '(なし)',
    },
    MESSAGES: {
        NO_CHARACTER_FOUND: 'キャラクターが見つかりません',
        NO_CATEGORY: 'カテゴリが登録されていません',
        GENERATE_FAILED: '生成に失敗しました',
        GENERATING: '生成中... (最大120秒)',
        CLICK_TO_ZOOM: 'クリックで拡大',
        RESEED_TOOLTIP: 'シード値を変更して再生成',
        DIRECT_TEXT_INPUT: 'プロンプトの直接入力',
        APPLIED_LORA: '適用LoRA',
        INTERMEDIATE: '途中経過（{{step}} ステップ目）',
        COMMON_PRESET_OPTION: '（共通プリセットを使用）',
        EXTRA_PROMPT_DESC: '今回の生成にのみ適用する追加プロンプトを入力します。NovelAI V5 では、引用符で囲んだ文言と書体・配置の説明を入力することで、画像内の文字描画を指定できます。',
        SOUND_EFFECTS_NOT_NEEDED: '効果音は不要と判定されました',
        SOUND_EFFECTS_REJECTED: '効果音の判定結果を採用できませんでした',
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
        TRIGGER_WORDS: 'トリガーワード',
        CHARA_WORK_ONLY: 'キャラ/作品のみ',
        FILTER_ON_DESC: 'キャラクター名・作品名のみ',
        FILTER_OFF_DESC: '全カテゴリ',
    },
    PLACEHOLDERS: {
        SEARCH_ALL: '例: ツインテール、青い髪',
        SEARCH_CHARA: '例: キャラクターA、作品A',
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
        CLAUDE_EFFORT: 'Claude effort',
        CLAUDE_EFFORT_DEFAULT: 'CLI既定',
        CLAUDE_EFFORT_LOW: 'Low',
        CLAUDE_EFFORT_MEDIUM: 'Medium',
        CLAUDE_EFFORT_HIGH: 'High',
        CLAUDE_EFFORT_XHIGH: 'XHigh',
        CLAUDE_EFFORT_MAX: 'Max',
        ANTIGRAVITY_THINKING: 'Antigravity thinking',
        ANTIGRAVITY_THINKING_LOW: 'Low',
        ANTIGRAVITY_THINKING_MEDIUM: 'Medium',
        ANTIGRAVITY_THINKING_HIGH: 'High',
        TAG_JUDGE_PROVIDER_OPENAI_COMPAT: 'API（OpenAI互換）',
        TAG_JUDGE_TIMEOUT_SECONDS: 'タグ判定タイムアウト（秒）',
        IMAGE_JOB_MODE: '画像生成ジョブの単位',
        IMAGE_JOB_MODE_COMBINED: '分析と生成をまとめて 1 ジョブ',
        IMAGE_JOB_MODE_COMBINED_DESCRIPTION: '現在の画像の生成が完了した後、次の画像の分析を開始します。',
        IMAGE_JOB_MODE_SPLIT: '分析と生成を分ける',
        IMAGE_JOB_MODE_SPLIT_DESCRIPTION: '現在の画像の分析が完了した後、次の画像の分析を開始します。画像生成の依頼は ComfyUI に 1 枚ずつ順番に送信します。',
        IMAGE_JOB_MODE_NOTE: '画像生成の待機中または実行中も、この会話ではメッセージの送信を受け付けます。',
        AUTO_GENERATE: '応答時に自動で画像生成する',
        AUTO_GENERATE_DESCRIPTION: 'AI の応答に含まれる各メッセージについて、上から順に画像生成を依頼します。実行前に ComfyUI との接続を確認し、接続を確認できない場合は画像生成を依頼しません。自動生成の対象とするキャラクターは、会話設定のキャラクター詳細設定で個別に指定します。',
        FORMAT: '形式',
    },
    MESSAGES: {
        SAVED: '保存しました',
        SAVE_FAILED: '保存に失敗しました',
        JAPANESE_SEARCH_TO_COPY: '日本語で検索 → {{action}}',
        TEMPLATE_NAME_REQUIRED: 'テンプレート名を入力してください',
        TEMPLATE_NAME_PLACEHOLDER: '例: アニメ調 標準',
        DELETE_SELECTED_TEMPLATE_TOOLTIP: '選択中のテンプレートを削除',
        SAVE_DEFAULT_TEMPLATE_TOOLTIP: '選択中のワークフローをデフォルトとして保存',
        DOWNLOAD_SELECTED_WORKFLOW_TOOLTIP: '選択中のワークフローをダウンロード',
        DOWNLOAD_WORKFLOW_FAILED: 'ワークフローのダウンロードに失敗しました。',
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
        FORMAT_WORKFLOW_HEADING: 'タグ判定プロンプト形式と使用ワークフロー',
        FORMAT_WORKFLOW_DESC: '使用する形式を選び、形式ごとに使うワークフローを指定します。「共通」を選んだ形式は共通ワークフローを使用します。',
        COMMON_WORKFLOW_LABEL: '共通ワークフロー',
        COMMON_WORKFLOW_OPTION: '共通',
        TAG_JUDGE_DESC: 'チャット履歴から画像生成タグを判定するAIとモデルを選択します。',
        TAG_JUDGE_OPENAI_COMPAT_EMPTY: '選べるモデルがありません。API プロバイダ設定で接続先を登録し、モデル一覧に OpenAI 互換モデルを追加してください。',
        TAG_JUDGE_OPENAI_COMPAT_HINT: '推論の強さなどの追加パラメータは、接続先の追加パラメータ設定が使われます。',
        DANBOORU_FORMAT_DESC: 'Danbooru検索結果のコピーと、取得タグを欄へ追加するときの区切り形式に使用します。',
        TRIGGER_FORMAT_DESC: 'トリガーワードを行コピーするときの変換形式です。「そのまま」は元の表記を変更しません。',
        LIGHTWEIGHT_SAVE_LABEL: '画像生成時に保存形式を上書きする',
        LIGHTWEIGHT_SAVE_DESC: 'ワークフロー内に Yakimikan Save Image Lightweight ノードがある場合のみ反映します。',
        WORKFLOW_DROP_TEXT: 'ワークフローJSONファイルを',
        WORKFLOW_DROP_ACTION: 'ドラッグ&ドロップ、またはクリックして選択',
        WORKFLOW_DROP_HINT: 'ComfyUIの「Save (API Format)」で保存したJSONファイル',
        TAG_ENABLE_DESC: 'カテゴリを横断してタグの有効/無効を切り替えます。無効にしたタグは判定・生成に使われません。',
        COUNT_SUFFIX: '件',
        RAW: 'そのまま',
        UNDERSCORE: 'アンダーバー',
        SPACE: '半角スペース',
        ANIMA: 'Anima向け',
        LORA_DIR_DESCRIPTION: 'ComfyUIのLoRAディレクトリ内のサブディレクトリ名を各カテゴリに指定してください。',
        COPY_ROW_TOOLTIP: 'クリックでこの行をまるごとコピー',
        DOWNLOAD: 'ダウンロード',
        REFRESH_TOOLTIP: 'LoRA一覧を再読み込み',
        REFRESH_OUTFIT_TOOLTIP: '服装LoRA一覧を再読み込み',
        DELETE_OUTFIT_TOOLTIP: '服装設定を削除',
        LORA_UNREACHABLE: 'ComfyUIに接続できないため、LoRA一覧を取得できません。LoRAを使わない項目の編集・保存はそのまま行えます。',
        LORA_UNREACHABLE_SHORT: 'ComfyUIに接続できないため、LoRA一覧を取得できません',
        LORA_RETRY: '再試行',
        TAG_JUDGE_WORKFLOW_AUTO_SAVE: '変更は自動で保存されます。',
    },
    /** 値なし表示 */
    EMPTY_MARKER: '-',
    HAS_LORA: '有',
} as const;

// ===== 画像生成バックエンドの切替 =====

export const BACKEND = {
    TABS: {
        COMFYUI: 'ComfyUI',
        API_SERVICE: 'APIサービス',
    },
    LABELS: {
        SERVICE: 'サービス',
    },
    MESSAGES: {
        SWITCH_FAILED: 'バックエンドの選択を保存できませんでした',
    },
} as const;

// ===== API サービス共通（接続・残高・プリセット選択） =====

export const API_SERVICE = {
    LABELS: {
        TOKEN: 'API トークン',
        TOKEN_SET: '設定済み',
        TOKEN_UNSET: '未設定',
        PLAN: 'プラン',
        ANLAS: 'Anlas 残高',
        FREE_TIER: '無料枠',
        USAGE: '使用量枠',
        COMMON_PRESET: '共通プリセット',
        BALANCE_PANEL: 'API サービス残高',
        AUTO_SOUND_EFFECTS: '自動効果音描画',
    },
    PLACEHOLDERS: {
        TOKEN: 'pst-… を貼り付け',
    },
    HELP: {
        TOKEN_HOWTO: 'NovelAI のサイトで User Settings → Account → Get Persistent API Token から取得できます。',
        TOKEN_STORED: 'トークンは端末内の秘密ストアに保存され、画面には表示されません。',
        FREE_TIER_DESC: '{{pixels}} 画素以下・{{steps}} ステップ以下・1 回 {{samples}} 枚まで無料',
        FORMAT_PRESET_DESC: '形式ごとに使う生成プリセットを選びます。「共通」を選んだ形式は共通プリセットを使います。',
        AUTO_SOUND_EFFECTS: 'AI が会話内容に応じて効果音の要否・文言・書体・配置を判定し、生成プロンプトに反映します。対象は効果音のみで、セリフは含みません。効果音が不要と判定された場合は追加されません。NovelAI V5 に対応しています。',
        AUTO_SOUND_EFFECTS_NOTE: '効果音を指定しても画像に描画されない場合は、生成プリセットの「Quality Tags」の文から「no text」を取り除くと改善することがあります。推奨の文には、画像内の文字を抑える「no text」が含まれています。編集した文は「推奨の文へ戻す」で元に戻せます。',
    },
    BUTTONS: {
        SAVE_TOKEN: 'トークンを保存',
        DELETE_TOKEN: 'トークンを削除',
        TEST: '接続テスト',
        REFRESH_BALANCE: '残高を更新',
    },
    MESSAGES: {
        TOKEN_SAVED: 'トークンを保存しました',
        TOKEN_DELETED: 'トークンを削除しました',
        TOKEN_SAVE_FAILED: 'トークンを保存できませんでした',
        CONNECTION_FAILED: '接続できませんでした',
        BALANCE_UNAVAILABLE: '残高を取得できませんでした',
        BALANCE_STALE: '残高を更新できなかったため、前回取得した値を表示しています。',
        BALANCE_LOADING: '取得中',
        COMMON_PRESET_OPTION: '共通',
        NO_PRESET: '生成プリセットがありません',
        FREE_TIER_NONE: '無料枠なし',
        USAGE_NEGATIVE: '利用可能な使用量枠がありません',
        EXPIRES_AT: '有効期限: {{date}}',
        AUTO_SOUND_EFFECTS_SAVE_FAILED: '自動効果音描画の設定を保存できませんでした',
    },
} as const;

// ===== 参照画像（人物の見た目を指示する画像） =====

export const REFERENCE_IMAGE = {
    LABELS: {
        KIND: '種別',
        STRENGTH: '強さ',
        FIDELITY: '忠実度',
        KIND_CHARACTER: 'キャラクター',
        KIND_STYLE: '画風',
        KIND_BOTH: 'キャラクター＋画風',
    },
    MESSAGES: {
        DROP_TEXT: '参照画像をここにドロップ、またはクリックして選択',
        LIMIT: '最大 {{max}} 枚',
        UPLOAD_FAILED: '参照画像を登録できませんでした',
        DELETE_CONFIRM: 'この参照画像を削除しますか？',
        V45_ONLY: '参照画像は V4.5 モデルでのみ使われます。',
        COST_NOTE: '参照画像 1 枚につき 5 Anlas を消費します（Opus でも有料）。',
        IMAGE_ONLY: 'PNG / JPEG / WebP の画像を選んでください',
    },
} as const;

// ===== NovelAI 生成プリセット =====

export const NOVELAI = {
    SECTIONS: {
        PRESET: 'NovelAI 生成プリセット',
        MODEL: 'モデル',
        IMAGE: '画像設定',
        PROMPT: 'プロンプト',
        ADVANCED: '高度な設定',
        OUTPUT: '画像出力形式',
    },
    LABELS: {
        PRESET: 'プリセット',
        MODEL: 'モデル',
        SIZE_PRESET: '解像度',
        WIDTH: '幅',
        HEIGHT: '高さ',
        STEPS: 'ステップ数',
        SCALE: 'CFG スケール（Prompt Guidance）',
        CFG_RESCALE: 'CFG リスケール（Guidance Rescale）',
        SAMPLER: 'サンプラー',
        NOISE_SCHEDULE: 'ノイズスケジュール',
        UC_PRESET: 'UC Preset',
        QUALITY_TAGS: 'Quality Tags',
        QUALITY_TAGS_TEXT: '生成時に送信する品質タグ',
        VARIETY_BOOST: 'Variety+',
        SEED: 'シード',
        SEED_RANDOM: '毎回乱数',
        SEED_FIXED: '固定',
        FIXED_SEED: 'シード値',
        IMAGE_FORMAT: '出力形式',
        FIXED_POSITIVE: 'ベースプロンプト',
        FIXED_NEGATIVE: '除外したい要素',
        TEMPLATE_BASE: 'プロンプト構成（画面全体）',
        TEMPLATE_CHARACTER: 'プロンプト構成（人物 1 人分）',
        TEMPLATE_NEGATIVE: 'プロンプト構成（ネガティブ）',
        MODE: 'モード',
        MODE_ANIME: 'アニメ',
        MODE_FURRY: 'ケモノ',
        TRANSPARENT: '透過背景',
    },
    UC_PRESETS: {
        HEAVY: '強い',
        LIGHT: '軽い',
        FURRY_FOCUS: 'ケモノモード',
        HUMAN_FOCUS: '人間に重点を置く',
        NONE: '指定なし',
    },
    QUALITY_TAGS_KINDS: {
        STANDARD: '標準',
        LIGHT: '軽い',
        NONE: '指定なし',
    },
    HELP: {
        TEMPLATE: '__KEY__ または {{KEY}} で差し込み位置を指定します。人物 1 人分の構成は登場人物ごとに繰り返し適用されます。',
        FIXED_PROMPT: '会話の内容に関係なく毎回入る文字列です。ベースプロンプトは画面全体プロンプトの先頭、除外したい要素は全体ネガティブの先頭に入ります。アーティストタグや画風の指定はベースプロンプトに書きます。改行はカンマ区切りとして扱われます。',
        MODEL_SELECTED_ELSEWHERE: '使用するモデルは API サービスの設定で選択します。生成プリセットを切り替えても変わりません。',
        MODEL_VALUES_NOTE: '推奨の品質タグはモデルごとに異なるため、この設定はモデル別に保存されます。',
        NOT_IN_MODEL: '選択中のモデルでは選べない項目があります。',
        TRANSPARENT: '有効にすると出力形式は PNG に固定されます。',
        FURRY_MODE: '「ケモノ」は獣人向けの描き方に切り替えます（画面全体プロンプトの先頭に fur dataset を付けます）。人物の絵は「アニメ」のままにします。',
        VARIETY_UNAVAILABLE: '選択中のモデルでは、この項目に対応する送信値を確認できていないため利用できません。',
        REFERENCE_V45_ONLY: '参照画像は V4.5 モデルでのみ使えます。',
        FREE_TIER_WARNING: 'この設定は Opus の無料枠を超えるため Anlas を消費します（1 枚あたり概算 {{anlas}}）。',
        JAPANESE_V45: 'V4.5 モデルは日本語のプロンプトを解釈できません。',
        CUSTOM_SIZE: '64 の倍数で指定します。',
    },
    BUTTONS: {
        NEW: '新規',
        COPY: '複製',
        DELETE: '削除',
        RENAME: '名前変更',
        RESET_QUALITY_TAGS_TEXT: '推奨の文へ戻す',
    },
    MESSAGES: {
        MODEL_SAVE_FAILED: 'モデルを保存できませんでした',
        NEW_PRESET_NAME: '新しいプリセット名',
        DELETE_CONFIRM: 'プリセット「{{name}}」を削除しますか？',
        SAVED: 'プリセットを保存しました',
        SAVE_FAILED: 'プリセットを保存できませんでした',
        CUSTOM_SIZE: 'カスタム',
        NAME_REQUIRED: 'プリセット名を入力してください',
    },
    // 解像度プリセットの名前（鍵は本体の解像度プリセット ID）。{{width}}・{{height}} を差し込む
    SIZE_PRESETS: {
        small_portrait: 'Small 縦 ({{width}}×{{height}})',
        small_landscape: 'Small 横 ({{width}}×{{height}})',
        small_square: 'Small 正方 ({{width}}×{{height}})',
        normal_portrait: 'Normal 縦 ({{width}}×{{height}})',
        normal_landscape: 'Normal 横 ({{width}}×{{height}})',
        normal_square: 'Normal 正方 ({{width}}×{{height}})',
        large_portrait: 'Large 縦 ({{width}}×{{height}})',
        large_landscape: 'Large 横 ({{width}}×{{height}})',
        wallpaper_portrait: 'Wallpaper 縦 ({{width}}×{{height}})',
        wallpaper_landscape: 'Wallpaper 横 ({{width}}×{{height}})',
    } as Record<string, string>,
} as const;
