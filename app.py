# ============================================================
# TabiRoute 淡路島旅行Webアプリ v6
# app.py
# ============================================================
#
# 【目次】
# 1. ライブラリ
# 2. Flaskアプリ
# 3. エリア紹介
# 4. CSV読み込み
# 5. トップページ
# 6. エリアページ
# 7. スポット詳細ページ
# 8. 旅行プランページ
# 9. スポットAPI
# 10. スポット詳細API
# 11. プライバシー
# 12. 起動
#
# ============================================================

from flask import Flask, render_template, abort, jsonify, request, Response, url_for
import pandas as pd
import requests
import time
import os
from collections import defaultdict, deque
from pathlib import Path

app = Flask(__name__)

BASE_DIR = Path(__file__).resolve().parent
SPOTS_CSV = BASE_DIR / "data" / "spots.csv"


# ============================================================
# v31 SEO 基礎設定
# ============================================================

SITE_URL = os.environ.get(
    "SITE_URL",
    "https://awaji-ybbk.onrender.com"
).rstrip("/")


def absolute_url(endpoint, **values):
    """固定した公開URLを基準にcanonical/sitemap用URLを生成。"""
    return SITE_URL + url_for(endpoint, **values)


def clean_description(text, limit=120):
    text = " ".join(str(text or "").split())
    if len(text) <= limit:
        return text
    return text[:limit - 1].rstrip() + "…"


# OpenStreetMap検索結果を一時キャッシュ
OSM_SEARCH_CACHE = {}
LAST_OSM_REQUEST_AT = 0.0
NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"

# 周辺スポット探索用 OpenStreetMap Overpass API
OSM_NEARBY_CACHE = {}


# ============================================================
# 周辺検索ジャンル
# 沖縄アプリで使っていた方式をFlask版へ移植
# ============================================================

OSRM_ROUTE_URL = "https://router.project-osrm.org"


# ============================================================
# v30 公開前安全対策
# ============================================================

# 大きすぎるPOSTを拒否（プラン/経路APIに巨大データを投げられるのを防ぐ）
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024

_RATE_BUCKETS = defaultdict(deque)


def client_ip():
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or "unknown"


def rate_limit(key, limit, window_seconds):
    """簡易IP別レート制限。単一Renderプロセス内での乱用抑制用。"""
    now = time.time()
    bucket = _RATE_BUCKETS[(key, client_ip())]

    while bucket and now - bucket[0] > window_seconds:
        bucket.popleft()

    if len(bucket) >= limit:
        return False

    bucket.append(now)
    return True


def haversine_km(a_lat, a_lon, b_lat, b_lon):
    import math
    r = 6371.0
    p1 = math.radians(float(a_lat))
    p2 = math.radians(float(b_lat))
    dp = math.radians(float(b_lat) - float(a_lat))
    dl = math.radians(float(b_lon) - float(a_lon))
    h = (
        math.sin(dp / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    )
    return r * 2 * math.atan2(math.sqrt(h), math.sqrt(max(0.0, 1 - h)))


def estimated_route(points):
    """OSRMが使えない時の概算。道路案内ではなく参考値。"""
    legs = []
    total_km = 0.0

    for i in range(1, len(points)):
        km = haversine_km(
            points[i - 1]["lat"], points[i - 1]["lon"],
            points[i]["lat"], points[i]["lon"]
        )
        # 道路は直線より長いことが多いので概算係数を掛ける
        road_estimate_km = km * 1.25
        total_km += road_estimate_km
        legs.append({
            "distance_m": round(road_estimate_km * 1000),
            "duration_s": round((road_estimate_km / 35.0) * 3600)
        })

    return {
        "distance_m": round(total_km * 1000),
        "duration_s": round((total_km / 35.0) * 3600),
        "geometry": None,
        "legs": legs,
        "estimated": True,
        "source": "straight-line-fallback"
    }


def nearest_neighbor_order(points):
    """OSRM最適化が使えない時のローカル近傍順フォールバック。"""
    if len(points) <= 2:
        return list(range(len(points)))

    order = [0]
    remaining = set(range(1, len(points)))

    while remaining:
        current = order[-1]
        nxt = min(
            remaining,
            key=lambda idx: haversine_km(
                points[current]["lat"], points[current]["lon"],
                points[idx]["lat"], points[idx]["lon"]
            )
        )
        order.append(nxt)
        remaining.remove(nxt)

    return order


@app.after_request
def add_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(self)"
    )
    return response



# ============================================================
# v32 SEO集客ページ
#
# Google検索からTabiRouteへ来てもらうための「目的別ガイド」です。
# ここでは営業時間や料金など変わりやすい情報は断定せず、
# TabiRouteに登録済みのスポットを組み合わせて紹介します。
#
# slug:
#   URLに使う英数字
#
# title:
#   ページ内の見出し
#
# seo_title / seo_description:
#   Google検索結果向けのタイトル・説明文
#
# spot_ids:
#   ページ内で紹介する spots.csv のスポットID
# ============================================================

