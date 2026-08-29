console.info("TabiRoute v30 / safety=public-release / external APIs optional");
console.info("TabiRoute v28 / auto-plan=fixed / single-entry");
console.info("TabiRoute v27 / local plan portability / JSON + PDF");
// ============================================================
// v24: NominatimもRenderを通さずブラウザから直接検索
// ============================================================

async function browserNominatimSearch(
    query
) {

    // v30:
    // 公開NominatimへのアクセスはRender側 /api/osm/search に集約。
    // サーバー側でキャッシュ・1秒間隔・IP別レート制限を行う。
    const {
        response,
        data
    } =
        await fetchJsonSafe(
            "/api/osm/search?q="
            +
            encodeURIComponent(
                query
            )
        );


    if (!response.ok) {

        throw new Error(
            data.error
            ||
            `位置検索HTTP ${response.status}`
        );
    }


    return Array.isArray(
        data.places
    )
        ?
        data.places
        :
        [];
}


async function fetchJsonSafe(
    url,
    options = {}
) {

    const response =
        await fetch(
            url,
            options
        );


    const text =
        await response.text();


    let data = null;


    try {

        data =
            text
                ?
                JSON.parse(
                    text
                )
                :
                {};

    } catch (error) {

        const preview =
            text
                .replace(
                    /\s+/g,
                    " "
                )
                .slice(
                    0,
                    140
                );


        throw new Error(
            `APIからJSONではない応答が返りました。HTTP ${response.status} / ${preview}`
        );
    }


    return {
        response,
        data
    };
}


// ============================================================
// TabiRoute v7
// app.js
// ============================================================
//
// 【目次】
// 1. 初期処理
// 2. カテゴリ絞り込み
// 3. 旅行プランデータ取得
// 4. 旅行プランデータ保存
// 5. 旧バージョンからデータ移行
// 6. 旅行プランへ追加
// 7. ヘッダー件数表示
// 8. 追加ボタン表示復元
// 9. APIから全スポット取得
// 10. 旅行プラン概要更新
// 11. 旅行プラン一覧描画
// 12. 日数追加
// 13. 日付変更
// 14. 時間変更
// 15. 順番変更
// 16. エリア順に整理
// 17. 個別削除
// 18. 全削除
// 19. トースト表示
// 20. HTMLエスケープ
//
// ============================================================


// ============================================================
// 1. 初期処理
// ============================================================

document.addEventListener(
    "DOMContentLoaded",
    async function() {

        migrateTravelPlanData();

        updatePlanBadge();

        restoreTravelPlanButtons();

        await renderTravelPlan();
    }
);


// ============================================================
// 2. カテゴリ絞り込み
// ============================================================

function filterSpots(category, button) {

    document
        .querySelectorAll(".spot-card")
        .forEach(function(card) {

            const show =
                category === "all"
                ||
                card.dataset.category === category;


            card.style.display =
                show
                    ? ""
                    : "none";
        });


    document
        .querySelectorAll(".filter-button")
        .forEach(function(item) {

            item.classList.remove(
                "active"
            );
        });


    if (button) {

        button.classList.add(
            "active"
        );
    }
}


// ============================================================
// 3. 旅行プランデータ取得
// ============================================================

function getTravelPlan() {

    const saved =
        localStorage.getItem(
            "awajiTravelPlan"
        );


    if (!saved) {

        return [];
    }


    try {

        const parsed =
            JSON.parse(saved);


        if (!Array.isArray(parsed)) {

            return [];
        }


        return parsed;

    } catch (error) {

        return [];
    }
}


// ============================================================
// 4. 旅行プランデータ保存
// ============================================================

function saveTravelPlan(plan) {

    localStorage.setItem(
        "awajiTravelPlan",
        JSON.stringify(plan)
    );


    updatePlanBadge();
}


// ============================================================
// 5. 旧バージョンからデータ移行
// ============================================================

function migrateTravelPlanData() {

    const saved =
        localStorage.getItem(
            "awajiTravelPlan"
        );


    if (!saved) {

        return;
    }


    try {

        const parsed =
            JSON.parse(saved);


        if (!Array.isArray(parsed)) {

            return;
        }


        // --------------------------------------------
        // v5・v6:
        // ["nijigen", "yumebutai"]
        //
        // ↓
        //
        // v7:
        // [
        //   {
        //     id: "nijigen",
        //     day: 1,
        //     time: ""
        //   }
        // ]
        // --------------------------------------------

        if (
            parsed.length === 0
        ) {

            return;
        }


        if (
            parsed.every(
                item =>
                    typeof item === "string"
            )
        ) {

            const converted =
                parsed.map(
                    function(id) {

                        return {

                            id:
                                String(id),

                            day:
                                1,

                            time:
                                ""
                        };
                    }
                );


            saveTravelPlan(
                converted
            );


            return;
        }


        // --------------------------------------------
        // v4:
        // [{ id, name, area ... }]
        //
        // day/timeが無ければ追加する
        // --------------------------------------------

        if (
            parsed.every(
                item =>
                    typeof item === "object"
                    &&
                    item !== null
                    &&
                    item.id
            )
        ) {

            let changed =
                false;


            const converted =
                parsed.map(
                    function(item) {

                        const newItem = {

                            id:
                                String(item.id),

                            day:
                                Number(item.day) || 1,

                            time:
                                item.time || ""
                        };


                        if (
                            !("day" in item)
                            ||
                            !("time" in item)
                        ) {

                            changed =
                                true;
                        }


                        return newItem;
                    }
                );


            if (changed) {

                saveTravelPlan(
                    converted
                );
            }
        }

    } catch (error) {

        console.error(
            "旅行プランの移行に失敗しました。",
            error
        );
    }
}


// ============================================================
// 6. 旅行プランへ追加
// ============================================================

function addToPlan(button) {

    const spotId = String(button.dataset.planId);
    const spotName = button.dataset.planName;
    const plan = getTravelPlan();

    const exists = plan.some(
        item => String(item.id) === spotId
    );

    if (exists) {
        showToast(
            spotName + " はすでに旅行プランに入っています。"
        );
        return;
    }

    const item = {
        id: spotId,
        day: 1,
        time: ""
    };

    // CSVに存在しないOpenStreetMap検索結果は、
    // 地図に必要な情報もlocalStorageへ一緒に保存する。
    if (button.dataset.external === "true") {
        item.externalSpot = {
            id: spotId,
            name: spotName,
            area: button.dataset.area || "API検索",
            parent_name: "",
            category: button.dataset.category || "スポット",
            description: button.dataset.description || "",
            address: button.dataset.address || "",
            source_url: button.dataset.sourceUrl || "",
            lat: Number(button.dataset.lat),
            lon: Number(button.dataset.lon),
            external: true,
            source: "OpenStreetMap"
        };
    }

    plan.push(item);
    saveTravelPlan(plan);
    restoreTravelPlanButtons();

    showToast(
        spotName + " を旅行プランに追加しました。"
    );

    // 旅行プラン画面からAPI検索して追加した場合、
    // その場で画面と地図を更新する。
    renderTravelPlan();
}


// ============================================================
// 7. ヘッダー件数表示
// ============================================================

function updatePlanBadge() {

    const count =
        getTravelPlan().length;


    document
        .querySelectorAll(".plan-count-badge")
        .forEach(function(badge) {

            badge.textContent =
                count;


            badge.style.display =
                count > 0
                    ? "inline-flex"
                    : "none";
        });
}


// ============================================================
// 8. 追加ボタン表示復元
// ============================================================

function restoreTravelPlanButtons() {

    const plan =
        getTravelPlan();


    const ids =
        plan.map(
            item =>
                String(item.id)
        );


    document
        .querySelectorAll("[data-plan-id]")
        .forEach(function(button) {

            const exists =
                ids.includes(
                    String(
                        button.dataset.planId
                    )
                );


            button.textContent =
                exists
                    ? "追加済み ✓"
                    : "旅行プランに追加";


            button.classList.toggle(
                "is-added",
                exists
            );
        });


    updatePlanBadge();
}


// ============================================================
// 9. APIから全スポット取得
// ============================================================

async function fetchAllSpots() {

    const response =
        await fetch(
            "/api/spots"
        );


    if (!response.ok) {

        throw new Error(
            "スポットAPIの取得に失敗しました。"
        );
    }


    const data =
        await response.json();


    return data.spots;
}


// ============================================================
// 10. 旅行プラン概要更新
// ============================================================

function updatePlanSummary(
    plan,
    totalDays
) {

    const spotCount =
        document.getElementById(
            "summary-spot-count"
        );


    const dayCount =
        document.getElementById(
            "summary-day-count"
        );


    const nextStep =
        document.getElementById(
            "summary-next-step"
        );


    if (
        !spotCount
        ||
        !dayCount
        ||
        !nextStep
    ) {

        return;
    }


    spotCount.textContent =
        plan.length;


    dayCount.textContent =
        totalDays;


    if (plan.length === 0) {

        nextStep.textContent =
            "行きたいスポットを追加しよう";

        return;
    }


    const noTimeCount =
        plan.filter(
            item =>
                !item.time
        ).length;


    if (noTimeCount > 0) {

        nextStep.textContent =
            `あと${noTimeCount}件、時間を決めると見やすくなります`;

    } else {

        nextStep.textContent =
            "プラン完成！順番を確認しよう";
    }
}


// ============================================================
// 11. 旅行プラン一覧描画
// ============================================================

