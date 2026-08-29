from pathlib import Path
import re
import sys

downloads = Path.home() / "Downloads"

v30_candidates = sorted(
    downloads.glob("淡路島旅行アプリ_v30_公開前安全対策_利用規約_APIフォールバック*")
)

v30_dirs = [p for p in v30_candidates if p.is_dir()]
if not v30_dirs:
    print("v30フォルダがDownloadsに見つかりません。")
    sys.exit(1)

source = v30_dirs[0] / "templates" / "index.html"
target = Path(__file__).resolve().parent / "templates" / "index.html"

if not source.exists():
    print("v30のtemplates/index.htmlが見つかりません。")
    sys.exit(1)

source_text = source.read_text(encoding="utf-8")
match = re.search(
    r'<meta\s+name=["\']google-site-verification["\']\s+content=["\'][^"\']+["\']\s*/?>',
    source_text,
    flags=re.I
)

if not match:
    print("v30からGoogle確認タグを見つけられませんでした。")
    sys.exit(1)

tag = match.group(0)
target_text = target.read_text(encoding="utf-8")

target_text = re.sub(
    r'<meta\s+name=["\']google-site-verification["\']\s+content=["\'][^"\']+["\']\s*/?>',
    "",
    target_text,
    flags=re.I
)

placeholder = "<!-- GOOGLE_SITE_VERIFICATION_PLACEHOLDER -->"
if placeholder not in target_text:
    print("v31側の確認タグ挿入位置が見つかりません。")
    sys.exit(1)

target_text = target_text.replace(
    placeholder,
    tag + "\n    <!-- Google Search Console ownership verification -->",
    1
)

target.write_text(target_text, encoding="utf-8")

print("Google Search Console確認タグをv30からv31へ引き継ぎました。")