GUIDE_PAGES = {
    "awaji-1night-2days": {
        "label": "1泊2日",
        "icon": "🧳",
        "title": "淡路島1泊2日のモデルコース候補",
        "short_title": "1泊2日満喫コース",
        "seo_title": "淡路島1泊2日モデルコース｜観光スポットから旅行プランを作る | TabiRoute",
        "seo_description": "淡路島を1泊2日で巡るときの候補を、北部・東海岸・西海岸・洲本・南あわじから紹介。気になるスポットを選んで自分用の旅行プランを作れます。",
        "intro": "淡路島を1泊2日で楽しみたい人向けに、島内のエリアをまたいで候補をまとめました。移動時間や営業時間は旅行日によって変わるため、気になる場所を選んで自分用に調整する使い方がおすすめです。",
        "hero_spot_id": "yumebutai",
        "accent": "1泊2日",
        "tips": [
            "1日目と2日目でエリアを分けると、移動を整理しやすくなります。",
            "行きたい場所を先に旅行プランへ追加してから、おすすめ順機能で並びを調整できます。",
            "営業時間・休業日・交通状況は各施設の公式情報で最新情報を確認してください。"
        ],
        "spot_ids": [
            "michi-awaji",
            "hanasajiki",
            "yumebutai",
            "craft-circus",
            "sumoto-castle",
            "michi-uzushio"
        ]
    },

    "awaji-without-car": {
        "label": "車なし",
        "icon": "🚌",
        "title": "車なしで淡路島旅行を計画するときのスポット候補",
        "short_title": "車なしで楽しむ",
        "seo_title": "淡路島を車なしで観光するなら？旅行計画の作り方とスポット候補 | TabiRoute",
        "seo_description": "淡路島を車なしで旅行するときの考え方とスポット候補を紹介。バス等の最新交通情報を確認しながら、エリアを絞って旅行プランを作れます。",
        "intro": "淡路島はエリア間の移動が必要になるため、車なしの場合は『行きたい場所を増やしすぎない』『同じエリアにまとめる』のが計画しやすいです。北部・東海岸を中心に候補をまとめています。",
        "hero_spot_id": "highway-oasis",
        "accent": "車なし",
        "tips": [
            "実際のバス停・運行本数・最終便は、旅行日の交通事業者公式情報で確認してください。",
            "同じエリアの候補をまとめると、移動回数を減らしやすくなります。",
            "TabiRouteのルート表示は参考情報なので、公共交通の乗換案内としては使用しないでください。"
        ],
        "spot_ids": [
            "michi-awaji",
            "nijigen",
            "highway-oasis",
            "yumebutai",
            "yumebutai-greenhouse",
            "kaikyo-park"
        ]
    },

    "awaji-rainy-day": {
        "label": "雨の日",
        "icon": "☔",
        "title": "雨の日でも楽しみやすい淡路島スポット",
        "short_title": "雨の日スポット",
        "seo_title": "淡路島の雨の日観光｜屋内中心で考えるスポット候補 | TabiRoute",
        "seo_description": "淡路島で雨の日の旅行プランを考えるときのスポット候補を紹介。文化施設・植物園・体験施設などから自分用の旅行プランを作れます。",
        "intro": "雨予報の日は、屋外中心の予定だけにせず、館内で過ごせる施設や体験系スポットも候補に入れておくと計画を変更しやすくなります。施設によって屋外移動を含む場合があるため、当日の営業状況も確認してください。",
        "hero_spot_id": "yumebutai",
        "accent": "雨の日",
        "tips": [
            "完全屋内かどうかは施設ごとに異なるため、公式サイトで当日の利用条件を確認してください。",
            "雨天時は移動時間が延びることもあるため、予定を詰め込みすぎない方が調整しやすくなります。",
            "候補を複数お気に入りに入れておくと、当日に入れ替えやすくなります。"
        ],
        "spot_ids": [
            "yumebutai-greenhouse",
            "cat-art",
            "s-brick",
            "awaji-ningyoza",
            "hello-kitty-smile",
            "parchez"
        ]
    },

    "awaji-couple": {
        "label": "カップル",
        "icon": "♡",
        "title": "淡路島カップル旅行のスポット候補",
        "short_title": "カップル旅行",
        "seo_title": "淡路島カップル旅行｜景色・グルメ・温泉のデートスポット候補 | TabiRoute",
        "seo_description": "淡路島のカップル旅行に合わせやすい景色・建築・グルメ・温泉などのスポット候補を紹介。選んだ場所から旅行プランを作れます。",
        "intro": "景色、建築、海沿いグルメ、温泉などを組み合わせたい旅行向けの候補です。全部を回る前提ではなく、好みに合う場所を選んで自分たちのプランへ追加してください。",
        "hero_spot_id": "keino-matsubara",
        "accent": "カップル",
        "tips": [
            "夕景を見たい場合は、日の入り時刻や当日の天候を確認してください。",
            "食事・温泉・体験施設は予約や利用条件がある場合があります。",
            "西海岸だけ、北部だけのようにエリアを絞ると移動しやすくなります。"
        ],
        "spot_ids": [
            "hanasajiki",
            "yumebutai",
            "craft-circus",
            "seikaiha",
            "sumoto-onsen",
            "keino-matsubara"
        ]
    },

    "awaji-family": {
        "label": "子連れ",
        "icon": "👨‍👩‍👧",
        "title": "子連れで楽しむ淡路島ファミリー旅行",
        "short_title": "子連れファミリー",
        "seo_title": "淡路島 子連れ観光｜家族旅行のスポット候補とモデルコース | TabiRoute",
        "seo_description": "淡路島の子連れ旅行で候補にしやすい公園・体験・動物・テーマパークを紹介。家族向けの旅行プラン作成にも使えます。",
        "intro": "子どもと一緒に楽しみやすい公園、体験、動物、テーマパーク系の候補をまとめました。年齢制限や利用条件がある施設は、訪問前に公式情報を確認してください。",
        "hero_spot_id": "highway-oasis",
        "accent": "子連れ",
        "tips": [
            "子どもの年齢・身長によって体験できる内容が変わる施設があります。",
            "屋外施設は天候と気温も考えて、休憩を入れられるプランにすると安心です。",
            "食事場所や休憩スポットを先に候補へ入れておくと当日調整しやすくなります。"
        ],
        "spot_ids": [
            "highway-oasis",
            "kaikyo-park",
            "nijigen",
            "england-hill",
            "england-koala",
            "awaji-farm"
        ]
    },

    "awaji-west-coast-sunset": {
        "label": "西海岸・夕日",
        "icon": "🌅",
        "title": "淡路島西海岸の夕日・カフェ・景色スポット",
        "short_title": "西海岸・夕日",
        "seo_title": "淡路島西海岸の夕日・カフェ・観光スポット候補 | TabiRoute",
        "seo_description": "淡路島西海岸で夕景や海沿いグルメを楽しみたい人向けに、カフェ・複合施設・景色スポットの候補をまとめました。",
        "intro": "西海岸で海を眺めながら過ごしたい人向けに、グルメや夕景と組み合わせやすい候補をまとめました。日の入り時刻や店舗の営業時間は季節・日付で変わるため、当日の公式情報を確認してください。",
        "hero_spot_id": "keino-matsubara",
        "accent": "西海岸",
        "tips": [
            "夕日を目的にする場合は、旅行日の正確な日の入り時刻を確認してください。",
            "飲食店は混雑・予約・営業時間変更があるため、公式情報の確認がおすすめです。",
            "西海岸の候補をまとめると、海沿いを中心にプランを組みやすくなります。"
        ],
        "spot_ids": [
            "nojima-scuola",
            "craft-circus",
            "miele",
            "chef-garden",
            "seikaiha",
            "keino-matsubara"
        ]
    }
}

