from pathlib import Path
import re
import sys

downloads = Path.home() / "Downloads"
target = Path(__file__).resolve().parent / "templates" / "index.html"

pattern = re.compile(
    r'<meta\s+name=["\']google-site-verification["\']\s+content=["\']([^"\']+)["\']\s*/?>',
    flags=re.I
)

found_tag = None
found_file = None

# Downloads配下のindex.htmlを順番に確認します。
# フォルダ名の濁点・半濁点などMac特有の文字表現差に影響されない方法です。
for candidate in downloads.rglob("index.html"):
    try:
        # v32自身は検索対象から除外
        if candidate.resolve() == target.resolve():
            continue

        text = candidate.read_text(encoding="utf-8")
    except Exception:
        continue

    match = pattern.search(text)
    if not match:
        continue

    value = match.group(1).strip()

    # 説明用の仮文字列は無視します。
    if not value or value == "ここにGoogleが出した値":
        continue

    found_tag = match.group(0)
    found_file = candidate
    break

if not found_tag:
    print("Google Search Consoleの確認タグをDownloads内から見つけられませんでした。")
    print("既に所有権確認できた版の templates/index.html がDownloads内にあるか確認してください。")
    sys.exit(1)

target_text = target.read_text(encoding="utf-8")

# v32側に既存タグがあれば一度削除して重複を防ぎます。
target_text = pattern.sub("", target_text)

placeholder = "<!-- GOOGLE_SITE_VERIFICATION_PLACEHOLDER -->"

if placeholder not in target_text:
    print("v32側のGoogle確認タグ挿入位置が見つかりませんでした。")
    sys.exit(1)

target_text = target_text.replace(
    placeholder,
    found_tag + "\n    <!-- Google Search Console 所有権確認タグ -->",
    1
)

target.write_text(target_text, encoding="utf-8")

print("Google Search Console確認タグを引き継ぎました。")
print("取得元:", found_file)