async function renderTravelPlan() {

    const list =
        document.getElementById(
            "travel-plan-list"
        );


    // plan.html以外では終了
    if (!list) {

        return;
    }


    const empty =
        document.getElementById(
            "travel-plan-empty"
        );


    const actions =
        document.getElementById(
            "travel-plan-actions"
        );


    const tools =
        document.getElementById(
            "plan-tools"
        );


    const status =
        document.getElementById(
            "api-status"
        );


    const plan =
        getTravelPlan();


    const savedDays =
        Number(
            localStorage.getItem(
                "awajiTravelDays"
            )
        );


    const maxUsedDay =
        plan.length
            ? Math.max(
                ...plan.map(
                    item =>
                        Number(item.day) || 1
                )
            )
            : 1;


    const totalDays =
        Math.max(
            1,
            savedDays || 1,
            maxUsedDay
        );


    localStorage.setItem(
        "awajiTravelDays",
        String(totalDays)
    );


    updatePlanSummary(
        plan,
        totalDays
    );


    list.innerHTML =
        "";


    if (plan.length === 0) {

        empty.style.display =
            "block";

        actions.style.display =
            "none";

        tools.style.display =
            "flex";

        status.textContent =
            "旅行プランはまだ空です。";

        return;
    }


    try {

        status.textContent =
            "TabiRoute APIからスポット情報を取得中...";


        const spots =
            await fetchAllSpots();


        window.tabirouteAllSpots =
            spots;


        const spotMap =
            new Map(
                spots.map(
                    spot => [
                        String(spot.id),
                        spot
                    ]
                )
            );


        // OpenStreetMap検索から追加したスポットも同じ辞書へ入れる
        plan.forEach(function(item) {

            if (item.externalSpot) {

                spotMap.set(
                    String(item.id),
                    item.externalSpot
                );
            }
        });


        window.tabirouteSpotMap =
            spotMap;


        empty.style.display =
            "none";

        actions.style.display =
            "flex";

        tools.style.display =
            "flex";


        status.textContent =
            `APIから${spots.length}件のスポット情報を取得しました。`;


        // --------------------------------------------
        // 1日目、2日目...を順番に描画
        // --------------------------------------------

        for (
            let day = 1;
            day <= totalDays;
            day++
        ) {

            const daySection =
                document.createElement(
                    "section"
                );


            daySection.className =
                "travel-day";


            const dayItems =
                plan.filter(
                    item =>
                        Number(item.day) === day
                );


            daySection.innerHTML = `
                <div class="travel-day-header">

                    <div>
                        <p class="section-label">
                            DAY ${day}
                        </p>

                        <h2>
                            ${day}日目
                        </h2>
                    </div>

                    <span class="travel-day-count">
                        ${dayItems.length}件
                    </span>

                </div>

                <div
                    class="travel-day-list"
                    data-day="${day}"
                ></div>
            `;


            const dayList =
                daySection.querySelector(
                    ".travel-day-list"
                );


            if (
                dayItems.length === 0
            ) {

                dayList.innerHTML = `
                    <div class="day-empty">
                        この日はまだ予定がありません。
                    </div>
                `;

            } else {

                dayItems.forEach(
                    function(planItem, dayIndex) {

                        const spot =
                            spotMap.get(
                                String(
                                    planItem.id
                                )
                            );


                        if (!spot) {

                            return;
                        }


                        const card =
                            createPlanCard(
                                spot,
                                planItem,
                                dayIndex,
                                dayItems.length,
                                totalDays
                            );


                        dayList.appendChild(
                            card
                        );
                    }
                );
            }


            list.appendChild(
                daySection
            );
        }


        updatePlanSummary(
            plan,
            totalDays
        );


        renderTravelMap(
            plan,
            spotMap
        );

    } catch (error) {

        console.error(
            error
        );


        status.textContent =
            "APIの読み込みに失敗しました。ページを再読み込みしてください。";


        status.classList.add(
            "is-error"
        );
    }
}


// ============================================================
// 11-1. 旅行プランカード作成
// ============================================================

function createPlanCard(
    spot,
    planItem,
    dayIndex,
    dayLength,
    totalDays
) {

    const card =
        document.createElement(
            "article"
        );


    card.className =
        "plan-item-v7";


    const hierarchy =
        spot.parent_name
            ? `${spot.parent_name} ＞ ${spot.name}`
            : spot.name;


    let dayOptions =
        "";


    for (
        let day = 1;
        day <= totalDays;
        day++
    ) {

        dayOptions += `
            <option
                value="${day}"
                ${
                    Number(planItem.day) === day
                        ? "selected"
                        : ""
                }
            >
                ${day}日目
            </option>
        `;
    }


    card.innerHTML = `

        <div class="plan-card-main">

            <div class="plan-card-top">

                <span class="spot-category">
                    ${escapeHtml(spot.category)}
                </span>

                <span class="plan-card-area">
                    ${escapeHtml(spot.area)}
                </span>

            </div>


            <h3>
                ${escapeHtml(hierarchy)}
            </h3>


            <p class="plan-card-description">
                ${escapeHtml(spot.description)}
            </p>


            ${
                spot.source_url
                    ?
                    `
                    <a
                        href="${escapeHtml(spot.source_url)}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="plan-reference-link"
                    >
                        公式・参考サイトを見る ↗
                    </a>
                    `
                    :
                    ""
            }


            <div class="nearby-recommend-box">

                <button
                    type="button"
                    class="nearby-recommend-button"
                    data-nearby-recommend
                >
                    📍 この周辺のおすすめを見る
                </button>

                <div
                    class="nearby-recommend-results"
                    data-nearby-results
                    hidden
                ></div>

            </div>


            <div class="schedule-fields">

                <label class="schedule-field">

                    <span>
                        何日目？
                    </span>

                    <select
                        data-plan-day
                    >
                        ${dayOptions}
                    </select>

                </label>


                <label class="schedule-field">

                    <span>
                        何時ごろ？
                    </span>

                    <input
                        type="time"
                        value="${escapeHtml(planItem.time || "")}"
                        data-plan-time
                    >

                </label>

            </div>

        </div>


        <div class="plan-card-controls">

            <span class="order-label">
                順番
            </span>

            <div class="order-buttons">

                <button
                    type="button"
                    class="move-button"
                    data-move-up
                    ${dayIndex === 0 ? "disabled" : ""}
                    aria-label="一つ前へ"
                >
                    ↑
                </button>

                <button
                    type="button"
                    class="move-button"
                    data-move-down
                    ${dayIndex === dayLength - 1 ? "disabled" : ""}
                    aria-label="一つ後ろへ"
                >
                    ↓
                </button>

            </div>


            <button
                type="button"
                class="remove-button"
                data-remove
            >
                削除
            </button>

        </div>
    `;


    card
        .querySelector("[data-nearby-recommend]")
        .addEventListener(
            "click",
            function() {

                toggleNearbyRecommendations(
                    card,
                    spot,
                    planItem
                );
            }
        );



    card
        .querySelector("[data-plan-day]")
        .addEventListener(
            "change",
            function(event) {

                updatePlanDay(
                    String(spot.id),
                    Number(event.target.value)
                );
            }
        );


    card
        .querySelector("[data-plan-time]")
        .addEventListener(
            "change",
            function(event) {

                updatePlanTime(
                    String(spot.id),
                    event.target.value
                );
            }
        );


    card
        .querySelector("[data-move-up]")
        .addEventListener(
            "click",
            function() {

                movePlanItemWithinDay(
                    String(spot.id),
                    -1
                );
            }
        );


    card
        .querySelector("[data-move-down]")
        .addEventListener(
            "click",
            function() {

                movePlanItemWithinDay(
                    String(spot.id),
                    1
                );
            }
        );


    card
        .querySelector("[data-remove]")
        .addEventListener(
            "click",
            function() {

                removeFromTravelPlan(
                    String(spot.id)
                );
            }
        );


    return card;
}



// ============================================================
// 11-2. AIプランの各スポットから「周辺のおすすめ」を表示
// ============================================================

function getNearbyRecommendations(
    currentSpot,
    limit = 4
) {

    const allSpots =
        window.tabirouteAllSpots
        ||
        [];


    const currentPlanIds =
        new Set(
            getTravelPlan().map(
                item =>
                    String(item.id)
            )
        );


    const scored =
        allSpots
        .filter(
            spot =>
                String(spot.id)
                !==
                String(currentSpot.id)
                &&
                !currentPlanIds.has(
                    String(spot.id)
                )
        )
        .map(
            function(spot) {

                let score = 0;


                // ------------------------------------------------
                // 同じ親施設の中なら最優先
                // 例: 淡路夢舞台 → 百段苑・グリーン館など
                // ------------------------------------------------

                if (
                    currentSpot.parent_id
                    &&
                    spot.parent_id
                    &&
                    String(currentSpot.parent_id)
                    ===
                    String(spot.parent_id)
                ) {

                    score += 100;
                }


                // 現在スポットが親施設で、その子スポット
                if (
                    String(spot.parent_id || "")
                    ===
                    String(currentSpot.id)
                ) {

                    score += 95;
                }


                // 現在スポットが子スポットで、その親施設
                if (
                    String(currentSpot.parent_id || "")
                    ===
                    String(spot.id)
                ) {

                    score += 80;
                }


                // ------------------------------------------------
                // 同じエリアなら「周辺候補」として加点
                // ------------------------------------------------

                if (
                    spot.area
                    &&
                    currentSpot.area
                    &&
                    spot.area
                    ===
                    currentSpot.area
                ) {

                    score += 40;
                }


                // ------------------------------------------------
                // 同ジャンルなら好みに近い候補として少し加点
                // ------------------------------------------------

                if (
                    spot.category
                    &&
                    currentSpot.category
                    &&
                    spot.category
                    ===
                    currentSpot.category
                ) {

                    score += 12;
                }


                return {
                    spot:
                        spot,

                    score:
                        score
                };
            }
        )
        .filter(
            item =>
                item.score > 0
        )
        .sort(
            (a, b) =>
                b.score - a.score
        )
        .slice(
            0,
            limit
        )
        .map(
            item =>
                item.spot
        );


    return scored;
}


// ============================================================
// 11-3. 周辺おすすめ表示・非表示
// ============================================================

function toggleNearbyRecommendations(
    card,
    currentSpot,
    planItem
) {

    const results =
        card.querySelector(
            "[data-nearby-results]"
        );


    const button =
        card.querySelector(
            "[data-nearby-recommend]"
        );


    if (!results || !button) {

        return;
    }


    if (!results.hidden) {

        results.hidden =
            true;

        button.textContent =
            "📍 この周辺のおすすめを見る";

        return;
    }


    results.innerHTML = `
        <div class="nearby-title-row">

            <div>
                <span class="nearby-mini-label">
                    NEARBY SEARCH
                </span>

                <strong>
                    ${escapeHtml(currentSpot.name)}の近くを探す
                </strong>
            </div>

        </div>


        <div class="nearby-search-controls">

            <label class="nearby-control-field">

                <span>
                    ジャンル
                </span>

                <select data-nearby-category>

                    <option value="すべて">
                        すべて
                    </option>

                    <option value="観光">
                        📍 観光・体験
                    </option>

                    <option value="グルメ">
                        🍽️ グルメ
                    </option>

                    <option value="温泉">
                        ♨️ 温泉
                    </option>

                    <option value="ホテル">
                        🏨 ホテル
                    </option>

                </select>

            </label>


            <label class="nearby-control-field">

                <span>
                    候補の範囲
                </span>

                <select data-nearby-radius>

                    <option value="facility">
                        同じ施設・住所
                    </option>

                    <option value="area" selected>
                        同じエリア
                    </option>

                    <option value="island">
                        淡路島全体
                    </option>

                </select>

            </label>

        </div>


        <button
            type="button"
            class="local-nearby-load-button"
            data-nearby-search
        >
            🔎 この条件で近くを検索
        </button>


        <div
            class="nearby-search-status"
            data-nearby-search-status
        ></div>


        <div
            class="local-nearby-list"
            data-local-nearby-list
        ></div>
    `;


    results.hidden =
        false;


    button.textContent =
        "周辺候補を閉じる";


    const searchButton =
        results.querySelector(
            "[data-nearby-search]"
        );


    if (searchButton) {

        searchButton.addEventListener(
            "click",
            function() {

                searchNearbyByCategory(
                    results,
                    currentSpot,
                    planItem
                );
            }
        );
    }
}


// ============================================================
// 11-4. 周辺おすすめを同じ日のプランへ追加
// ============================================================