AREA_INFO = {
    "岩屋・北部": {
        "tagline": "明石海峡大橋と大型レジャーを楽しむ",
        "description": "淡路島の玄関口。大型レジャー、花、震災学習、海景色を楽しめます。"
    },
    "東海岸": {
        "tagline": "大阪湾を望む花・建築・温泉エリア",
        "description": "夢舞台周辺を中心に、建築、庭園、公園、温泉を楽しめます。"
    },
    "西海岸": {
        "tagline": "夕日と海沿いグルメを楽しむ",
        "description": "播磨灘沿いに飲食・観光・体験施設が点在します。"
    },
    "洲本・中部": {
        "tagline": "城下町・温泉・自然を楽しむ",
        "description": "洲本城跡、温泉、レトロな街並み、自然景勝地を楽しめます。"
    },
    "南あわじ": {
        "tagline": "うずしお・牧場・自然体験を楽しむ",
        "description": "うずしお、人形浄瑠璃、牧場、海岸、島旅を楽しめます。"
    }
}

def load_spots():
    spots = pd.read_csv(SPOTS_CSV, dtype={"id": str, "parent_id": str})
    return spots.fillna("")

@app.route("/")
def home():
    # ========================================================
    # トップページ用データ
    # ========================================================
    #
    # トップページは「検索サイト」っぽく見せるのではなく、
    # 淡路島旅行の入口として
    #
    # 1. 目的別モデルコース
    # 2. 人気スポット
    # 3. おまかせプラン
    # 4. エリアから探す
    #
    # の順で迷わず選べる構成にします。
    # ========================================================

    spots = load_spots()

    # 親施設・単独スポットだけをエリアカードの件数に使います。
    top_level = spots[
        spots["parent_id"] == ""
    ]

    areas = [
        area
        for area in AREA_INFO.keys()
        if area in top_level["area"].unique()
    ]

    # IDからスポット情報をすぐ取得できる辞書を作ります。
    spot_map = {
        str(row["id"]): row.to_dict()
        for _, row in spots.iterrows()
    }

    # --------------------------------------------------------
    # 目的別モデルコース
    #
    # トップではカード数を増やしすぎず、
    # 最初に見せたい3テーマを表示します。
    # --------------------------------------------------------
    featured_guide_slugs = [
        "awaji-couple",
        "awaji-family",
        "awaji-rainy-day"
    ]

    featured_guides = []

    for slug in featured_guide_slugs:
        guide = GUIDE_PAGES.get(slug)

        if not guide:
            continue

        hero_spot = spot_map.get(
            guide.get("hero_spot_id", ""),
            {}
        )

        featured_guides.append({
            "slug": slug,
            "guide": guide,
            "hero_image": hero_spot.get("image", "")
        })

    # --------------------------------------------------------
    # 人気スポット
    #
    # 現時点ではTabiRoute側でおすすめしたい代表3件を固定表示。
    # 将来アクセスデータが溜まったら、
    # 実際の閲覧数順に変更することもできます。
    # --------------------------------------------------------
    popular_ids = [
        "yumebutai",
        "nijigen",
        "hello-kitty-smile"
    ]

    popular_spots = [
        spot_map[spot_id]
        for spot_id in popular_ids
        if spot_id in spot_map
    ]

    # --------------------------------------------------------
    # エリアカード
    # --------------------------------------------------------
    area_counts = (
        top_level
        .groupby("area")
        .size()
        .to_dict()
    )

    area_images = (
        top_level
        .groupby("area")["image"]
        .first()
        .to_dict()
    )

    # 北部のヒーローには、
    # クレジット情報が明確な淡路ハイウェイオアシス写真を使用します。
    hero_spot = spot_map.get(
        "highway-oasis",
        {}
    )

    return render_template(
        "index.html",
        areas=areas,
        area_counts=area_counts,
        area_images=area_images,
        area_info=AREA_INFO,
        total_spots=len(spots),
        total_top_level=len(top_level),

        hero_spot=hero_spot,
        featured_guides=featured_guides,
        popular_spots=popular_spots,

        seo_title="淡路島の観光スポット・モデルコース・旅行プラン | TabiRoute",
        seo_description="淡路島の観光スポット、目的別モデルコース、エリア情報をまとめて探し、そのまま自分用の旅行プランを作れる旅行計画サイトです。",
        canonical_url=absolute_url("home")
    )


