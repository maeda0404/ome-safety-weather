#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
青梅・小作駅近くの浄水場現場向け
安全・気象サイネージ用データ生成スクリプト

取得・判定内容
--------------------------------------------------
Open-Meteo:
- 現在気温
- 現在降水量
- 天気コード
- 現在風速
- 降水確率
- 最低気温
- 日没時刻

気象庁:
- 大雨警報
- 暴風警報
- 強風注意報
- 雷注意報
- 乾燥注意報
- 雷予報

現場独自判定:
- 時間降水量による大雨判定
- 風速による強風・暴風判定
- 降水確率判定
- 最低気温による低温・凍結判定
- 日没30分前から日没10分後までの日没注意

対象外:
- 土砂災害
- 波浪
- 高潮
"""

import gzip
import json
import re
import tempfile
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


# =========================================================
# ファイル・地点設定
# =========================================================

ROOT = Path(__file__).resolve().parent

CONFIG_FILE = ROOT / "config.json"
OUTPUT_FILE = ROOT / "data" / "current.json"

LOCATION_NAME = "青梅・浄水場現場"

# 青梅市の気象庁警報・注意報区域
TARGET_AREA_CODES = {
    "1320500",
}

TARGET_AREA_NAMES = {
    "青梅市",
}

# 気象庁府県天気予報
JMA_FORECAST_AREA_CODE = "130012"

# VPWS50フィード側の区域コード
VPWS50_FEED_AREA_CODE = "010000"

REQUEST_TIMEOUT_SECONDS = 30
USER_AGENT = "ome-waterworks-safety-signage/5.0"

JST = ZoneInfo("Asia/Tokyo")


# =========================================================
# URL
# =========================================================

OPEN_METEO_BASE_URL = (
    "https://api.open-meteo.com/v1/forecast"
)

JMA_REGULAR_FEED_URL = (
    "https://www.data.jma.go.jp/"
    "developer/xml/feed/regular.xml"
)

JMA_FORECAST_URL = (
    "https://www.jma.go.jp/"
    "bosai/forecast/data/forecast/130000.json"
)


# =========================================================
# 気象庁URL抽出
# =========================================================

JMA_DATA_URL_PATTERN = re.compile(
    r"https://www\.data\.jma\.go\.jp/"
    r"developer/xml/data/"
    r"(\d{14})_\d+_([A-Z0-9]+)_(\d{6})\.xml"
)


# =========================================================
# 設定読込
# =========================================================

def load_config():
    with CONFIG_FILE.open(
        "r",
        encoding="utf-8",
    ) as file:
        config = json.load(file)

    required_keys = (
        "latitude",
        "longitude",
        "timezone",
        "thresholds",
    )

    for key in required_keys:
        if key not in config:
            raise ValueError(
                f"config.jsonに{key}がありません"
            )

    required_thresholds = (
        "heavy_rain_per_hour",
        "storm_wind",
        "strong_wind",
        "rain_probability",
        "low_temperature",
    )

    for key in required_thresholds:
        if key not in config["thresholds"]:
            raise ValueError(
                f"config.jsonのthresholdsに{key}がありません"
            )

    return config


# =========================================================
# HTTP通信
# =========================================================

def request_bytes(url):
    separator = "&" if "?" in url else "?"

    cache_buster = int(
        datetime.now(timezone.utc).timestamp()
    )

    request_url = (
        f"{url}{separator}_={cache_buster}"
    )

    request = urllib.request.Request(
        request_url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": (
                "application/json,"
                "application/xml,"
                "text/xml,"
                "*/*"
            ),
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        },
    )

    with urllib.request.urlopen(
        request,
        timeout=REQUEST_TIMEOUT_SECONDS,
    ) as response:
        raw_data = response.read()

    if raw_data[:2] == b"\x1f\x8b":
        return gzip.decompress(raw_data)

    return raw_data


def get_json(url):
    raw_data = request_bytes(url)

    return json.loads(
        raw_data.decode("utf-8")
    )


# =========================================================
# Open-Meteo
# =========================================================

def build_open_meteo_url(config):
    params = {
        "latitude": config["latitude"],
        "longitude": config["longitude"],
        "timezone": config["timezone"],
        "current": (
            "temperature_2m,"
            "precipitation,"
            "weather_code,"
            "wind_speed_10m"
        ),
        "hourly": (
            "precipitation_probability"
        ),
        "daily": (
            "temperature_2m_min,"
            "sunset"
        ),
        "forecast_days": 2,
        "wind_speed_unit": "ms",
    }

    return (
        OPEN_METEO_BASE_URL
        + "?"
        + urllib.parse.urlencode(params)
    )


def find_hourly_index(
    hourly_times,
    observed_time,
):
    if not hourly_times:
        raise ValueError(
            "Open-Meteoのhourly.timeがありません"
        )

    hour_key = observed_time[:13] + ":00"

    if hour_key in hourly_times:
        return hourly_times.index(hour_key)

    observed_datetime = datetime.fromisoformat(
        observed_time
    )

    return min(
        range(len(hourly_times)),
        key=lambda index: abs(
            datetime.fromisoformat(
                hourly_times[index]
            )
            - observed_datetime
        ),
    )


def parse_open_meteo(data):
    current = data.get("current")
    hourly = data.get("hourly")
    daily = data.get("daily")

    if not current:
        raise ValueError(
            "Open-Meteoのcurrentがありません"
        )

    if not hourly:
        raise ValueError(
            "Open-Meteoのhourlyがありません"
        )

    if not daily:
        raise ValueError(
            "Open-Meteoのdailyがありません"
        )

    required_current_keys = (
        "time",
        "temperature_2m",
        "precipitation",
        "weather_code",
        "wind_speed_10m",
    )

    for key in required_current_keys:
        if current.get(key) is None:
            raise ValueError(
                f"Open-Meteoの{key}がありません"
            )

    hourly_times = hourly.get(
        "time",
        [],
    )

    rain_probability_values = hourly.get(
        "precipitation_probability",
        [],
    )

    minimum_temperatures = daily.get(
        "temperature_2m_min",
        [],
    )

    sunset_values = daily.get(
        "sunset",
        [],
    )

    if not minimum_temperatures:
        raise ValueError(
            "最低気温を取得できません"
        )

    if not sunset_values:
        raise ValueError(
            "日没時刻を取得できません"
        )

    hourly_index = find_hourly_index(
        hourly_times,
        current["time"],
    )

    rain_probability = 0

    if (
        hourly_index
        < len(rain_probability_values)
    ):
        rain_probability = (
            rain_probability_values[
                hourly_index
            ]
        )

    if rain_probability is None:
        rain_probability = 0

    return {
        "observed_at": current["time"],
        "temperature": current[
            "temperature_2m"
        ],
        "precipitation": current[
            "precipitation"
        ],
        "code": current[
            "weather_code"
        ],
        "wind_speed": current[
            "wind_speed_10m"
        ],
        "rain_probability": rain_probability,
        "min_temperature": minimum_temperatures[0],
        "sunset": sunset_values[0],
    }


# =========================================================
# XML処理
# =========================================================

def local_name(element):
    return element.tag.rsplit(
        "}",
        1,
    )[-1]


def child_text(
    element,
    child_name,
):
    for child in element:
        if local_name(child) == child_name:
            return (
                child.text or ""
            ).strip()

    return ""


def find_latest_report_url(
    feed_raw,
    report_type,
    feed_area_code,
):
    feed_text = feed_raw.decode(
        "utf-8",
        "replace",
    )

    candidates = []

    for (
        timestamp,
        item_type,
        item_area,
    ) in JMA_DATA_URL_PATTERN.findall(
        feed_text
    ):
        if item_type != report_type:
            continue

        if item_area != feed_area_code:
            continue

        report_url = (
            "https://www.data.jma.go.jp/"
            "developer/xml/data/"
            f"{timestamp}_0_"
            f"{item_type}_"
            f"{item_area}.xml"
        )

        candidates.append(
            (
                timestamp,
                report_url,
            )
        )

    if not candidates:
        return None

    return max(
        candidates,
        key=lambda item: item[0],
    )


def area_matches(item):
    for element in item.iter():
        if local_name(element) != "Area":
            continue

        area_code = child_text(
            element,
            "Code",
        )

        area_name = child_text(
            element,
            "Name",
        )

        if area_code in TARGET_AREA_CODES:
            return True

        if area_name in TARGET_AREA_NAMES:
            return True

    return False


# =========================================================
# 気象庁警報・注意報解析
# =========================================================

def warning_name_to_key(name):
    normalized = (
        name.replace("　", "")
        .replace(" ", "")
    )

    # 青梅版では土砂災害を対象外とする
    if "土砂災害" in normalized:
        return None

    # 波浪・高潮も内陸現場なので対象外
    if "波浪" in normalized:
        return None

    if "高潮" in normalized:
        return None

    if (
        "大雨" in normalized
        and (
            "警報" in normalized
            or "特別警報" in normalized
        )
    ):
        return "heavyRain"

    if (
        "暴風" in normalized
        and (
            "警報" in normalized
            or "特別警報" in normalized
        )
    ):
        return "storm"

    if (
        "強風" in normalized
        and "注意報" in normalized
    ):
        return "strongWind"

    if (
        "雷" in normalized
        and "注意報" in normalized
    ):
        return "thunder"

    if (
        "乾燥" in normalized
        and "注意報" in normalized
    ):
        return "dry"

    return None


def parse_warning_xml(raw_xml):
    root = ET.fromstring(raw_xml)

    active_keys = set()
    active_names = []

    report_datetime = ""

    for element in root.iter():
        if (
            local_name(element)
            == "ReportDateTime"
            and element.text
        ):
            report_datetime = (
                element.text.strip()
            )

    inactive_statuses = {
        "解除",
        "なし",
        "発表警報・注意報はなし",
        "警報・注意報はなし",
    }

    for item in root.iter():
        if local_name(item) != "Item":
            continue

        if not area_matches(item):
            continue

        for kind in item.iter():
            if local_name(kind) != "Kind":
                continue

            warning_name = child_text(
                kind,
                "Name",
            )

            warning_status = child_text(
    kind,
    "Status",
)

            if not warning_name:
                continue

            if warning_status in inactive_statuses:
                continue

            warning_key = warning_name_to_key(
                warning_name
            )

            if warning_key is None:
                continue

            active_keys.add(
                warning_key
            )

            active_names.append(
                warning_name
            )

    return {
        "keys": active_keys,
        "names": list(
            dict.fromkeys(active_names)
        ),
        "report_datetime": report_datetime,
    }


def fetch_jma_warnings():
    regular_feed = request_bytes(
        JMA_REGULAR_FEED_URL
    )

    latest_report = find_latest_report_url(
        regular_feed,
        "VPWS50",
        VPWS50_FEED_AREA_CODE,
    )

    if latest_report is None:
        raise RuntimeError(
            "VPWS50の最新XMLが見つかりません"
        )

    feed_timestamp, report_url = (
        latest_report
    )

    report_raw = request_bytes(
        report_url
    )

    parsed = parse_warning_xml(
        report_raw
    )

    debug = {
        "type": "VPWS50",
        "feed_timestamp": feed_timestamp,
        "report_datetime": parsed[
            "report_datetime"
        ],
        "active_names": parsed[
            "names"
        ],
        "active_keys": sorted(
            parsed["keys"]
        ),
        "source_file": report_url.rsplit(
            "/",
            1,
        )[-1],
        "target_area_codes": sorted(
            TARGET_AREA_CODES
        ),
        "target_area_names": sorted(
            TARGET_AREA_NAMES
        ),
    }

    return parsed["keys"], debug


# =========================================================
# 雷予報
# =========================================================

def forecast_contains_thunder(
    forecast_data,
):
    for forecast_block in forecast_data:
        for time_series in forecast_block.get(
            "timeSeries",
            [],
        ):
            for area_data in time_series.get(
                "areas",
                [],
            ):
                area = area_data.get(
                    "area",
                    {},
                )

                if (
                    area.get("code")
                    != JMA_FORECAST_AREA_CODE
                ):
                    continue

                weather_texts = area_data.get(
                    "weathers",
                    [],
                ) or []

                if any(
                    "雷" in text
                    for text in weather_texts
                ):
                    return True

    return False


def fetch_thunder_forecast():
    forecast_data = get_json(
        JMA_FORECAST_URL
    )

    return forecast_contains_thunder(
        forecast_data
    )


# =========================================================
# アラート生成
# =========================================================

def add_alert(
    alerts,
    key,
    title,
    immediate=False,
    source="system",
):
    if any(
        alert["key"] == key
        for alert in alerts
    ):
        return

    alerts.append(
        {
            "key": key,
            "title": title,
            "immediate": immediate,
            "source": source,
        }
    )


def is_sunset_window(sunset_value):
    try:
        sunset_datetime = datetime.fromisoformat(
            sunset_value
        )

        if sunset_datetime.tzinfo is None:
            sunset_datetime = (
                sunset_datetime.replace(
                    tzinfo=JST
                )
            )

        now = datetime.now(JST)

        seconds_until_sunset = (
            sunset_datetime
            - now
        ).total_seconds()

        return (
            -10 * 60
            <= seconds_until_sunset
            <= 30 * 60
        )

    except (
        TypeError,
        ValueError,
    ):
        return False


def build_alerts(
    weather,
    thresholds,
    official_warning_keys,
    thunder_forecast,
):
    alerts = []

    precipitation = float(
        weather["precipitation"]
    )

    wind_speed = float(
        weather["wind_speed"]
    )

    rain_probability = float(
        weather["rain_probability"]
    )

    minimum_temperature = float(
        weather["min_temperature"]
    )

    # 大雨
    if (
        "heavyRain"
        in official_warning_keys
        or precipitation
        >= thresholds[
            "heavy_rain_per_hour"
        ]
    ):
        add_alert(
            alerts,
            "heavyRain",
            "大雨・浸水に注意",
            True,
            (
                "jma"
                if "heavyRain"
                in official_warning_keys
                else "measured"
            ),
        )

    # 暴風
    storm_active = (
        "storm"
        in official_warning_keys
        or wind_speed
        >= thresholds["storm_wind"]
    )

    if storm_active:
        add_alert(
            alerts,
            "storm",
            "暴風に厳重警戒",
            True,
            (
                "jma"
                if "storm"
                in official_warning_keys
                else "measured"
            ),
        )

    # 強風
    # 暴風判定時は重複表示しない
    strong_wind_active = (
        "strongWind"
        in official_warning_keys
        or wind_speed
        >= thresholds["strong_wind"]
    )

    if (
        not storm_active
        and strong_wind_active
    ):
        add_alert(
            alerts,
            "strongWind",
            "強風に注意",
            False,
            (
                "jma"
                if "strongWind"
                in official_warning_keys
                else "measured"
            ),
        )

    # 雷注意報を優先
    if "thunder" in official_warning_keys:
        add_alert(
            alerts,
            "thunder",
            "雷注意報",
            False,
            "jma",
        )

    elif thunder_forecast:
        add_alert(
            alerts,
            "thunderForecast",
            "雷予報 発表中",
            False,
            "jma_forecast",
        )

    # 乾燥注意報
    if "dry" in official_warning_keys:
        add_alert(
            alerts,
            "dry",
            "乾燥注意報",
            False,
            "jma",
        )

    # 降水確率
    if (
        rain_probability
        >= thresholds[
            "rain_probability"
        ]
    ):
        add_alert(
            alerts,
            "rainProbability",
            "降水確率が高くなっています",
            False,
            "forecast",
        )

    # 低温・凍結
    if (
        minimum_temperature
        <= thresholds[
            "low_temperature"
        ]
    ):
        add_alert(
            alerts,
            "lowTemperature",
            "低温・凍結に注意",
            False,
            "forecast",
        )

    # 日没
    if is_sunset_window(
        weather["sunset"]
    ):
        add_alert(
            alerts,
            "sunset",
            "日没時刻に注意",
            True,
            "time",
        )

    return alerts


# =========================================================
# 判定
# =========================================================

def build_judgement(alerts):
    danger_keys = {
        "heavyRain",
        "storm",
        "thunder",
    }

    has_danger = any(
        alert["key"] in danger_keys
        for alert in alerts
    )

    if has_danger:
        return {
            "level": "danger",
            "label": "危険",
        }

    if alerts:
        return {
            "level": "caution",
            "label": "注意情報あり",
        }

    return {
        "level": "normal",
        "label": "通常",
    }


# =========================================================
# 安全なJSON保存
# =========================================================

def write_json_atomically(
    output_file,
    payload,
):
    output_file.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    json_text = json.dumps(
        payload,
        ensure_ascii=False,
        indent=2,
    ) + "\n"

    temporary_file = None

    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=output_file.parent,
            prefix="current-",
            suffix=".tmp",
            delete=False,
        ) as temp:
            temp.write(json_text)
            temp.flush()

            temporary_file = Path(
                temp.name
            )

        temporary_file.replace(
            output_file
        )

    finally:
        if (
            temporary_file is not None
            and temporary_file.exists()
        ):
            temporary_file.unlink()


# =========================================================
# メイン
# =========================================================

def main():
    config = load_config()

    # Open-Meteo取得
    open_meteo_url = build_open_meteo_url(
        config
    )

    open_meteo_data = get_json(
        open_meteo_url
    )

    weather = parse_open_meteo(
        open_meteo_data
    )

    # 気象庁の警報・注意報取得
    # 取得できない場合は古い情報で正常扱いにせず、
    # warning_fetch_errorを出力する
    official_warning_keys = set()
    warning_debug = None
    warning_fetch_error = None

    try:
        (
            official_warning_keys,
            warning_debug,
        ) = fetch_jma_warnings()

    except Exception as error:
        warning_fetch_error = (
            f"{type(error).__name__}: "
            f"{error}"
        )

    # 雷予報
    thunder_forecast = False
    thunder_forecast_error = None

    if (
        "thunder"
        not in official_warning_keys
    ):
        try:
            thunder_forecast = (
                fetch_thunder_forecast()
            )

        except Exception as error:
            thunder_forecast_error = (
                f"{type(error).__name__}: "
                f"{error}"
            )

    alerts = build_alerts(
        weather,
        config["thresholds"],
        official_warning_keys,
        thunder_forecast,
    )

    judgement = build_judgement(
        alerts
    )

    generated_at = (
        datetime.now(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )

    payload = {
        "schema_version": 2,
        "generated_at": generated_at,
        "location": {
            "name": LOCATION_NAME,
            "latitude": config[
                "latitude"
            ],
            "longitude": config[
                "longitude"
            ],
        },
        "weather": weather,
        "alerts": alerts,
        "judgement": judgement,
        "official_warnings": {
            "heavyRain": (
                "heavyRain"
                in official_warning_keys
            ),
            "storm": (
                "storm"
                in official_warning_keys
            ),
            "strongWind": (
                "strongWind"
                in official_warning_keys
            ),
            "thunder": (
                "thunder"
                in official_warning_keys
            ),
            "thunderForecast": (
                thunder_forecast
            ),
            "dry": (
                "dry"
                in official_warning_keys
            ),
        },
        "warning_source": (
            "jma-vpws50"
        ),
        "warning_fetch_error": (
            warning_fetch_error
        ),
        "warning_debug": (
            warning_debug
        ),
        "thunder_forecast_error": (
            thunder_forecast_error
        ),
        "notes": [
            (
                "小作駅近くの市街地にある"
                "浄水場現場のため、"
                "土砂災害判定は対象外"
            ),
            (
                "内陸現場のため、"
                "波浪・高潮判定は対象外"
            ),
            (
                "気象取得地点: "
                f"{config['latitude']}, "
                f"{config['longitude']}"
            ),
        ],
    }

    write_json_atomically(
        OUTPUT_FILE,
        payload,
    )

    print(
        "updated:",
        OUTPUT_FILE,
    )

    print(
        "generated_at:",
        generated_at,
    )

    print(
        "weather:",
        weather,
    )

    print(
        "official_warning_keys:",
        sorted(
            official_warning_keys
        ),
    )

    print(
        "alerts:",
        alerts,
    )

    if warning_fetch_error:
        print(
            "WARNING:",
            warning_fetch_error,
        )

    if thunder_forecast_error:
        print(
            "THUNDER FORECAST WARNING:",
            thunder_forecast_error,
        )


if __name__ == "__main__":
    main()