async function addNearbySpotToPlan(
    spotId,
    basePlanItem
) {

    const plan =
        getTravelPlan();


    if (
        plan.some(
            item =>
                String(item.id)
                ===
                String(spotId)
        )
    ) {

        showToast(
            "このスポットはすでにプランに入っています。"
        );

        return;
    }


    const sameDayItems =
        plan.filter(
            item =>
                Number(item.day)
                ===
                Number(basePlanItem.day)
        );


    let suggestedTime =
        "";


    if (basePlanItem.time) {

        const parts =
            basePlanItem.time.split(":");


        if (parts.length === 2) {

            const baseMinutes =
                Number(parts[0]) * 60
                +
                Number(parts[1]);


            const nextMinutes =
                Math.min(
                    baseMinutes + 120,
                    23 * 60 + 45
                );


            const hh =
                String(
                    Math.floor(
                        nextMinutes / 60
                    )
                ).padStart(
                    2,
                    "0"
                );


            const mm =
                String(
                    nextMinutes % 60
                ).padStart(
                    2,
                    "0"
                );


            suggestedTime =
                `${hh}:${mm}`;
        }
    }


    plan.push({
        id:
            String(spotId),

        day:
            Number(
                basePlanItem.day
                ||
                1
            ),

        time:
            suggestedTime
    });


    saveTravelPlan(
        plan
    );


    showToast(
        "周辺おすすめを同じ日のプランに追加しました。"
    );


    await renderTravelPlan();
}




// ============================================================
// 11-5. 周辺検索の基準地点を取得
// ============================================================

const nearbyCenterCache =
    new Map();


async function resolveNearbyCenter(
    spot
) {

    // --------------------------------------------
    // 1. すでに座標を持っていれば最優先
    // --------------------------------------------

    if (
        Number.isFinite(
            Number(
                spot.lat
            )
        )
        &&
        Number.isFinite(
            Number(
                spot.lon
            )
        )
        &&
        Number(
            spot.lat
        )
        !==
        0
        &&
        Number(
            spot.lon
        )
        !==
        0
    ) {

        return {
            lat:
                Number(
                    spot.lat
                ),

            lon:
                Number(
                    spot.lon
                )
        };
    }


    const cacheKey =
        String(
            spot.id
            ||
            spot.name
        );


    if (
        nearbyCenterCache.has(
            cacheKey
        )
    ) {

        return nearbyCenterCache.get(
            cacheKey
        );
    }


    // --------------------------------------------
    // 2. 子スポットの場合は親施設から探す
    //
    // 例:
    // 「ゴジラ迎撃作戦」単独ではなく
    // 「ニジゲンノモリ」を先に検索する。
    // --------------------------------------------

    const queries = [];


    const addQuery = function(
        value
    ) {

        const cleaned =
            String(
                value
                ||
                ""
            )
            .replace(
                /\s*[>＞]\s*/g,
                " "
            )
            .trim();


        if (
            cleaned
            &&
            !queries.includes(
                cleaned
            )
        ) {

            queries.push(
                cleaned
            );
        }
    };


    if (
        spot.parent_name
    ) {

        addQuery(
            `${spot.parent_name} 淡路島`
        );
    }


    if (
        spot.address
    ) {

        addQuery(
            spot.address
        );
    }


    if (
        spot.parent_name
        &&
        spot.name
    ) {

        addQuery(
            `${spot.parent_name} ${spot.name}`
        );
    }


    addQuery(
        spot.name
    );


    for (
        const query
        of
        queries
    ) {

        try {

            const places =
                await browserNominatimSearch(
                    query
                );


            if (
                Array.isArray(
                    places
                )
                &&
                places.length > 0
            ) {

                const center = {
                    lat:
                        Number(
                            places[
                                0
                            ].lat
                        ),

                    lon:
                        Number(
                            places[
                                0
                            ].lon
                        )
                };


                nearbyCenterCache.set(
                    cacheKey,
                    center
                );


                return center;
            }

        } catch (error) {

            console.warn(
                "位置検索失敗:",
                query,
                error
            );
        }
    }


    throw new Error(
        (
            spot.parent_name
                ?
                `「${spot.parent_name}」の位置を取得できませんでした。`
                :
                "このスポットの位置を地図から取得できませんでした。"
        )
    );
}


// ============================================================
// 11-6. 沖縄アプリ方式のジャンル別周辺検索
// ============================================================

async function searchNearbyByCategory(
    results,
    currentSpot,
    planItem
) {

    const categorySelect =
        results.querySelector(
            "[data-nearby-category]"
        );


    const scopeSelect =
        results.querySelector(
            "[data-nearby-radius]"
        );


    const searchButton =
        results.querySelector(
            "[data-nearby-search]"
        );


    const status =
        results.querySelector(
            "[data-nearby-search-status]"
        );


    const list =
        results.querySelector(
            "[data-local-nearby-list]"
        );


    if (
        !categorySelect
        ||
        !scopeSelect
        ||
        !searchButton
        ||
        !status
        ||
        !list
    ) {

        return;
    }


    const category =
        categorySelect.value;


    const scope =
        scopeSelect.value;


    searchButton.disabled =
        true;


    searchButton.textContent =
        "検索中...";


    status.textContent =
        "TabiRouteの登録スポットから探しています...";


    list.innerHTML =
        "";


    try {

        const params =
            new URLSearchParams({
                id:
                    String(
                        currentSpot.id
                        ||
                        ""
                    ),

                name:
                    String(
                        currentSpot.name
                        ||
                        ""
                    ),

                address:
                    String(
                        currentSpot.address
                        ||
                        ""
                    ),

                area:
                    String(
                        currentSpot.area
                        ||
                        ""
                    ),

                parent_name:
                    String(
                        currentSpot.parent_name
                        ||
                        ""
                    ),

                category:
                    category,

                scope:
                    scope
            });


        const {
            response,
            data
        } =
            await fetchJsonSafe(
                "/api/local/nearby?"
                +
                params.toString()
            );


        if (
            !response.ok
        ) {

            throw new Error(
                data.error
                ||
                "周辺候補を取得できませんでした。"
            );
        }


        const currentPlanIds =
            new Set(
                getTravelPlan()
                    .map(
                        item =>
                            String(
                                item.id
                            )
                    )
            );


        const places =
            (
                data.places
                ||
                []
            )
            .filter(
                place =>
                    !currentPlanIds.has(
                        String(
                            place.id
                        )
                    )
            )
            .slice(
                0,
                20
            );


        if (
            places.length === 0
        ) {

            status.textContent =
                "この条件では登録スポットが見つかりませんでした。";


            list.innerHTML = `
                <div class="nearby-empty">
                    候補の範囲を広げるか、ジャンルを「すべて」にしてください。
                </div>
            `;


            return;
        }


        status.textContent =
            `${places.length}件の候補を表示しています。外部APIは使用していません。`;


        places.forEach(
            function(place) {

                const article =
                    document.createElement(
                        "article"
                    );


                article.className =
                    "local-nearby-card";


                article.innerHTML = `
                    <div class="local-nearby-card-main">

                        <div class="nearby-card-meta">

                            <span>
                                ${escapeHtml(place.category || "")}
                            </span>

                            <span>
                                ${escapeHtml(place.nearby_relation || "淡路島内")}
                            </span>

                        </div>


                        <h4>
                            ${escapeHtml(place.name)}
                        </h4>


                        <p>
                            ${escapeHtml(place.description || place.address || "")}
                        </p>

                    </div>


                    <div class="local-nearby-card-actions">

                        <button
                            type="button"
                            class="nearby-add-button"
                            data-add-nearby-place
                        >
                            ＋ このスポットをプランに追加
                        </button>


                        ${
                            place.source_url
                                ?
                                `
                                <a
                                    href="${escapeHtml(place.source_url)}"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="local-source-link"
                                >
                                    詳細を見る
                                </a>
                                `
                                :
                                ""
                        }

                    </div>
                `;


                const addButton =
                    article.querySelector(
                        "[data-add-nearby-place]"
                    );


                addButton.addEventListener(
                    "click",
                    function() {

                        addExternalNearbySpotToPlan(
                            place,
                            planItem
                        );
                    }
                );


                list.appendChild(
                    article
                );
            }
        );


    } catch (error) {

        console.error(
            error
        );


        status.textContent =
            error.message
            ||
            "周辺候補の表示に失敗しました。";


        list.innerHTML = `
            <div class="local-nearby-error-box">
                ${escapeHtml(
                    error.message
                    ||
                    "周辺候補の表示に失敗しました。"
                )}
            </div>
        `;


    } finally {

        searchButton.disabled =
            false;


        searchButton.textContent =
            "🔎 この条件で近くを検索";
    }
}


// ============================================================
// 11-7. 周辺候補を同じ日のプランへ追加
// ============================================================

async function addExternalNearbySpotToPlan(
    spot,
    basePlanItem
) {

    const plan =
        getTravelPlan();


    if (
        plan.some(
            item =>
                String(
                    item.id
                )
                ===
                String(
                    spot.id
                )
        )
    ) {

        showToast(
            "このスポットはすでにプランに入っています。"
        );

        return;
    }


    let suggestedTime =
        "";


    if (
        basePlanItem
        &&
        basePlanItem.time
    ) {

        const parts =
            basePlanItem.time.split(
                ":"
            );


        if (
            parts.length === 2
        ) {

            const baseMinutes =
                Number(
                    parts[
                        0
                    ]
                )
                *
                60
                +
                Number(
                    parts[
                        1
                    ]
                );


            const nextMinutes =
                Math.min(
                    baseMinutes
                    +
                    120,
                    23
                    *
                    60
                    +
                    45
                );


            suggestedTime =
                String(
                    Math.floor(
                        nextMinutes
                        /
                        60
                    )
                )
                .padStart(
                    2,
                    "0"
                )
                +
                ":"
                +
                String(
                    nextMinutes
                    %
                    60
                )
                .padStart(
                    2,
                    "0"
                );
        }
    }


    plan.push({
        id:
            String(
                spot.id
            ),

        day:
            Number(
                basePlanItem?.day
                ||
                1
            ),

        time:
            suggestedTime,

        externalSpot: {
            id:
                String(
                    spot.id
                ),

            name:
                spot.name,

            area:
                "周辺検索",

            parent_name:
                "",

            category:
                spot.category
                ||
                "スポット",

            description:
                spot.description
                ||
                "",

            address:
                spot.address
                ||
                "",

            source_url:
                spot.source_url
                ||
                "",

            lat:
                Number(
                    spot.lat
                ),

            lon:
                Number(
                    spot.lon
                ),

            external:
                true,

            source:
                "OpenStreetMap"
        }
    });


    saveTravelPlan(
        plan
    );


    showToast(
        `${spot.name} を旅行プランに追加しました。`
    );


    await renderTravelPlan();
}


// ============================================================
// 12. 日数追加
// ============================================================

async function addTravelDay() {

    const current =
        Number(
            localStorage.getItem(
                "awajiTravelDays"
            )
        ) || 1;


    if (current >= 5) {

        showToast(
            "旅行日数は5日まで追加できます。"
        );

        return;
    }


    const next =
        current + 1;


    localStorage.setItem(
        "awajiTravelDays",
        String(next)
    );


    showToast(
        `${next}日目を追加しました。`
    );


    await renderTravelPlan();
}


// ============================================================
// 13. 日付変更
// ============================================================