@app.route("/area/<area_name>")
def area(area_name):
    spots = load_spots()

    area_spots = spots[
        (spots["area"] == area_name)
        &
        (spots["parent_id"] == "")
    ]

    if area_spots.empty:
        abort(404)

    # 各親施設が何個の子スポットを持つか数える
    child_counts = (
        spots[spots["parent_id"] != ""]
        .groupby("parent_id")
        .size()
        .to_dict()
    )

    categories = (
        area_spots["category"]
        .drop_duplicates()
        .tolist()
    )

    hero_image = area_spots.iloc[0]["image"]

    return render_template(
        "area.html",
        area_name=area_name,
        area_info=AREA_INFO[area_name],
        hero_image=hero_image,
        categories=categories,
        spots=area_spots.to_dict(orient="records"),
        child_counts=child_counts,
        seo_title=f"淡路島 {area_name}の観光スポット | TabiRoute",
        seo_description=clean_description(
            f"淡路島の{area_name}エリアの観光スポットを紹介。{AREA_INFO[area_name]['description']} 気になる場所を旅行プランに追加できます。"
        ),
        canonical_url=absolute_url("area", area_name=area_name)
    )

@app.route("/spot/<spot_id>")
def spot_detail(spot_id):
    spots = load_spots()

    matched = spots[spots["id"] == spot_id]

    if matched.empty:
        abort(404)

    spot = matched.iloc[0].to_dict()

    # このスポットを親とする子スポット
    children = spots[
        spots["parent_id"] == spot_id
    ].to_dict(orient="records")

    # 子スポットを開いた場合、その親も取得
    parent = None

    if spot["parent_id"]:
        parent_match = spots[
            spots["id"] == spot["parent_id"]
        ]

        if not parent_match.empty:
            parent = parent_match.iloc[0].to_dict()

    return render_template(
        "spot.html",
        spot=spot,
        children=children,
        parent=parent,
        seo_title=f"{spot['name']}｜淡路島の観光・おでかけ情報 | TabiRoute",
        seo_description=clean_description(
            f"{spot['name']}（淡路島・{spot['area']}）の旅行情報。{spot.get('description', '')}"
        ),
        canonical_url=absolute_url("spot_detail", spot_id=spot_id)
    )


# ============================================================
# v32 目的別SEOガイド
# ============================================================

@app.route("/guide")
def guide_index():
    """
    目的別ガイドの一覧ページを表示します。
    検索流入だけでなく、トップページから目的別に探したい人の入口にも使います。
    """
    spots = load_spots()
    spot_map = {
        str(row["id"]): row.to_dict()
        for _, row in spots.iterrows()
    }

    guide_cards = []

    for slug, guide in GUIDE_PAGES.items():
        hero_spot = spot_map.get(guide.get("hero_spot_id", ""), {})
        guide_cards.append({
            "slug": slug,
            "guide": guide,
            "hero_image": hero_spot.get("image", ""),
            "hero_credit": hero_spot.get("image_credit", ""),
            "hero_license": hero_spot.get("image_license", "")
        })

    return render_template(
        "guide_index.html",
        guides=GUIDE_PAGES,
        guide_cards=guide_cards,
        seo_title="淡路島旅行の目的別ガイド・モデルコース | TabiRoute",
        seo_description="淡路島1泊2日、車なし、雨の日、カップル、子連れ、西海岸など、目的別に観光スポット候補を探して旅行プランを作れます。",
        canonical_url=absolute_url("guide_index")
    )


@app.route("/guide/<slug>")
def guide_detail(slug):
    """
    目的別ガイド1ページを表示します。

    GUIDE_PAGESに存在しないslugの場合は404を返します。
    紹介スポットはspots.csvから取得するため、
    スポット名や画像をHTMLへ重複して直書きしません。
    """
    guide = GUIDE_PAGES.get(slug)

    if guide is None:
        abort(404)

    spots = load_spots()

    # GUIDE_PAGESで指定した順番をそのまま維持してスポットを取得します。
    spot_map = {
        str(row["id"]): row.to_dict()
        for _, row in spots.iterrows()
    }

    selected_spots = [
        spot_map[spot_id]
        for spot_id in guide["spot_ids"]
        if spot_id in spot_map
    ]

    hero_spot = spot_map.get(
        guide.get("hero_spot_id", ""),
        selected_spots[0] if selected_spots else {}
    )

    return render_template(
        "guide_detail.html",
        slug=slug,
        guide=guide,
        spots=selected_spots,
        hero_spot=hero_spot,
        seo_title=guide["seo_title"],
        seo_description=guide["seo_description"],
        canonical_url=absolute_url("guide_detail", slug=slug)
    )

@app.route("/plan")
def plan():
    return render_template("plan.html")

@app.route("/api/spots")
def api_spots():
    spots = load_spots()

    area_name = request.args.get("area", "").strip()
    category = request.args.get("category", "").strip()
    parent_id = request.args.get("parent_id", "").strip()
    keyword = request.args.get("q", "").strip()
    level = request.args.get("level", "").strip()

    if area_name:
        spots = spots[spots["area"] == area_name]

    if category:
        spots = spots[spots["category"] == category]

    if parent_id:
        spots = spots[spots["parent_id"] == parent_id]

    if level == "top":
        spots = spots[spots["parent_id"] == ""]

    if level == "child":
        spots = spots[spots["parent_id"] != ""]

    if keyword:
        search_text = (
            spots["name"].astype(str)
            + " "
            + spots["description"].astype(str)
            + " "
            + spots["parent_name"].astype(str)
        ).str.lower()

        spots = spots[
            search_text.str.contains(
                keyword.lower(),
                regex=False
            )
        ]

    records = spots.to_dict(orient="records")

    return jsonify({
        "count": len(records),
        "spots": records
    })

