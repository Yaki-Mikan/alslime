#!/usr/bin/env bash
# migrate-workspace-en.sh - ワークスペース構造の英語化移行（Linux 本番用）
#
# 日本語ディレクトリ/ファイル名を英語 snake_case へリネームする。
# マッピングの正本: GitでIgnoreしたいファイル達/要件まとめ/設定設定大設定/ワークスペース英語化_設計.md
#
# 使い方:
#   ./migrate-workspace-en.sh /path/to/workspace [--dry-run]
#
# 安全設計:
#   - 深い階層から順に「同一親ディレクトリ内での名前変更」だけを行う
#     （dry-run でも実行時と同じ判定になる。親のリネームは最後）
#   - 旧名が無ければスキップ（冪等。何度実行してもよい）
#   - 新旧両方が存在したら停止（上書き事故防止。手動で解決すること）
#   - 認証ディレクトリはリネームのみで中身に一切触れない

set -euo pipefail

WORKSPACE_ROOT="${1:-}"
DRY_RUN=0
if [ "${2:-}" = "--dry-run" ]; then DRY_RUN=1; fi

if [ -z "$WORKSPACE_ROOT" ] || [ ! -d "$WORKSPACE_ROOT" ]; then
    echo "usage: $0 /path/to/workspace [--dry-run]" >&2
    exit 1
fi

renamed=0
skipped=0

# 親相対パス（旧名のまま）配下で old_name -> new_name の名前変更を行う。
rename_entry() {
    local parent_rel="$1" old_name="$2" new_name="$3"
    local parent="$WORKSPACE_ROOT"
    if [ -n "$parent_rel" ]; then parent="$WORKSPACE_ROOT/$parent_rel"; fi
    local old="$parent/$old_name"
    local new="$parent/$new_name"
    if [ ! -e "$old" ]; then
        skipped=$((skipped + 1))
        return 0
    fi
    if [ -e "$new" ]; then
        echo "ERROR: 新旧両方が存在します。手動で解決してください:" >&2
        echo "  旧: $old" >&2
        echo "  新: $new" >&2
        exit 1
    fi
    if [ "$DRY_RUN" -eq 1 ]; then
        echo "[dry-run] $parent_rel : $old_name -> $new_name"
    else
        mv "$old" "$new"
        echo "renamed: $parent_rel : $old_name -> $new_name"
    fi
    renamed=$((renamed + 1))
}

RP="ロールプレイ"
G="$RP/グローバル"

# ---- 1. 最深部: キャラディレクトリ配下（全キャラを走査） ----

CHARS_DIR="$WORKSPACE_ROOT/$RP/キャラリスト"
if [ -d "$CHARS_DIR" ]; then
    for char_path in "$CHARS_DIR"/*/; do
        [ -d "$char_path" ] || continue
        char_name="$(basename "$char_path")"
        rel="$RP/キャラリスト/$char_name"
        rename_entry "$rel/設定" "画像生成設定.json" "image_gen_config.json"
        rename_entry "$rel/画像" "元画像"   "originals"
        rename_entry "$rel/画像" "アイコン" "icons"
        rename_entry "$rel" "設定"         "settings"
        rename_entry "$rel" "画像"         "images"
        rename_entry "$rel" "内部保持情報" "internal"
        rename_entry "$rel" "性格"         "personalities"
        rename_entry "$rel" "服装_髪型"    "outfits_hair"
        rename_entry "$rel" "背景"         "backgrounds"
    done
fi

# ---- 2. ComfyUI 配下 ----

rename_entry "$G/ComfyUI/タグマッピング" "カテゴリ定義.json" "categories.json"
rename_entry "$G/ComfyUI" "テンプレート"   "templates"
rename_entry "$G/ComfyUI" "プロファイル"   "profiles"
rename_entry "$G/ComfyUI" "タグマッピング" "tag_mappings"

# ---- 3. ConfigEditor テンプレートのカテゴリディレクトリ ----

rename_entry "$G/テンプレート" "キャラクター"     "characters"
rename_entry "$G/テンプレート" "シチュエーション" "situations"
rename_entry "$G/テンプレート" "個別性格設定"     "personalities"
rename_entry "$G/テンプレート" "個別服装・髪型"   "outfits_hair"
rename_entry "$G/テンプレート" "個別背景"         "backgrounds"
rename_entry "$G/テンプレート" "世界観"           "worldviews"
rename_entry "$G/テンプレート" "舞台"             "stages"
rename_entry "$G/テンプレート" "ユーザーの設定"   "users"
rename_entry "$G/テンプレート" "職業設定"         "occupations"

# ---- 4. グローバル配下 ----

rename_entry "$G/デフォルト設定" "デフォルト設定.json" "defaults.json"
rename_entry "$G/背景" "職業設定" "occupations"
rename_entry "$G/プリセット/SSRP_Mode" "時刻設定" "datetime"

rename_entry "$G" "デフォルト設定"   "defaults"
rename_entry "$G" "各種設定"         "settings"
rename_entry "$G" "項目設定"         "parameter_schemas"
rename_entry "$G" "プリセット"       "presets"
rename_entry "$G" "テンプレート"     "templates"
rename_entry "$G" "シチュエーション" "situations"
rename_entry "$G" "性格"             "personalities"
rename_entry "$G" "服装_髪型"        "outfits_hair"
rename_entry "$G" "背景"             "backgrounds"
rename_entry "$G" "世界観"           "worldviews"
rename_entry "$G" "舞台"             "stages"
rename_entry "$G" "文体設定"         "writing_styles"

# ---- 5. ロールプレイ直下 ----

rename_entry "$RP" "グローバル"     "global"
rename_entry "$RP" "キャラリスト"   "characters"
rename_entry "$RP" "ユーザー"       "users"
rename_entry "$RP" "各種設定"       "settings"
rename_entry "$RP" "履歴"           "history"
rename_entry "$RP" "一時"           "temp"
rename_entry "$RP" "キャッシュ"     "cache"
rename_entry "$RP" "バックアップ"   "backups"
rename_entry "$RP" "認証"           "auth"

# ---- 6. ルート ----

rename_entry "" "$RP" "roleplay"

echo ""
extra=""
if [ "$DRY_RUN" -eq 1 ]; then extra=" (dry-run)"; fi
echo "完了: renamed=$renamed skipped(旧名なし)=$skipped$extra"