async function updatePlanDay(
    spotId,
    newDay
) {

    const plan =
        getTravelPlan();


    const item =
        plan.find(
            item =>
                String(item.id)
                ===
                String(spotId)
        );


    if (!item) {

        return;
    }


    item.day =
        Number(newDay);


    saveTravelPlan(
        plan
    );


    await renderTravelPlan();
}


// ============================================================
// 14. 時間変更
// ============================================================

function updatePlanTime(
    spotId,
    newTime
) {

    const plan =
        getTravelPlan();


    const item =
        plan.find(
            item =>
                String(item.id)
                ===
                String(spotId)
        );


    if (!item) {

        return;
    }


    item.time =
        newTime;


    saveTravelPlan(
        plan
    );


    const totalDays =
        Number(
            localStorage.getItem(
                "awajiTravelDays"
            )
        ) || 1;


    updatePlanSummary(
        plan,
        totalDays
    );


    showToast(
        "時間を保存しました。"
    );
}


// ============================================================
// 15. 順番変更
// ============================================================

async function movePlanItemWithinDay(
    spotId,
    direction
) {

    const plan =
        getTravelPlan();


    const currentIndex =
        plan.findIndex(
            item =>
                String(item.id)
                ===
                String(spotId)
        );


    if (currentIndex < 0) {

        return;
    }


    const currentItem =
        plan[currentIndex];


    const sameDayIndexes =
        plan
            .map(
                (item, index) => ({
                    item,
                    index
                })
            )
            .filter(
                entry =>
                    Number(entry.item.day)
                    ===
                    Number(currentItem.day)
            )
            .map(
                entry =>
                    entry.index
            );


    const positionInDay =
        sameDayIndexes.indexOf(
            currentIndex
        );


    const newPosition =
        positionInDay
        +
        direction;


    if (
        newPosition < 0
        ||
        newPosition >= sameDayIndexes.length
    ) {

        return;
    }


    const swapIndex =
        sameDayIndexes[
            newPosition
        ];


    [
        plan[currentIndex],
        plan[swapIndex]
    ] = [
        plan[swapIndex],
        plan[currentIndex]
    ];


    saveTravelPlan(
        plan
    );


    await renderTravelPlan();
}


// ============================================================
// 16. エリア順に整理
// ============================================================

async function sortPlanByArea() {

    const plan =
        getTravelPlan();


    if (
        plan.length < 2
    ) {

        showToast(
            "2件以上追加すると並べ替えできます。"
        );

        return;
    }


    try {

        const spots =
            window.tabirouteAllSpots
            ||
            await fetchAllSpots();


        const spotMap =
            new Map(
                spots.map(
                    spot => [
                        String(spot.id),
                        spot
                    ]
                )
            );


        // OpenStreetMap検索から追加したスポットも同じ辞書へ入れる
        plan.forEach(function(item) {

            if (item.externalSpot) {

                spotMap.set(
                    String(item.id),
                    item.externalSpot
                );
            }
        });


        window.tabirouteSpotMap =
            spotMap;


        const areaOrder = {
            "岩屋・北部": 1,
            "東海岸": 2,
            "西海岸": 3,
            "洲本・中部": 4,
            "南あわじ": 5
        };


        plan.sort(
            function(a, b) {

                // まず日付順
                if (
                    Number(a.day)
                    !==
                    Number(b.day)
                ) {

                    return (
                        Number(a.day)
                        -
                        Number(b.day)
                    );
                }


                const spotA =
                    spotMap.get(
                        String(a.id)
                    );


                const spotB =
                    spotMap.get(
                        String(b.id)
                    );


                if (
                    !spotA
                    ||
                    !spotB
                ) {

                    return 0;
                }


                // 次にエリア順
                const areaDiff =
                    (areaOrder[spotA.area] || 99)
                    -
                    (areaOrder[spotB.area] || 99);


                if (areaDiff !== 0) {

                    return areaDiff;
                }


                // 同じ親施設の子スポットは近くへまとめる
                const parentA =
                    spotA.parent_name
                    ||
                    spotA.name;


                const parentB =
                    spotB.parent_name
                    ||
                    spotB.name;


                return parentA.localeCompare(
                    parentB,
                    "ja"
                );
            }
        );


        saveTravelPlan(
            plan
        );


        showToast(
            "同じ日ごとにエリア順へ整理しました。"
        );


        await renderTravelPlan();

    } catch (error) {

        showToast(
            "並べ替えに失敗しました。"
        );
    }
}


// ============================================================
// 17. 個別削除
// ============================================================

async function removeFromTravelPlan(
    spotId
) {

    const plan =
        getTravelPlan()
            .filter(
                item =>
                    String(item.id)
                    !==
                    String(spotId)
            );


    saveTravelPlan(
        plan
    );


    restoreTravelPlanButtons();


    await renderTravelPlan();
}


// ============================================================
// 18. 全削除
// ============================================================

async function clearTravelPlan() {

    const plan =
        getTravelPlan();


    if (
        plan.length === 0
    ) {

        return;
    }


    const confirmed =
        confirm(
            "旅行プランをすべて削除しますか？"
        );


    if (!confirmed) {

        return;
    }


    localStorage.removeItem(
        "awajiTravelPlan"
    );


    localStorage.setItem(
        "awajiTravelDays",
        "1"
    );


    restoreTravelPlanButtons();


    await renderTravelPlan();
}


// ============================================================
// 19. トースト表示
// ============================================================

function showToast(message) {

    let toast =
        document.getElementById(
            "tabiroute-toast"
        );


    if (!toast) {

        toast =
            document.createElement(
                "div"
            );


        toast.id =
            "tabiroute-toast";


        toast.className =
            "toast-message";


        document.body.appendChild(
            toast
        );
    }


    toast.textContent =
        message;


    toast.classList.add(
        "is-visible"
    );


    clearTimeout(
        window.tabirouteToastTimer
    );


    window.tabirouteToastTimer =
        setTimeout(
            function() {

                toast.classList.remove(
                    "is-visible"
                );
            },
            2300
        );
}


// ============================================================
// 20. HTMLエスケープ
// ============================================================