@app.route("/api/spots/<spot_id>")
def api_spot_detail(spot_id):
    spots = load_spots()

    matched = spots[spots["id"] == spot_id]

    if matched.empty:
        return jsonify({"error": "spot not found"}), 404

    spot = matched.iloc[0].to_dict()

    children = spots[
        spots["parent_id"] == spot_id
    ].to_dict(orient="records")

    return jsonify({
        "spot": spot,
        "children": children
    })




# ============================================================
# v25 ローカル周辺検索
#
# 外部APIを使わず、spots.csv の登録スポットだけで候補を返す。
# 「同じ施設 → 同じ住所 → 同じエリア → 淡路島全体」の順で優先。
# ============================================================

@app.route("/api/local/nearby")
def local_nearby():
    spots = load_spots().copy()

    spot_id = request.args.get("id", "").strip()
    name = request.args.get("name", "").strip()
    address = request.args.get("address", "").strip()
    area = request.args.get("area", "").strip()
    parent_name = request.args.get("parent_name", "").strip()
    category = request.args.get("category", "すべて").strip()
    scope = request.args.get("scope", "area").strip()

    current = None

    if spot_id:
        matched = spots[spots["id"].astype(str) == str(spot_id)]
        if not matched.empty:
            current = matched.iloc[0].to_dict()

    if current is None and name:
        matched = spots[spots["name"].astype(str) == name]
        if not matched.empty:
            current = matched.iloc[0].to_dict()

    current_name = name
    current_address = address
    current_area = area
    current_parent = parent_name

    if current is not None:
        current_name = str(current.get("name", "") or "")
        current_address = str(current.get("address", "") or "")
        current_area = str(current.get("area", "") or "")
        current_parent = str(current.get("parent_name", "") or "")

        # 親施設自身なら、その施設名を基準にする
        if not current_parent:
            children = spots[
                spots["parent_name"].astype(str) == current_name
            ]
            if not children.empty:
                current_parent = current_name

    # 自分自身を除外
    if current_name:
        spots = spots[
            spots["name"].astype(str) != current_name
        ]

    # カテゴリ絞り込み
    if category and category != "すべて":
        category_map = {
            "観光": [
                "観光", "自然", "歴史", "文化", "建築",
                "庭園", "植物園", "公園", "動物",
                "体験", "アトラクション", "街歩き", "複合施設"
            ],
            "グルメ": ["グルメ"],
            "温泉": ["温泉"],
            "ホテル": ["ホテル"],
        }

        allowed = category_map.get(category, [category])

        spots = spots[
            spots["category"].astype(str).isin(allowed)
        ]

    records = spots.to_dict(orient="records")

    def score(item):
        item_parent = str(item.get("parent_name", "") or "")
        item_address = str(item.get("address", "") or "")
        item_area = str(item.get("area", "") or "")

        same_parent = bool(
            current_parent
            and (
                item_parent == current_parent
                or str(item.get("name", "") or "") == current_parent
            )
        )

        same_address = bool(
            current_address
            and item_address
            and item_address == current_address
        )

        same_area = bool(
            current_area
            and item_area == current_area
        )

        if same_parent:
            rank = 0
            relation = "同じ施設内"
        elif same_address:
            rank = 1
            relation = "同じ住所"
        elif same_area:
            rank = 2
            relation = f"{current_area}エリア"
        else:
            rank = 3
            relation = "淡路島内"

        return rank, relation

    ranked = []

    for item in records:
        rank, relation = score(item)

        if scope == "facility" and rank > 1:
            continue

        if scope == "area" and rank > 2:
            continue

        item["nearby_relation"] = relation
        item["nearby_rank"] = rank
        item["external"] = False
        item["source"] = "TabiRoute"
        ranked.append(item)

    ranked.sort(
        key=lambda item: (
            int(item.get("nearby_rank", 9)),
            str(item.get("category", "")),
            str(item.get("name", ""))
        )
    )

    return jsonify({
        "count": len(ranked[:40]),
        "places": ranked[:40],
        "scope": scope,
        "category": category,
        "mode": "local"
    })



# ============================================================
# OpenStreetMap検索API
# ============================================================

