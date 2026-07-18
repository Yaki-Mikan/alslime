# migrate-workspace-en.ps1 - ワークスペース構造の英語化移行（Windows用）
#
# 日本語ディレクトリ/ファイル名を英語 snake_case へリネームする。
# マッピングの正本: GitでIgnoreしたいファイル達/要件まとめ/設定設定大設定/ワークスペース英語化_設計.md
#
# 使い方:
#   powershell -ExecutionPolicy Bypass -File migrate-workspace-en.ps1 -WorkspaceRoot "C:\path\to\workspace" [-DryRun]
#
# 安全設計:
#   - 深い階層から順に「同一親ディレクトリ内での名前変更」だけを行う
#     （DryRun でも実行時と同じ判定になる。親のリネームは最後）
#   - 旧名が無ければスキップ（冪等。何度実行してもよい）
#   - 新旧両方が存在したら停止（上書き事故防止。手動で解決すること）
#   - 認証ディレクトリはリネームのみで中身に一切触れない

param(
    [Parameter(Mandatory = $true)][string]$WorkspaceRoot,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $WorkspaceRoot -PathType Container)) {
    Write-Error "WorkspaceRoot が存在しません: $WorkspaceRoot"
    exit 1
}

$script:renamed = 0
$script:skipped = 0

# ParentRel（旧名のままの親相対パス）配下で OldName -> NewName の名前変更を行う。
function Rename-Entry {
    param([string]$ParentRel, [string]$OldName, [string]$NewName)
    $parent = if ($ParentRel -eq '') { $WorkspaceRoot } else { Join-Path $WorkspaceRoot $ParentRel }
    $old = Join-Path $parent $OldName
    $new = Join-Path $parent $NewName
    if (-not (Test-Path -LiteralPath $old)) {
        $script:skipped++
        return
    }
    if (Test-Path -LiteralPath $new) {
        Write-Error "新旧両方が存在します。手動で解決してください: `n  旧: $old`n  新: $new"
        exit 1
    }
    if ($DryRun) {
        Write-Host "[DryRun] $ParentRel : $OldName -> $NewName"
    } else {
        Move-Item -LiteralPath $old -Destination $new
        Write-Host "renamed: $ParentRel : $OldName -> $NewName"
    }
    $script:renamed++
}

$RP = "ロールプレイ"
$G  = "$RP/グローバル"

# ---- 1. 最深部: キャラディレクトリ配下（全キャラを走査） ----

$charsDir = Join-Path $WorkspaceRoot "$RP/キャラリスト"
if (Test-Path -LiteralPath $charsDir -PathType Container) {
    foreach ($charDir in Get-ChildItem -LiteralPath $charsDir -Directory) {
        $rel = "$RP/キャラリスト/" + $charDir.Name
        Rename-Entry "$rel/設定" "画像生成設定.json" "image_gen_config.json"
        Rename-Entry "$rel/画像" "元画像"   "originals"
        Rename-Entry "$rel/画像" "アイコン" "icons"
        Rename-Entry $rel "設定"         "settings"
        Rename-Entry $rel "画像"         "images"
        Rename-Entry $rel "内部保持情報" "internal"
        Rename-Entry $rel "性格"         "personalities"
        Rename-Entry $rel "服装_髪型"    "outfits_hair"
        Rename-Entry $rel "背景"         "backgrounds"
    }
}

# ---- 2. ComfyUI 配下 ----

Rename-Entry "$G/ComfyUI/タグマッピング" "カテゴリ定義.json" "categories.json"
Rename-Entry "$G/ComfyUI" "テンプレート"   "templates"
Rename-Entry "$G/ComfyUI" "プロファイル"   "profiles"
Rename-Entry "$G/ComfyUI" "タグマッピング" "tag_mappings"

# ---- 3. ConfigEditor テンプレートのカテゴリディレクトリ ----

Rename-Entry "$G/テンプレート" "キャラクター"     "characters"
Rename-Entry "$G/テンプレート" "シチュエーション" "situations"
Rename-Entry "$G/テンプレート" "個別性格設定"     "personalities"
Rename-Entry "$G/テンプレート" "個別服装・髪型"   "outfits_hair"
Rename-Entry "$G/テンプレート" "個別背景"         "backgrounds"
Rename-Entry "$G/テンプレート" "世界観"           "worldviews"
Rename-Entry "$G/テンプレート" "舞台"             "stages"
Rename-Entry "$G/テンプレート" "ユーザーの設定"   "users"
Rename-Entry "$G/テンプレート" "職業設定"         "occupations"

# ---- 4. グローバル配下 ----

Rename-Entry "$G/デフォルト設定" "デフォルト設定.json" "defaults.json"
Rename-Entry "$G/背景" "職業設定" "occupations"
Rename-Entry "$G/プリセット/SSRP_Mode" "時刻設定" "datetime"

Rename-Entry $G "デフォルト設定"   "defaults"
Rename-Entry $G "各種設定"         "settings"
Rename-Entry $G "項目設定"         "parameter_schemas"
Rename-Entry $G "プリセット"       "presets"
Rename-Entry $G "テンプレート"     "templates"
Rename-Entry $G "シチュエーション" "situations"
Rename-Entry $G "性格"             "personalities"
Rename-Entry $G "服装_髪型"        "outfits_hair"
Rename-Entry $G "背景"             "backgrounds"
Rename-Entry $G "世界観"           "worldviews"
Rename-Entry $G "舞台"             "stages"
Rename-Entry $G "文体設定"         "writing_styles"

# ---- 5. ロールプレイ直下 ----

Rename-Entry $RP "グローバル"     "global"
Rename-Entry $RP "キャラリスト"   "characters"
Rename-Entry $RP "ユーザー"       "users"
Rename-Entry $RP "各種設定"       "settings"
Rename-Entry $RP "履歴"           "history"
Rename-Entry $RP "一時"           "temp"
Rename-Entry $RP "キャッシュ"     "cache"
Rename-Entry $RP "バックアップ"   "backups"
Rename-Entry $RP "認証"           "auth"

# ---- 6. ルート ----

Rename-Entry "" $RP "roleplay"

Write-Host ""
Write-Host "完了: renamed=$($script:renamed) skipped(旧名なし)=$($script:skipped) $(if ($DryRun) { '(DryRun)' })"