function escapeHtml(value) {

    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


// ============================================================
// 21. OpenStreetMap検索フォーム
// ============================================================

document.addEventListener(
    "DOMContentLoaded",
    function() {

        const form =
            document.getElementById(
                "osm-search-form"
            );

        if (!form) {
            return;
        }

        form.addEventListener(
            "submit",
            async function(event) {

                event.preventDefault();

                const input =
                    document.getElementById(
                        "osm-search-input"
                    );

                const query =
                    input.value.trim();

                if (!query) {
                    showToast(
                        "検索する場所を入力してください。"
                    );
                    return;
                }

                await searchOsmPlaces(
                    query
                );
            }
        );
    }
);


// ============================================================
// 22. OpenStreetMap検索実行
// ============================================================

async function searchOsmPlaces(query) {

    const status =
        document.getElementById(
            "osm-search-status"
        );

    const results =
        document.getElementById(
            "osm-search-results"
        );

    status.textContent =
        "OpenStreetMapから検索中...";

    results.innerHTML =
        "";

    try {

        const response =
            await fetch(
                "/api/osm/search?q="
                +
                encodeURIComponent(query)
            );

        const data =
            await response.json();

        if (!response.ok) {
            throw new Error(
                data.error
                ||
                "検索に失敗しました。"
            );
        }

        status.textContent =
            `${data.count}件見つかりました。`;

        if (data.places.length === 0) {

            results.innerHTML = `
                <div class="search-no-result">
                    淡路島周辺では候補が見つかりませんでした。
                </div>
            `;

            return;
        }

        data.places.forEach(
            function(place) {

                const card =
                    document.createElement(
                        "article"
                    );

                card.className =
                    "map-search-result";

                card.innerHTML = `
                    <div class="map-search-result-main">

                        <span class="spot-category">
                            ${escapeHtml(place.category)}
                        </span>

                        <h3>
                            ${escapeHtml(place.name)}
                        </h3>

                        <p>
                            ${escapeHtml(place.address)}
                        </p>

                    </div>

                    <button
                        type="button"
                        class="plan-button map-search-add"
                        data-plan-id="${escapeHtml(place.id)}"
                        data-plan-name="${escapeHtml(place.name)}"
                        data-external="true"
                        data-area="${escapeHtml(place.area)}"
                        data-category="${escapeHtml(place.category)}"
                        data-description="${escapeHtml(place.description)}"
                        data-address="${escapeHtml(place.address)}"
                        data-source-url="${escapeHtml(place.source_url)}"
                        data-lat="${place.lat}"
                        data-lon="${place.lon}"
                    >
                        旅行プランに追加
                    </button>
                `;

                card
                    .querySelector(
                        ".map-search-add"
                    )
                    .addEventListener(
                        "click",
                        function(event) {

                            addToPlan(
                                event.currentTarget
                            );
                        }
                    );

                results.appendChild(
                    card
                );
            }
        );

        restoreTravelPlanButtons();

    } catch (error) {

        console.error(
            error
        );

        status.textContent =
            "検索APIを利用できませんでした。";
    }
}


// ============================================================
// 23. 既存CSVスポットの位置情報を取得
// ============================================================

async function resolveMissingPlanLocations() {

    const plan =
        getTravelPlan();

    if (plan.length === 0) {

        showToast(
            "先にスポットを追加してください。"
        );

        return;
    }

    const spotMap =
        window.tabirouteSpotMap;

    if (!spotMap) {
        return;
    }

    const missing =
        plan.filter(
            function(item) {

                const spot =
                    item.externalSpot
                    ||
                    spotMap.get(
                        String(item.id)
                    );

                return (
                    spot
                    &&
                    !hasCoordinates(
                        spot,
                        item
                    )
                );
            }
        );

    if (missing.length === 0) {

        showToast(
            "すべて位置情報があります。"
        );

        return;
    }

    // 公開Nominatimへ大量アクセスしないため、
    // 1回のクリックで最大3件だけ取得する。
    const targets =
        missing.slice(0, 3);

    showToast(
        `${targets.length}件の位置を検索します。`
    );

    for (const item of targets) {

        const spot =
            item.externalSpot
            ||
            spotMap.get(
                String(item.id)
            );

        try {

            const response =
                await fetch(
                    "/api/osm/search?q="
                    +
                    encodeURIComponent(
                        spot.name
                    )
                );

            const data =
                await response.json();

            if (
                response.ok
                &&
                data.places
                &&
                data.places.length > 0
            ) {

                const best =
                    data.places[0];

                item.resolvedLocation = {
                    lat: best.lat,
                    lon: best.lon,
                    address: best.address,
                    source: "OpenStreetMap"
                };
            }

        } catch (error) {

            console.error(
                error
            );
        }
    }

    saveTravelPlan(
        plan
    );

    await renderTravelPlan();

    if (missing.length > 3) {

        showToast(
            `3件取得しました。残り${missing.length - 3}件はもう一度押してください。`
        );

    } else {

        showToast(
            "位置情報を取得しました。"
        );
    }
}



// ============================================================
// 23-A. AI生成プランを地図へ自動反映
// ============================================================
//
// /ai-plan でプランを作った直後だけ実行します。
// CSVには緯度経度を持たせていないため、登録スポット名から
// OpenStreetMap位置検索を順番に行い、取得できた場所から
// travel-mapへ反映します。
//
// 公開Nominatimへ負荷を掛けないよう、サーバー側でも
// 1秒間隔の制御・キャッシュ・回数制限を行っています。
// ============================================================

async function autoResolveAiPlanLocations() {

    const params =
        new URLSearchParams(
            window.location.search
        );

    if (
        params.get("generated")
        !==
        "ai"
    ) {
        return;
    }


    let plan =
        getTravelPlan();

    if (plan.length === 0) {
        return;
    }


    const status =
        document.getElementById(
            "api-status"
        );


    // renderTravelPlanより先にこの処理が走った場合にも備えて、
    // スポット辞書をここで準備できるようにする。
    if (!window.tabirouteSpotMap) {

        try {

            const spots =
                await fetchAllSpots();

            window.tabirouteAllSpots =
                spots;

            window.tabirouteSpotMap =
                new Map(
                    spots.map(
                        spot => [
                            String(spot.id),
                            spot
                        ]
                    )
                );

        } catch (error) {

            console.error(error);
            return;
        }
    }


    const spotMap =
        window.tabirouteSpotMap;


    const missing =
        plan.filter(
            function(item) {

                const spot =
                    item.externalSpot
                    ||
                    spotMap.get(
                        String(item.id)
                    );

                return (
                    spot
                    &&
                    !hasCoordinates(
                        spot,
                        item
                    )
                );
            }
        );


    if (missing.length === 0) {

        await renderTravelPlan();
        return;
    }


    if (status) {

        status.textContent =
            `AIプランを地図へ反映中... 0 / ${missing.length}`;
    }


    let completed =
        0;


    for (const item of missing) {

        const spot =
            item.externalSpot
            ||
            spotMap.get(
                String(item.id)
            );

        if (!spot) {
            continue;
        }


        try {

            const response =
                await fetch(
                    "/api/osm/search?q="
                    +
                    encodeURIComponent(
                        spot.name
                    )
                );


            const data =
                await response.json();


            if (
                response.ok
                &&
                Array.isArray(data.places)
                &&
                data.places.length > 0
            ) {

                const best =
                    data.places[0];


                item.resolvedLocation = {
                    lat:
                        Number(best.lat),

                    lon:
                        Number(best.lon),

                    address:
                        best.address
                        ||
                        spot.address
                        ||
                        "",

                    source:
                        "OpenStreetMap"
                };


                // 1件取得するたび保存して再描画することで、
                // ユーザーには地図へ順番に反映されていくように見せる。
                saveTravelPlan(
                    plan
                );


                await renderTravelPlan();
            }


        } catch (error) {

            console.error(
                "AIプラン位置取得エラー:",
                spot.name,
                error
            );
        }


        completed +=
            1;


        if (status) {

            status.textContent =
                `AIプランを地図へ反映中... ${completed} / ${missing.length}`;
        }
    }


    saveTravelPlan(
        plan
    );


    await renderTravelPlan();


    if (status) {

        status.textContent =
            "AIプランを地図へ反映しました。";
    }


    showToast(
        "AIプランを地図へ反映しました。"
    );
}


document.addEventListener(
    "DOMContentLoaded",
    function() {

        const params =
            new URLSearchParams(
                window.location.search
            );


        if (
            params.get("generated")
            !==
            "ai"
        ) {
            return;
        }


        // 通常のrenderTravelPlan初期処理が始まった後に実行。
        window.setTimeout(
            function() {

                autoResolveAiPlanLocations();

            },
            350
        );
    }
);


// ============================================================
// 24. 座標があるか確認
// ============================================================

function hasCoordinates(
    spot,
    planItem = null
) {

    const lat =
        planItem?.resolvedLocation?.lat
        ??
        spot?.lat;

    const lon =
        planItem?.resolvedLocation?.lon
        ??
        spot?.lon;

    return (
        Number.isFinite(
            Number(lat)
        )
        &&
        Number.isFinite(
            Number(lon)
        )
    );
}


// ============================================================
// 25. 旅行プラン地図
// ============================================================

function renderTravelMap(
    plan,
    spotMap
) {

    const mapElement =
        document.getElementById(
            "travel-map"
        );

    if (
        !mapElement
        ||
        typeof L === "undefined"
    ) {
        return;
    }

    if (window.tabirouteMap) {
        window.tabirouteMap.remove();
    }

    const map =
        L.map(
            "travel-map",
            {
                scrollWheelZoom: false
            }
        );

    window.tabirouteMap =
        map;

    L.tileLayer(
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap contributors"
        }
    ).addTo(
        map
    );

    const points =
        [];

    const orderedPlan =
        [...plan].sort(
            function(a, b) {

                const dayDiff =
                    Number(a.day)
                    -
                    Number(b.day);

                if (dayDiff !== 0) {
                    return dayDiff;
                }

                return (
                    plan.indexOf(a)
                    -
                    plan.indexOf(b)
                );
            }
        );

    orderedPlan.forEach(
        function(item, index) {

            const spot =
                item.externalSpot
                ||
                spotMap.get(
                    String(item.id)
                );

            if (!spot) {
                return;
            }

            const lat =
                item.resolvedLocation?.lat
                ??
                spot.lat;

            const lon =
                item.resolvedLocation?.lon
                ??
                spot.lon;

            if (
                !Number.isFinite(Number(lat))
                ||
                !Number.isFinite(Number(lon))
            ) {
                return;
            }

            const point = {
                lat: Number(lat),
                lon: Number(lon),
                spot: spot,
                planItem: item,
                order: index + 1
            };

            points.push(
                point
            );

            const icon =
                L.divIcon(
                    {
                        className:
                            "route-number-marker",

                        html:
                            `<span>${point.order}</span>`,

                        iconSize:
                            [34, 34],

                        iconAnchor:
                            [17, 17]
                    }
                );

            L.marker(
                [
                    point.lat,
                    point.lon
                ],
                {
                    icon:
                        icon
                }
            )
                .addTo(
                    map
                )
                .bindPopup(
                    `
                        <strong>
                            ${point.order}. ${escapeHtml(spot.name)}
                        </strong>
                        <br>
                        ${escapeHtml(spot.area || "")}
                    `
                );
        }
    );

    if (points.length === 0) {

        map.setView(
            [
                34.40,
                134.90
            ],
            10
        );

        renderDistanceSummary(
            []
        );

        return;
    }

    const latlngs =
        points.map(
            point => [
                point.lat,
                point.lon
            ]
        );

    if (points.length >= 2) {

        L.polyline(
            latlngs,
            {
                weight: 4,
                opacity: 0.65
            }
        ).addTo(
            map
        );

        map.fitBounds(
            latlngs,
            {
                padding:
                    [35, 35]
            }
        );

    } else {

        map.setView(
            latlngs[0],
            13
        );
    }

    renderDistanceSummary(
        points
    );
}


// ============================================================
// 26. 2地点の直線距離
// ============================================================

function haversineKm(
    lat1,
    lon1,
    lat2,
    lon2
) {

    const earthRadiusKm =
        6371;

    const toRad =
        degree =>
            degree
            *
            Math.PI
            /
            180;

    const dLat =
        toRad(
            lat2 - lat1
        );

    const dLon =
        toRad(
            lon2 - lon1
        );

    const a =
        Math.sin(dLat / 2) ** 2
        +
        Math.cos(toRad(lat1))
        *
        Math.cos(toRad(lat2))
        *
        Math.sin(dLon / 2) ** 2;

    const c =
        2
        *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );

    return (
        earthRadiusKm
        *
        c
    );
}


// ============================================================
// 27. 距離一覧
// ============================================================

function renderDistanceSummary(
    points
) {

    const container =
        document.getElementById(
            "distance-summary"
        );

    if (!container) {
        return;
    }

    if (points.length < 2) {

        container.innerHTML = `
            <p>
                地図上に2件以上の位置情報が入ると、
                スポット間の距離を表示します。
            </p>
        `;

        return;
    }

    let total =
        0;

    const rows =
        [];

    for (
        let index = 0;
        index < points.length - 1;
        index++
    ) {

        const from =
            points[index];

        const to =
            points[index + 1];

        const distance =
            haversineKm(
                from.lat,
                from.lon,
                to.lat,
                to.lon
            );

        total +=
            distance;

        rows.push(`
            <div class="distance-row">

                <span>
                    ${from.order}.
                    ${escapeHtml(from.spot.name)}
                </span>

                <strong>
                    ↓ 約${distance.toFixed(1)}km
                </strong>

                <span>
                    ${to.order}.
                    ${escapeHtml(to.spot.name)}
                </span>

            </div>
        `);
    }

    container.innerHTML = `
        <div class="distance-total">
            地図上の直線距離 合計
            <strong>
                約${total.toFixed(1)}km
            </strong>
        </div>

        ${rows.join("")}

        <p class="distance-note">
            ※道路を走る距離・車の所要時間ではなく、
            現在は位置関係を見るための直線距離です。
        </p>
    `;
}


// ============================================================
// 28. 道路ルート計算
// ============================================================

async function calculateRoadRoute() {

    const plan =
        getTravelPlan();

    const spotMap =
        window.tabirouteSpotMap;

    if (
        !spotMap
        ||
        plan.length < 2
    ) {

        showToast(
            "地図に2件以上のスポットが必要です。"
        );

        return;
    }


    const points =
        [];


    for (const item of plan) {

        const spot =
            item.externalSpot
            ||
            spotMap.get(
                String(item.id)
            );


        if (!spot) {
            continue;
        }


        const lat =
            item.resolvedLocation?.lat
            ??
            spot.lat;


        const lon =
            item.resolvedLocation?.lon
            ??
            spot.lon;


        if (
            Number.isFinite(Number(lat))
            &&
            Number.isFinite(Number(lon))
        ) {

            points.push({
                id:
                    String(item.id),

                name:
                    spot.name,

                lat:
                    Number(lat),

                lon:
                    Number(lon)
            });
        }
    }


    if (
        points.length < 2
    ) {

        showToast(
            "先に位置情報を取得してください。"
        );

        return;
    }


    const button =
        document.getElementById(
            "road-route-button"
        );


    if (button) {

        button.disabled =
            true;

        button.textContent =
            "計算中...";
    }


    try {

        const response =
            await fetch(
                "/api/route",
                {
                    method:
                        "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            points:
                                points
                        })
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            throw new Error(
                data.error
                ||
                "道路ルートの計算に失敗しました。"
            );
        }


        drawRoadRoute(
            data.geometry
        );


        renderRoadRouteSummary(
            points,
            data
        );


        showToast(
            "車ルートを計算しました。"
        );

    } catch (error) {

        console.error(
            error
        );


        showToast(
            "道路ルートを取得できませんでした。"
        );

    } finally {

        if (button) {

            button.disabled =
                false;

            button.textContent =
                "車ルートを計算";
        }
    }
}


// ============================================================
// 29. 道路ルートを地図に描画
// ============================================================