@app.route("/api/osm/search")
def osm_search():
    if not rate_limit("nominatim", 30, 60):
        return jsonify({
            "error": "位置検索の利用回数が多すぎます。少し待ってから再試行してください。"
        }), 429

    global LAST_OSM_REQUEST_AT

    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"count": 0, "places": []})

    normalized_query = f"{query} 淡路島 兵庫県"
    cache_key = normalized_query.lower()

    if cache_key in OSM_SEARCH_CACHE:
        return jsonify({
            "count": len(OSM_SEARCH_CACHE[cache_key]),
            "places": OSM_SEARCH_CACHE[cache_key],
            "cached": True
        })

    elapsed = time.time() - LAST_OSM_REQUEST_AT
    if elapsed < 1.0:
        time.sleep(1.0 - elapsed)

    try:
        response = requests.get(
            NOMINATIM_SEARCH_URL,
            params={
                "q": normalized_query,
                "format": "jsonv2",
                "limit": 8,
                "addressdetails": 1,
                "extratags": 1,
                "namedetails": 1,
                "countrycodes": "jp"
            },
            headers={
                "User-Agent": "TabiRoute-Awaji/1.0 (public travel planner; contact via site)"
            },
            timeout=10
        )
        LAST_OSM_REQUEST_AT = time.time()
        response.raise_for_status()
        raw_places = response.json()
    except (requests.RequestException, ValueError) as error:
        content_type = ""
        preview = ""

        try:
            content_type = response.headers.get("Content-Type", "")
            preview = response.text[:180]
        except Exception:
            pass

        return jsonify({
            "error": "OpenStreetMap検索に失敗しました。",
            "detail": str(error),
            "content_type": content_type,
            "preview": preview
        }), 502

    places = []

    for item in raw_places:
        display_name = item.get("display_name", "")

        if not any(word in display_name for word in ["淡路", "洲本", "南あわじ"]):
            continue

        name = (
            item.get("namedetails", {}).get("name")
            or display_name.split(",")[0]
        )

        osm_type = item.get("osm_type", "")
        osm_id = str(item.get("osm_id", ""))
        external_id = f"osm-{osm_type}-{osm_id}"

        places.append({
            "id": external_id,
            "name": name,
            "area": "API検索",
            "parent_id": "",
            "parent_name": "",
            "category": item.get("type") or item.get("class") or "スポット",
            "description": display_name,
            "address": display_name,
            "image": "",
            "source_url": (
                f"https://www.openstreetmap.org/{osm_type}/{osm_id}"
                if osm_type in ["node", "way", "relation"] and osm_id
                else "https://www.openstreetmap.org/"
            ),
            "lat": float(item["lat"]),
            "lon": float(item["lon"]),
            "external": True,
            "source": "OpenStreetMap"
        })

    OSM_SEARCH_CACHE[cache_key] = places

    return jsonify({
        "count": len(places),
        "places": places,
        "cached": False
    })



# ============================================================
# OpenStreetMap 周辺スポット探索API
# ============================================================

def haversine_distance_m(lat1, lon1, lat2, lon2):

    import math

    radius = 6371000.0

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)

    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(d_phi / 2) ** 2
        +
        math.cos(phi1)
        *
        math.cos(phi2)
        *
        math.sin(d_lambda / 2) ** 2
    )

    return (
        2
        *
        radius
        *
        math.atan2(
            math.sqrt(a),
            math.sqrt(1 - a)
        )
    )


def osm_category_from_tags(tags):

    if tags.get("tourism"):
        return tags.get("tourism")

    if tags.get("historic"):
        return "歴史・文化"

    if tags.get("amenity"):
        amenity_labels = {
            "restaurant": "レストラン",
            "cafe": "カフェ",
            "fast_food": "飲食",
            "ice_cream": "スイーツ",
            "bar": "バー",
            "pub": "飲食",
            "marketplace": "市場",
            "place_of_worship": "寺社",
            "arts_centre": "文化施設",
            "theatre": "劇場"
        }

        return amenity_labels.get(
            tags.get("amenity"),
            tags.get("amenity")
        )

    if tags.get("leisure"):
        return tags.get("leisure")

    if tags.get("natural"):
        return "自然"

    if tags.get("shop"):
        return "ショップ"

    return "スポット"


# ============================================================
# OSRM 車ルートAPI
# ============================================================

@app.route("/api/route", methods=["POST"])
def route_api():
    if not rate_limit("route", 20, 60):
        return jsonify({
            "error": "経路計算の利用回数が多すぎます。少し待ってから再試行してください。"
        }), 429

    payload = request.get_json(silent=True) or {}
    points = payload.get("points", [])

    if len(points) < 2:
        return jsonify({"error": "2地点以上必要です。"}), 400

    points = points[:10]

    try:
        normalized = [
            {
                "lat": float(point["lat"]),
                "lon": float(point["lon"])
            }
            for point in points
        ]
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "座標データが不正です。"}), 400

    coordinates = ";".join(
        f"{point['lon']},{point['lat']}"
        for point in normalized
    )

    url = f"{OSRM_ROUTE_URL}/route/v1/driving/{coordinates}"

    try:
        response = requests.get(
            url,
            params={
                "overview": "full",
                "geometries": "geojson",
                "steps": "false"
            },
            headers={"User-Agent": "TabiRoute-Awaji/1.0"},
            timeout=10
        )
        response.raise_for_status()
        data = response.json()

        if data.get("code") == "Ok" and data.get("routes"):
            route = data["routes"][0]
            return jsonify({
                "distance_m": route.get("distance", 0),
                "duration_s": route.get("duration", 0),
                "geometry": route.get("geometry"),
                "legs": [
                    {
                        "distance_m": leg.get("distance", 0),
                        "duration_s": leg.get("duration", 0)
                    }
                    for leg in route.get("legs", [])
                ],
                "estimated": False,
                "source": "OSRM"
            })

    except (requests.RequestException, ValueError):
        pass

    # OSRM停止・タイムアウト時でもアプリ本体は使える
    return jsonify(estimated_route(normalized))


# ============================================================
# OSRM おすすめ順API
# ============================================================