function drawRoadRoute(
    geometry
) {

    const map =
        window.tabirouteMap;


    if (
        !map
        ||
        !geometry
        ||
        typeof L === "undefined"
    ) {

        return;
    }


    if (
        window.tabirouteRoadLayer
    ) {

        map.removeLayer(
            window.tabirouteRoadLayer
        );
    }


    window.tabirouteRoadLayer =
        L.geoJSON(
            geometry,
            {
                weight:
                    6,

                opacity:
                    0.85
            }
        )
        .addTo(
            map
        );


    try {

        map.fitBounds(
            window.tabirouteRoadLayer.getBounds(),
            {
                padding:
                    [30, 30]
            }
        );

    } catch (error) {

        console.error(
            error
        );
    }
}


// ============================================================
// 30. 道路距離・所要時間表示
// ============================================================

function renderRoadRouteSummary(
    points,
    data
) {

    const container =
        document.getElementById(
            "distance-summary"
        );


    if (!container) {

        return;
    }


    const totalKm =
        Number(data.distance_m || 0)
        /
        1000;


    const totalMinutes =
        Math.round(
            Number(data.duration_s || 0)
            /
            60
        );


    const legRows =
        (data.legs || [])
            .map(
                function(leg, index) {

                    const from =
                        points[index];


                    const to =
                        points[index + 1];


                    if (
                        !from
                        ||
                        !to
                    ) {

                        return "";
                    }


                    const km =
                        Number(
                            leg.distance_m || 0
                        )
                        /
                        1000;


                    const minutes =
                        Math.round(
                            Number(
                                leg.duration_s || 0
                            )
                            /
                            60
                        );


                    return `
                        <div class="distance-row road-distance-row">

                            <span>
                                ${index + 1}.
                                ${escapeHtml(from.name)}
                            </span>

                            <strong>
                                ↓ 車 約${minutes}分 / ${km.toFixed(1)}km
                            </strong>

                            <span>
                                ${index + 2}.
                                ${escapeHtml(to.name)}
                            </span>

                        </div>
                    `;
                }
            )
            .join("");


    container.innerHTML = `
        <div class="distance-total road-total">

            <span>
                車ルート合計
            </span>

            <strong>
                約${totalMinutes}分 / ${totalKm.toFixed(1)}km
            </strong>

        </div>

        ${legRows}

        <p class="distance-note">
            ※道路状況・渋滞・通行止め・実際の所要時間とは異なる場合があります。
        </p>
    `;
}


// ============================================================
// 31. おまかせプラン作成
// ============================================================

async function optimizeTravelPlan() {

    let plan =
        getTravelPlan();

    const button =
        document.getElementById(
            "auto-plan-button"
        );


    if (button) {

        button.disabled =
            true;

        button.textContent =
            "プラン作成中...";
    }


    try {

        // ----------------------------------------------------
        // 0〜2件しか選んでいない場合
        // ↓
        // ユーザーに追加させず、TabiRoute側でスポットを自動選択する
        // ----------------------------------------------------

        if (plan.length < 3) {

            const savedDays =
                Number(
                    localStorage.getItem(
                        "awajiTravelDays"
                    )
                    ||
                    1
                );


            const response =
                await fetch(
                    "/api/ai-plan",
                    {
                        method:
                            "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({
                                days:
                                    Math.max(
                                        1,
                                        Math.min(
                                            savedDays,
                                            3
                                        )
                                    ),

                                pace:
                                    "normal",

                                // 条件指定なしでも
                                // バランス型で自動選択する
                                preferences:
                                    []
                            })
                    }
                );


            const responseText =
                await response.text();


            let data = {};


            try {

                data =
                    responseText
                        ?
                        JSON.parse(
                            responseText
                        )
                        :
                        {};

            } catch (parseError) {

                throw new Error(
                    `おまかせAPIからJSONではない応答が返りました。HTTP ${response.status}`
                );
            }


            if (!response.ok) {

                throw new Error(
                    data.error
                    ||
                    `自動プランを作成できませんでした。HTTP ${response.status}`
                );
            }


            if (
                !Array.isArray(
                    data.plan
                )
                ||
                data.plan.length === 0
            ) {

                throw new Error(
                    "おまかせ候補が0件でした。"
                );
            }


            // ------------------------------------------------
            // 手動選択ゼロでも、
            // 自動選択したスポットをそのまま旅行プランへ保存
            // ------------------------------------------------

            saveTravelPlan(
                data.plan
            );


            localStorage.setItem(
                "awajiTravelDays",
                String(
                    data.days
                    ||
                    1
                )
            );


            localStorage.setItem(
                "awajiAiPlanMeta",
                JSON.stringify({
                    preferences:
                        [],

                    pace:
                        "normal",

                    generatedAt:
                        new Date().toISOString(),

                    selectedSpots:
                        data.selected_spots
                        ||
                        []
                })
            );


            await renderTravelPlan();


            showToast(
                `${data.count || data.plan.length}件を自動で選んでプランを作りました。`
            );


            return;
        }


        // ----------------------------------------------------
        // 3件以上を自分で選んでいる場合は、
        // 今まで通り道路ルートを使って順番を最適化する
        // ----------------------------------------------------

        const spotMap =
            window.tabirouteSpotMap;


        if (!spotMap) {

            showToast(
                "スポット情報を読み込み中です。"
            );

            return;
        }


        const dayOneItems =
            plan.filter(
                item =>
                    Number(item.day) === 1
            );


        if (
            dayOneItems.length < 3
        ) {

            // 3件以上あっても日付が分散している場合は、
            // 1日目を無理に最適化せず自動プランを作り直す。
            const response =
                await fetch(
                    "/api/ai-plan",
                    {
                        method:
                            "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({
                                days:
                                    Number(
                                        localStorage.getItem(
                                            "awajiTravelDays"
                                        )
                                        ||
                                        1
                                    ),

                                pace:
                                    "normal",

                                preferences:
                                    []
                            })
                    }
                );


            const responseText =
                await response.text();


            let data = {};


            try {

                data =
                    responseText
                        ?
                        JSON.parse(
                            responseText
                        )
                        :
                        {};

            } catch (parseError) {

                throw new Error(
                    `おまかせAPIからJSONではない応答が返りました。HTTP ${response.status}`
                );
            }


            if (!response.ok) {

                throw new Error(
                    data.error
                    ||
                    `自動プランを作成できませんでした。HTTP ${response.status}`
                );
            }


            if (
                !Array.isArray(
                    data.plan
                )
                ||
                data.plan.length === 0
            ) {

                throw new Error(
                    "おまかせ候補が0件でした。"
                );
            }


            saveTravelPlan(
                data.plan
            );


            await renderTravelPlan();


            showToast(
                "スポットを自動選択してプランを作り直しました。"
            );


            return;
        }


        const points =
            [];


        for (const item of dayOneItems) {

            const spot =
                item.externalSpot
                ||
                spotMap.get(
                    String(item.id)
                );


            if (!spot) {
                continue;
            }


            const lat =
                item.resolvedLocation?.lat
                ??
                spot.lat;


            const lon =
                item.resolvedLocation?.lon
                ??
                spot.lon;


            if (
                Number.isFinite(Number(lat))
                &&
                Number.isFinite(Number(lon))
            ) {

                points.push({
                    id:
                        String(item.id),

                    name:
                        spot.name,

                    lat:
                        Number(lat),

                    lon:
                        Number(lon)
                });
            }
        }


        // 位置情報が足りない場合も、
        // 「3件選べ」というエラーにはせず、
        // 今あるプランをそのまま残す。
        if (
            points.length < 3
        ) {

            showToast(
                "プランは作成済みです。位置情報を取得すると車ルートも最適化できます。"
            );

            return;
        }


        const response =
            await fetch(
                "/api/route/optimize",
                {
                    method:
                        "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            points:
                                points
                        })
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            throw new Error(
                data.error
                ||
                "ルート最適化に失敗しました。"
            );
        }


        const orderedIds =
            (
                data.waypoints
                ||
                data.order
                ||
                []
            )
            .map(
                waypoint =>
                    String(
                        waypoint.id
                        ??
                        waypoint
                    )
            );


        if (orderedIds.length >= 3) {

            const firstDayMap =
                new Map(
                    dayOneItems.map(
                        item => [
                            String(item.id),
                            item
                        ]
                    )
                );


            const reordered =
                orderedIds
                .map(
                    id =>
                        firstDayMap.get(id)
                )
                .filter(Boolean);


            if (
                reordered.length ===
                dayOneItems.length
            ) {

                const otherDays =
                    plan.filter(
                        item =>
                            Number(item.day) !== 1
                    );


                reordered.forEach(
                    function(item, index) {

                        item.day =
                            1;

                        if (!item.time) {

                            const times = [
                                "09:30",
                                "12:00",
                                "14:30",
                                "17:00",
                                "19:00"
                            ];

                            item.time =
                                times[index]
                                ||
                                "";
                        }
                    }
                );


                plan = [
                    ...reordered,
                    ...otherDays
                ];


                saveTravelPlan(
                    plan
                );


                await renderTravelPlan();


                showToast(
                    "回りやすい順に並べ替えました。"
                );
            }
        }


    } catch (error) {

        console.error(
            error
        );


        showToast(
            error?.message
            ||
            "おまかせプランを作成できませんでした。"
        );


    } finally {

        if (button) {

            button.disabled =
                false;

            button.textContent =
                "おまかせプラン作成";
        }
    }
}

// ============================================================
// 32. AI旅行プランナー
// ============================================================

document.addEventListener(
    "DOMContentLoaded",
    function() {

        const form =
            document.getElementById(
                "ai-planner-form"
            );


        if (!form) {

            return;
        }


        form.addEventListener(
            "submit",
            async function(event) {

                event.preventDefault();


                const button =
                    document.getElementById(
                        "ai-create-button"
                    );


                const loading =
                    document.getElementById(
                        "ai-planner-loading"
                    );


                const days =
                    Number(
                        form.querySelector(
                            'input[name="days"]:checked'
                        )?.value
                        ||
                        1
                    );


                const pace =
                    form.querySelector(
                        'input[name="pace"]:checked'
                    )?.value
                    ||
                    "normal";


                const preferences =
                    [
                        ...form.querySelectorAll(
                            'input[name="preferences"]:checked'
                        )
                    ]
                    .map(
                        input =>
                            input.value
                    );


                button.disabled =
                    true;


                button.textContent =
                    "プランを作成中...";


                loading.hidden =
                    false;


                loading.scrollIntoView(
                    {
                        behavior:
                            "smooth",

                        block:
                            "center"
                    }
                );


                try {

                    const response =
                        await fetch(
                            "/api/ai-plan",
                            {
                                method:
                                    "POST",

                                headers: {
                                    "Content-Type":
                                        "application/json"
                                },

                                body:
                                    JSON.stringify({
                                        days:
                                            days,

                                        pace:
                                            pace,

                                        preferences:
                                            preferences
                                    })
                            }
                        );


                    const data =
                        await response.json();


                    if (!response.ok) {

                        throw new Error(
                            data.error
                            ||
                            "旅行プランを作れませんでした。"
                        );
                    }


                    // ------------------------------------------------
                    // ここが重要:
                    // ユーザーが手動追加していなくても、
                    // AI選定結果をそのまま旅行プランとして保存する。
                    // ------------------------------------------------

                    localStorage.setItem(
                        "awajiTravelPlan",
                        JSON.stringify(
                            data.plan
                        )
                    );


                    localStorage.setItem(
                        "awajiTravelDays",
                        String(
                            data.days
                        )
                    );


                    localStorage.setItem(
                        "awajiAiPlanMeta",
                        JSON.stringify({
                            preferences:
                                preferences,

                            pace:
                                pace,

                            generatedAt:
                                new Date().toISOString(),

                            selectedSpots:
                                data.selected_spots
                        })
                    );


                    window.location.href =
                        "/plan?generated=ai";


                } catch (error) {

                    console.error(
                        error
                    );


                    loading.hidden =
                        true;


                    button.disabled =
                        false;


                    button.textContent =
                        "✨ AIに旅行プランを作ってもらう";


                    showToast(
                        "AI旅行プランを作れませんでした。"
                    );
                }
            }
        );
    }
);


// ============================================================
// 33. AI生成プランの案内表示
// ============================================================

document.addEventListener(
    "DOMContentLoaded",
    function() {

        const params =
            new URLSearchParams(
                window.location.search
            );


        if (
            params.get(
                "generated"
            )
            !==
            "ai"
        ) {

            return;
        }


        const metaRaw =
            localStorage.getItem(
                "awajiAiPlanMeta"
            );


        if (!metaRaw) {

            return;
        }


        try {

            const meta =
                JSON.parse(
                    metaRaw
                );


            const page =
                document.querySelector(
                    ".plan-page"
                );


            if (!page) {

                return;
            }


            const banner =
                document.createElement(
                    "section"
                );


            banner.className =
                "ai-generated-banner";


            banner.innerHTML = `
                <div>
                    <p class="section-label">
                        AI GENERATED
                    </p>

                    <h2>
                        AIが行き先から選びました
                    </h2>

                    <p>
                        このプランは、選んだ好み・日数・ペースから
                        TabiRouteが候補スポットを自動選択したものです。
                        気に入らない場所は削除したり、時間を変更できます。
                    </p>
                </div>

                <a
                    href="/ai-plan"
                    class="tool-link"
                >
                    条件を変えて作り直す
                </a>
            `;


            page.prepend(
                banner
            );


        } catch (error) {

            console.error(
                error
            );
        }
    }
);


// ============================================================
// 34. お気に入り
// ============================================================

function getFavorites() {

    const raw =
        localStorage.getItem(
            "awajiFavorites"
        );


    if (!raw) {

        return [];
    }


    try {

        const parsed =
            JSON.parse(
                raw
            );


        return Array.isArray(parsed)
            ?
            parsed
            :
            [];

    } catch (error) {

        return [];
    }
}


function saveFavorites(
    favorites
) {

    localStorage.setItem(
        "awajiFavorites",
        JSON.stringify(
            favorites
        )
    );


    refreshFavoriteButtons();
}


function toggleFavorite(
    button
) {

    const id =
        String(
            button.dataset.favoriteId
        );


    const name =
        button.dataset.favoriteName
        ||
        "";


    let favorites =
        getFavorites();


    const exists =
        favorites.some(
            item =>
                String(item.id)
                ===
                id
        );


    if (exists) {

        favorites =
            favorites.filter(
                item =>
                    String(item.id)
                    !==
                    id
            );


        showToast(
            "お気に入りから外しました。"
        );

    } else {

        favorites.push({
            id:
                id,

            name:
                name
        });


        showToast(
            "お気に入りに追加しました。"
        );
    }


    saveFavorites(
        favorites
    );
}


function refreshFavoriteButtons() {

    const favoriteIds =
        new Set(
            getFavorites().map(
                item =>
                    String(item.id)
            )
        );


    document
        .querySelectorAll(
            "[data-favorite-id]"
        )
        .forEach(
            function(button) {

                const active =
                    favoriteIds.has(
                        String(
                            button.dataset.favoriteId
                        )
                    );


                button.classList.toggle(
                    "active",
                    active
                );


                button.textContent =
                    active
                        ?
                        "♥ お気に入り済み"
                        :
                        "♡ お気に入り";
            }
        );
}


document.addEventListener(
    "DOMContentLoaded",
    refreshFavoriteButtons
);


// ============================================================
// 35. 共有URL用 Base64URL
// ============================================================

function encodeShareData(
    data
) {

    const json =
        JSON.stringify(
            data
        );


    const bytes =
        new TextEncoder()
        .encode(
            json
        );


    let binary =
        "";


    bytes.forEach(
        byte => {

            binary +=
                String.fromCharCode(
                    byte
                );
        }
    );


    return btoa(
        binary
    )
        .replaceAll(
            "+",
            "-"
        )
        .replaceAll(
            "/",
            "_"
        )
        .replace(
            /=+$/g,
            ""
        );
}


function decodeShareData(
    encoded
) {

    let base64 =
        encoded
        .replaceAll(
            "-",
            "+"
        )
        .replaceAll(
            "_",
            "/"
        );


    while (
        base64.length % 4
        !==
        0
    ) {

        base64 += "=";
    }


    const binary =
        atob(
            base64
        );


    const bytes =
        Uint8Array.from(
            binary,
            character =>
                character.charCodeAt(0)
        );


    const json =
        new TextDecoder()
        .decode(
            bytes
        );


    return JSON.parse(
        json
    );
}


// ============================================================
// 36. 現在のプランから共有URLを作る
// ============================================================

function buildCurrentSharePayload() {

    const payload = {

        version:
            1,

        plan:
            getTravelPlan(),

        days:
            Number(
                localStorage.getItem(
                    "awajiTravelDays"
                )
                ||
                1
            ),

        favorites:
            getFavorites(),

        createdAt:
            new Date()
            .toISOString()
    };


    const aiMetaRaw =
        localStorage.getItem(
            "awajiAiPlanMeta"
        );


    if (aiMetaRaw) {

        try {

            payload.aiMeta =
                JSON.parse(
                    aiMetaRaw
                );

        } catch (error) {

            // AIメタ情報が壊れていても
            // 旅行プラン本体は共有できる。
        }
    }


    return payload;
}


function createShareUrl() {

    const payload =
        buildCurrentSharePayload();


    const encoded =
        encodeShareData(
            payload
        );


    return (
        window.location.origin
        +
        "/share#"
        +
        encoded
    );
}


// ============================================================
// 37. 共有ボタン
// ============================================================

async function shareCurrentPlan() {

    const plan =
        getTravelPlan();


    if (
        plan.length === 0
        &&
        getFavorites().length === 0
    ) {

        showToast(
            "共有する旅行プランまたはお気に入りがありません。"
        );

        return;
    }


    const shareUrl =
        createShareUrl();


    // --------------------------------------------------------
    // iPhone / Android等で共有シートが使える場合
    // --------------------------------------------------------

    if (
        navigator.share
    ) {

        try {

            await navigator.share({
                title:
                    "TabiRoute 旅行プラン",

                text:
                    "旅行プランを共有します。",

                url:
                    shareUrl
            });


            return;

        } catch (error) {

            if (
                error.name
                ===
                "AbortError"
            ) {

                return;
            }
        }
    }


    // --------------------------------------------------------
    // PC等ではクリップボードへコピー
    // --------------------------------------------------------

    try {

        await navigator.clipboard.writeText(
            shareUrl
        );


        showToast(
            "共有URLをコピーしました。"
        );


    } catch (error) {

        window.prompt(
            "この共有URLをコピーしてください。",
            shareUrl
        );
    }
}


// ============================================================
// 38. /share で共有内容を確認する
// ============================================================

let pendingSharedData =
    null;


function initializeSharePage() {

    const preview =
        document.getElementById(
            "share-preview"
        );


    const importButton =
        document.getElementById(
            "import-shared-plan-button"
        );


    if (
        !preview
        ||
        !importButton
    ) {

        return;
    }


    const encoded =
        window.location.hash
        .slice(
            1
        );


    if (!encoded) {

        preview.innerHTML = `
            <div class="share-error">
                <strong>共有データが見つかりません。</strong>
                <p>
                    URLが途中で切れていないか確認してください。
                </p>
            </div>
        `;

        return;
    }


    try {

        const data =
            decodeShareData(
                encoded
            );


        if (
            !data
            ||
            !Array.isArray(
                data.plan
            )
        ) {

            throw new Error(
                "invalid share data"
            );
        }


        pendingSharedData =
            data;


        const planCount =
            data.plan.length;


        const favoriteCount =
            Array.isArray(
                data.favorites
            )
                ?
                data.favorites.length
                :
                0;


        const dayCount =
            Number(
                data.days
                ||
                1
            );


        preview.innerHTML = `
            <div class="share-preview-counts">

                <div>
                    <strong>
                        ${planCount}
                    </strong>
                    <span>
                        予定スポット
                    </span>
                </div>

                <div>
                    <strong>
                        ${dayCount}
                    </strong>
                    <span>
                        日間
                    </span>
                </div>

                <div>
                    <strong>
                        ${favoriteCount}
                    </strong>
                    <span>
                        お気に入り
                    </span>
                </div>

            </div>

            <p>
                この共有URLの情報は、
                このページを開いたブラウザ内で読み取っています。
            </p>
        `;


        importButton.disabled =
            false;


        importButton.addEventListener(
            "click",
            importSharedPlan
        );


    } catch (error) {

        console.error(
            error
        );


        preview.innerHTML = `
            <div class="share-error">
                <strong>
                    この共有URLを読み込めませんでした。
                </strong>

                <p>
                    URLが破損しているか、
                    対応していない形式の可能性があります。
                </p>
            </div>
        `;
    }
}


// ============================================================
// 39. 共有プランをこの端末へ保存
// ============================================================

function importSharedPlan() {

    if (!pendingSharedData) {

        return;
    }


    saveTravelPlan(
        pendingSharedData.plan
        ||
        []
    );


    localStorage.setItem(
        "awajiTravelDays",
        String(
            Number(
                pendingSharedData.days
                ||
                1
            )
        )
    );


    if (
        Array.isArray(
            pendingSharedData.favorites
        )
    ) {

        saveFavorites(
            pendingSharedData.favorites
        );
    }


    if (
        pendingSharedData.aiMeta
    ) {

        localStorage.setItem(
            "awajiAiPlanMeta",
            JSON.stringify(
                pendingSharedData.aiMeta
            )
        );
    }


    window.location.href =
        "/plan?imported=share";
}


document.addEventListener(
    "DOMContentLoaded",
    initializeSharePage
);


// ============================================================
// 40. 共有URLから取り込んだ直後の案内
// ============================================================

document.addEventListener(
    "DOMContentLoaded",
    function() {

        const params =
            new URLSearchParams(
                window.location.search
            );


        if (
            params.get(
                "imported"
            )
            ===
            "share"
        ) {

            setTimeout(
                function() {

                    showToast(
                        "共有プランをこの端末に取り込みました。"
                    );
                },
                300
            );
        }
    }
);


// ============================================================