@app.route("/api/route/optimize", methods=["POST"])
def optimize_route_api():
    if not rate_limit("route-optimize", 15, 60):
        return jsonify({
            "error": "おすすめ順計算の利用回数が多すぎます。少し待ってから再試行してください。"
        }), 429

    payload = request.get_json(silent=True) or {}
    points = payload.get("points", [])

    if len(points) < 2:
        return jsonify({"error": "2地点以上必要です。"}), 400

    points = points[:10]

    try:
        normalized = [
            {
                "lat": float(point["lat"]),
                "lon": float(point["lon"])
            }
            for point in points
        ]
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "座標データが不正です。"}), 400

    coordinates = ";".join(
        f"{point['lon']},{point['lat']}"
        for point in normalized
    )
    url = f"{OSRM_ROUTE_URL}/trip/v1/driving/{coordinates}"

    try:
        response = requests.get(
            url,
            params={
                "roundtrip": "false",
                "source": "first",
                "destination": "last",
                "overview": "full",
                "geometries": "geojson",
                "steps": "false"
            },
            headers={"User-Agent": "TabiRoute-Awaji/1.0"},
            timeout=10
        )
        response.raise_for_status()
        data = response.json()

        if data.get("code") == "Ok" and data.get("trips"):
            ordered = sorted(
                enumerate(data.get("waypoints", [])),
                key=lambda pair: pair[1].get("waypoint_index", pair[0])
            )
            order = [original_index for original_index, _ in ordered]
            trip = data["trips"][0]

            return jsonify({
                "order": order,
                "distance_m": trip.get("distance", 0),
                "duration_s": trip.get("duration", 0),
                "geometry": trip.get("geometry"),
                "estimated": False,
                "source": "OSRM"
            })

    except (requests.RequestException, ValueError):
        pass

    order = nearest_neighbor_order(normalized)
    return jsonify({
        "order": order,
        "distance_m": 0,
        "duration_s": 0,
        "geometry": None,
        "estimated": True,
        "source": "local-nearest-neighbor"
    })



# ============================================================
# v31 SEO: robots.txt / sitemap.xml
# ============================================================

@app.route("/robots.txt")
def robots_txt():
    content = "\n".join([
        "User-agent: *",
        "Allow: /",
        "Disallow: /api/",
        "",
        f"Sitemap: {absolute_url('sitemap_xml')}",
        ""
    ])
    return Response(content, mimetype="text/plain")


@app.route("/sitemap.xml")
def sitemap_xml():
    from xml.sax.saxutils import escape

    spots = load_spots()

    urls = [
        absolute_url("home"),
        absolute_url("guide_index")
    ]

    # 目的別SEOガイドもGoogleへ通知します。
    for slug in GUIDE_PAGES.keys():
        urls.append(
            absolute_url("guide_detail", slug=slug)
        )

    for area_name in AREA_INFO.keys():
        urls.append(
            absolute_url("area", area_name=area_name)
        )

    for spot_id in spots["id"].astype(str).tolist():
        urls.append(
            absolute_url("spot_detail", spot_id=spot_id)
        )

    items = "".join(
        f"<url><loc>{escape(url)}</loc></url>"
        for url in urls
    )

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        + items
        + "</urlset>"
    )

    return Response(xml, mimetype="application/xml")

# ============================================================
# 写真クレジットページ
# ============================================================

@app.route("/credits")
def credits():
    spots = load_spots()
    photo_spots = spots[spots["image_credit"].astype(str).str.strip() != ""]
    return render_template("credits.html", photo_spots=photo_spots.to_dict(orient="records"))



# ============================================================
# AI旅行プランナー
# ============================================================

AI_PREFERENCE_RULES = {

    "anime": {
        "label": "アニメ・テーマパーク",
        "keywords": [
            "アニメ",
            "アトラクション",
            "ニジゲンノモリ",
            "ドラゴンクエスト",
            "NARUTO",
            "ゴジラ",
            "クレヨンしんちゃん",
            "進撃の巨人",
            "ハローキティ"
        ]
    },

    "scenery": {
        "label": "景色・自然・花",
        "keywords": [
            "自然",
            "庭園",
            "公園",
            "海",
            "花",
            "景勝",
            "夕景",
            "水仙",
            "滝",
            "展望"
        ]
    },

    "onsen": {
        "label": "温泉",
        "keywords": [
            "温泉",
            "露天風呂",
            "温浴",
            "香りの湯"
        ]
    },

    "history": {
        "label": "歴史・神社・城",
        "keywords": [
            "歴史",
            "神社",
            "城",
            "城跡",
            "寺院",
            "震災",
            "遺跡",
            "神話"
        ]
    },

    "food": {
        "label": "グルメ",
        "keywords": [
            "グルメ",
            "レストラン",
            "カフェ",
            "食",
            "道の駅",
            "マルシェ"
        ]
    },

    "experience": {
        "label": "体験・動物",
        "keywords": [
            "体験",
            "動物",
            "牧場",
            "クルーズ",
            "ふれあい",
            "農業"
        ]
    },

    "culture": {
        "label": "建築・文化",
        "keywords": [
            "文化",
            "建築",
            "美術館",
            "人形",
            "劇場",
            "フォーラム",
            "教会"
        ]
    }
}


AI_AREA_ORDER = {
    "岩屋・北部": 1,
    "東海岸": 2,
    "西海岸": 3,
    "洲本・中部": 4,
    "南あわじ": 5
}


def score_ai_spot(spot, preferences):

    text = " ".join([
        str(spot.get("name", "")),
        str(spot.get("category", "")),
        str(spot.get("description", "")),
        str(spot.get("parent_name", ""))
    ]).lower()

    score = 0

    # --------------------------------------------------------
    # ユーザーの好みに一致するほど高得点
    # --------------------------------------------------------

    for preference in preferences:

        rule = AI_PREFERENCE_RULES.get(preference)

        if not rule:
            continue

        for keyword in rule["keywords"]:

            if keyword.lower() in text:
                score += 5


    # --------------------------------------------------------
    # 子スポットは具体性が高いので少し加点
    # --------------------------------------------------------

    if str(spot.get("parent_id", "")).strip():
        score += 1


    # --------------------------------------------------------
    # 複合施設そのものより、
    # 中の具体的スポットを優先しすぎないよう調整
    # --------------------------------------------------------

    if spot.get("category") == "複合施設":
        score += 2


    # --------------------------------------------------------
    # 何も好みに当たらなくても候補から完全には消さない
    # --------------------------------------------------------

    if score == 0:
        score = 1


    return score


def build_ai_plan(spots, days, pace, preferences):

    # --------------------------------------------------------
    # 1日あたりのスポット数
    # --------------------------------------------------------

    per_day = {
        "slow": 3,
        "normal": 4,
        "full": 5
    }.get(pace, 4)

    target_count = max(
        2,
        min(
            len(spots),
            days * per_day
        )
    )


    # --------------------------------------------------------
    # スポットを採点
    # --------------------------------------------------------

    candidates = []

    for _, row in spots.iterrows():

        spot = row.to_dict()

        spot["_score"] = score_ai_spot(
            spot,
            preferences
        )

        spot["_area_order"] = AI_AREA_ORDER.get(
            spot.get("area"),
            99
        )

        candidates.append(
            spot
        )


    # --------------------------------------------------------
    # 高得点順
    # --------------------------------------------------------

    candidates.sort(
        key=lambda spot: (
            -spot["_score"],
            spot["_area_order"],
            spot.get("name", "")
        )
    )


    # --------------------------------------------------------
    # 同じ親施設ばかりにならないよう制御
    # --------------------------------------------------------

    selected = []
    parent_counts = {}
    area_counts = {}

    for spot in candidates:

        parent_key = (
            spot.get("parent_id")
            or
            spot.get("id")
        )

        parent_count = parent_counts.get(
            parent_key,
            0
        )

        # 同じ親施設からは最大2件
        if parent_count >= 2:
            continue

        area_name = spot.get("area", "")

        # 同じエリアだけになりすぎない
        max_area_count = max(
            2,
            days * 2
        )

        if area_counts.get(area_name, 0) >= max_area_count:
            continue

        selected.append(
            spot
        )

        parent_counts[parent_key] = (
            parent_count + 1
        )

        area_counts[area_name] = (
            area_counts.get(area_name, 0)
            + 1
        )

        if len(selected) >= target_count:
            break


    # --------------------------------------------------------
    # 件数不足なら制限を緩めて補充
    # --------------------------------------------------------

    if len(selected) < target_count:

        selected_ids = {
            str(spot["id"])
            for spot in selected
        }

        for spot in candidates:

            if str(spot["id"]) in selected_ids:
                continue

            selected.append(
                spot
            )

            if len(selected) >= target_count:
                break


    # --------------------------------------------------------
    # エリア順に並べ、近いエリアを同じ日にまとめる
    # --------------------------------------------------------

    selected.sort(
        key=lambda spot: (
            spot["_area_order"],
            -spot["_score"],
            spot.get("parent_name", ""),
            spot.get("name", "")
        )
    )


    # --------------------------------------------------------
    # 日ごとの件数に分割
    # --------------------------------------------------------

    plan = []

    time_slots = {
        3: ["09:30", "13:00", "16:00"],
        4: ["09:30", "12:00", "14:30", "17:00"],
        5: ["09:00", "11:15", "13:30", "15:45", "18:00"]
    }

    slots = time_slots.get(
        per_day,
        time_slots[4]
    )

    for index, spot in enumerate(selected):

        day = min(
            days,
            (index // per_day) + 1
        )

        position = index % per_day

        time_value = (
            slots[position]
            if position < len(slots)
            else ""
        )

        plan.append({
            "id": str(spot["id"]),
            "day": day,
            "time": time_value
        })


    # --------------------------------------------------------
    # APIへ返す表示用データ
    # --------------------------------------------------------

    clean_selected = []

    for spot in selected:

        clean_spot = {
            key: value
            for key, value in spot.items()
            if not key.startswith("_")
        }

        clean_selected.append(
            clean_spot
        )


    return {
        "plan": plan,
        "selected_spots": clean_selected,
        "days": days,
        "pace": pace,
        "count": len(plan)
    }


@app.route("/ai-plan")
def ai_plan():

    return render_template(
        "ai_plan.html"
    )


@app.route("/api/ai-plan", methods=["POST"])
def api_ai_plan():

    payload = request.get_json(
        silent=True
    ) or {}

    try:
        days = int(
            payload.get(
                "days",
                1
            )
        )
    except (TypeError, ValueError):
        days = 1

    days = max(
        1,
        min(
            days,
            3
        )
    )

    pace = payload.get(
        "pace",
        "normal"
    )

    preferences = payload.get(
        "preferences",
        []
    )

    if not isinstance(
        preferences,
        list
    ):
        preferences = []


    spots = load_spots()


    # --------------------------------------------------------
    # 「単なる施設名」だけではなく、
    # 親施設・施設内スポットの両方を候補にする
    # --------------------------------------------------------

    result = build_ai_plan(
        spots,
        days,
        pace,
        preferences
    )


    if not result.get("plan"):

        return jsonify({
            "error":
                "おまかせプランの候補を作成できませんでした。"
        }), 500


    return jsonify(
        result
    )




# ============================================================
# 共有URL受け取りページ
# ============================================================

@app.route("/share")
def share_plan():

    # 旅行プラン本体はURLの # 以降に入るため、
    # Flask / Render サーバーには送信されません。
    # このページはブラウザ側JavaScriptで復元するための画面だけ返します。

    return render_template(
        "share.html"
    )



# ============================================================
# ヘルプ / 使い方
# ============================================================

@app.route("/help")
def help_page():

    return render_template(
        "help.html"
    )


@app.route("/privacy")
def privacy():
    return render_template("privacy.html")


@app.route("/terms")
def terms():
    return render_template("terms.html")





@app.route("/api/version")
def api_version():
    return jsonify({
        "version": "37",
        "auto_plan": "fixed",
        "nearby_mode": "local-only",
        "overpass": False,
        "external_nearby_api": False
    })


if __name__ == "__main__":
    app.run(debug=True, port=5001)