document.addEventListener(
    "click",
    function(event) {

        const button =
            event.target.closest(
                "[data-scroll-auto-plan]"
            );


        if (!button) {
            return;
        }


        const target =
            document.querySelector(
                "[data-ai-plan], .ai-plan-panel, .auto-plan-panel, [data-auto-plan]"
            );


        if (target) {

            target.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });

        } else {

            const fallback =
                document.querySelector(
                    "[data-auto-plan-button]"
                );


            if (fallback) {
                fallback.scrollIntoView({
                    behavior: "smooth",
                    block: "center"
                });
            }
        }
    }
);


// ============================================================
// 39. v27 プラン保存・読込・PDFしおり
// ============================================================

function togglePlanPortabilityPanel() {

    const panel =
        document.getElementById(
            "plan-portability-panel"
        );

    const button =
        document.getElementById(
            "plan-portability-toggle"
        );


    if (!panel) {
        return;
    }


    const willOpen =
        panel.hidden;


    panel.hidden =
        !willOpen;


    if (button) {

        button.setAttribute(
            "aria-expanded",
            willOpen
                ?
                "true"
                :
                "false"
        );
    }
}


function buildPortablePlanPayload() {

    const payload = {
        format:
            "tabiroute-plan",

        version:
            1,

        exportedAt:
            new Date()
            .toISOString(),

        plan:
            getTravelPlan(),

        days:
            Number(
                localStorage.getItem(
                    "awajiTravelDays"
                )
                ||
                1
            ),

        favorites:
            getFavorites()
    };


    const aiMetaRaw =
        localStorage.getItem(
            "awajiAiPlanMeta"
        );


    if (aiMetaRaw) {

        try {

            payload.aiMeta =
                JSON.parse(
                    aiMetaRaw
                );

        } catch (error) {

            // AIメタ情報が壊れていても
            // プラン本体の書き出しは続行する。
        }
    }


    return payload;
}


function downloadPlanJson() {

    const payload =
        buildPortablePlanPayload();


    if (
        payload.plan.length === 0
        &&
        payload.favorites.length === 0
    ) {

        showToast(
            "保存する旅行プランまたはお気に入りがありません。"
        );

        return;
    }


    const json =
        JSON.stringify(
            payload,
            null,
            2
        );


    const blob =
        new Blob(
            [json],
            {
                type:
                    "application/json;charset=utf-8"
            }
        );


    const url =
        URL.createObjectURL(
            blob
        );


    const today =
        new Date()
        .toISOString()
        .slice(
            0,
            10
        );


    const anchor =
        document.createElement(
            "a"
        );


    anchor.href =
        url;

    anchor.download =
        `tabiroute_plan_${today}.json`;


    document.body.appendChild(
        anchor
    );


    anchor.click();
    anchor.remove();


    URL.revokeObjectURL(
        url
    );


    showToast(
        "プランデータ（JSON）を保存しました。"
    );
}


function openPlanJsonPicker() {

    const input =
        document.getElementById(
            "plan-json-file-input"
        );


    if (!input) {
        return;
    }


    input.value =
        "";


    input.click();
}


async function importPlanJsonFile(
    event
) {

    const input =
        event.target;


    const file =
        input.files
        &&
        input.files[0];


    if (!file) {
        return;
    }


    try {

        const text =
            await file.text();


        const data =
            JSON.parse(
                text
            );


        if (
            !data
            ||
            data.format !== "tabiroute-plan"
            ||
            !Array.isArray(
                data.plan
            )
        ) {

            throw new Error(
                "TabiRouteのプランデータではありません。"
            );
        }


        const currentPlan =
            getTravelPlan();


        if (
            currentPlan.length > 0
            &&
            !window.confirm(
                "現在の旅行プランを、読み込んだデータで置き換えます。よろしいですか？"
            )
        ) {

            return;
        }


        localStorage.setItem(
            "awajiTravelPlan",
            JSON.stringify(
                data.plan
            )
        );


        const days =
            Math.max(
                1,
                Number(
                    data.days
                    ||
                    1
                )
            );


        localStorage.setItem(
            "awajiTravelDays",
            String(
                days
            )
        );


        if (
            Array.isArray(
                data.favorites
            )
        ) {

            localStorage.setItem(
                "awajiFavorites",
                JSON.stringify(
                    data.favorites
                )
            );
        }


        if (data.aiMeta) {

            localStorage.setItem(
                "awajiAiPlanMeta",
                JSON.stringify(
                    data.aiMeta
                )
            );

        } else {

            localStorage.removeItem(
                "awajiAiPlanMeta"
            );
        }


        updatePlanBadge();
        refreshFavoriteButtons();


        showToast(
            "プランデータを読み込みました。"
        );


        if (
            document.getElementById(
                "travel-plan-list"
            )
        ) {

            await renderTravelPlan();
        }

    } catch (error) {

        console.error(
            error
        );


        showToast(
            error.message
            ||
            "JSONファイルを読み込めませんでした。"
        );

    } finally {

        input.value =
            "";
    }
}


function getPortableSpotForPlanItem(
    item
) {

    if (
        item.externalSpot
    ) {

        return item.externalSpot;
    }


    if (
        window.tabirouteSpotMap
        &&
        window.tabirouteSpotMap.has(
            String(
                item.id
            )
        )
    ) {

        return window.tabirouteSpotMap.get(
            String(
                item.id
            )
        );
    }


    const allSpots =
        window.tabirouteAllSpots
        ||
        [];


    return (
        allSpots.find(
            spot =>
                String(
                    spot.id
                )
                ===
                String(
                    item.id
                )
        )
        ||
        {
            id:
                item.id,

            name:
                item.name
                ||
                "スポット",

            area:
                "",

            category:
                "",

            address:
                ""
        }
    );
}


function buildPrintablePlanHtml() {

    const plan =
        getTravelPlan();


    if (
        plan.length === 0
    ) {

        return "";
    }


    const days =
        Math.max(
            1,
            Number(
                localStorage.getItem(
                    "awajiTravelDays"
                )
                ||
                1
            ),
            ...plan.map(
                item =>
                    Number(
                        item.day
                    )
                    ||
                    1
            )
        );


    let body =
        "";


    for (
        let day = 1;
        day <= days;
        day += 1
    ) {

        const items =
            plan
            .filter(
                item =>
                    Number(
                        item.day
                    )
                    ===
                    day
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    String(
                        a.time
                        ||
                        "99:99"
                    )
                    .localeCompare(
                        String(
                            b.time
                            ||
                            "99:99"
                        )
                    )
            );


        if (
            items.length === 0
        ) {
            continue;
        }


        body += `
            <section class="day-section">
                <h2>DAY ${day}</h2>
                <div class="day-line"></div>
        `;


        items.forEach(
            item => {

                const spot =
                    getPortableSpotForPlanItem(
                        item
                    );


                body += `
                    <article class="print-plan-item">
                        <div class="print-time">
                            ${escapeHtml(item.time || "--:--")}
                        </div>

                        <div class="print-spot">
                            <h3>${escapeHtml(spot.name || "スポット")}</h3>
                            <p class="print-meta">
                                ${escapeHtml(
                                    [
                                        spot.area,
                                        spot.category
                                    ]
                                    .filter(Boolean)
                                    .join(" / ")
                                )}
                            </p>
                            ${
                                spot.address
                                    ?
                                    `<p class="print-address">${escapeHtml(spot.address)}</p>`
                                    :
                                    ""
                            }
                        </div>
                    </article>
                `;
            }
        );


        body +=
            "</section>";
    }


    const created =
        new Date()
        .toLocaleString(
            "ja-JP"
        );


    return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TabiRoute 旅のしおり</title>
<style>
@page { size: A4; margin: 16mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #17323c; font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif; background: #fff; }
header { padding-bottom: 18px; border-bottom: 2px solid #17323c; margin-bottom: 24px; }
.logo { font-size: 12px; font-weight: 900; letter-spacing: .16em; color: #7b8d92; }
h1 { margin: 4px 0 6px; font-size: 28px; }
.sub { margin: 0; font-size: 11px; color: #718087; }
.day-section { break-inside: avoid; margin: 0 0 26px; }
h2 { margin: 0; font-size: 18px; }
.day-line { width: 34px; height: 3px; margin: 7px 0 14px; background: #17323c; }
.print-plan-item { display: grid; grid-template-columns: 72px 1fr; gap: 14px; padding: 12px 0; border-bottom: 1px solid #e6ecee; break-inside: avoid; }
.print-time { font-size: 15px; font-weight: 900; }
.print-spot h3 { margin: 0 0 3px; font-size: 15px; }
.print-meta, .print-address { margin: 2px 0; font-size: 10px; color: #718087; }
footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #dfe7e9; font-size: 9px; color: #859399; }
.print-actions { margin: 0 0 18px; padding: 12px; border: 1px solid #e0e7e9; border-radius: 10px; background: #f7fafb; font-size: 11px; }
@media print { .print-actions { display: none; } }
</style>
</head>
<body>
<header>
    <div class="logo">TABIROUTE</div>
    <h1>淡路島 旅のしおり</h1>
    <p class="sub">作成: ${escapeHtml(created)} / ${days}日間</p>
</header>
<div class="print-actions">印刷画面で「PDFに保存」を選ぶとPDFファイルとして保存できます。</div>
${body}
<footer>このしおりはTabiRouteのブラウザ内データから作成されています。営業時間・料金などの最新情報は各施設の公式情報をご確認ください。</footer>
<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},250);});<\/script>
</body>
</html>`;
}


async function printPlanAsPdf() {

    const plan =
        getTravelPlan();


    if (
        plan.length === 0
    ) {

        showToast(
            "PDFにする旅行プランがありません。"
        );

        return;
    }


    // ポップアップブロックを避けるため、先に印刷用タブを開く。
    const printWindow =
        window.open(
            "",
            "_blank"
        );


    if (!printWindow) {

        showToast(
            "ポップアップを許可して、もう一度PDFを作成してください。"
        );

        return;
    }


    printWindow.document.write(
        "<p style='font-family:sans-serif;padding:20px'>旅のしおりを作成しています...</p>"
    );


    try {

        // JSONを読み込んだ直後など、スポット辞書がまだ無い場合も補完する。
        if (
            !window.tabirouteAllSpots
            ||
            window.tabirouteAllSpots.length === 0
        ) {

            const spots =
                await fetchAllSpots();


            window.tabirouteAllSpots =
                spots;


            window.tabirouteSpotMap =
                new Map(
                    spots.map(
                        spot => [
                            String(
                                spot.id
                            ),
                            spot
                        ]
                    )
                );


            plan.forEach(
                item => {

                    if (
                        item.externalSpot
                    ) {

                        window.tabirouteSpotMap.set(
                            String(
                                item.id
                            ),
                            item.externalSpot
                        );
                    }
                }
            );
        }


        const html =
            buildPrintablePlanHtml();


        printWindow.document.open();
        printWindow.document.write(
            html
        );
        printWindow.document.close();

    } catch (error) {

        console.error(
            error
        );


        printWindow.close();


        showToast(
            "旅のしおりを作成できませんでした。"
        );
    }
}
