'use strict';

(() => {

  const $ = (id) => document.getElementById(id);

  const CACHE_KEY = 'ome_safety_last_v4';

  const REFRESH_MS = 5 * 60 * 1000;
  const ROTATION_MS = 20 * 1000;

  let alerts = [];
  let alertIndex = 0;
  let rotationTimer = null;

  const IMAGE_MAP = {
    dry: 'images/dry-warning.png',
    dryWarning: 'images/dry-warning.png',
    rainProbability: 'images/rain-probability.png',
    lowTemperature: 'images/low-temperature.png',
    heavyRain: 'images/heavy-rain.png',
    sunset: 'images/sunset.png',
    strongWind: 'images/strong-wind.png',
    storm: 'images/storm.png',
    thunder: 'images/thunder.png',
    thunderForecast: 'images/thunder-forecast.png'
  };

  // =====================================================
  // 画面サイズ調整
  // =====================================================

  function fit() {

    const stage = $('stage');

    if (!stage) {
      return;
    }

    const scale = Math.min(
      window.innerWidth / 1920,
      window.innerHeight / 1080
    );

    stage.style.transform =
      `translate(-50%, -50%) scale(${scale})`;
  }


  // =====================================================
  // 数値表示
  // =====================================================

  function fmt(value, digits = 1) {

    const number = Number(value);

    if (!Number.isFinite(number)) {
      return '--';
    }

    return number.toFixed(digits);
  }


  // =====================================================
  // 天気コード
  // =====================================================

  function weatherText(code) {

    const WEATHER_NAMES = {
      0: '快晴',
      1: '晴れ',
      2: '晴れ時々曇り',
      3: '曇り',
      45: '霧',
      48: '霧',
      51: '弱い霧雨',
      53: '霧雨',
      55: '強い霧雨',
      61: '弱い雨',
      63: '雨',
      65: '強い雨',
      71: '弱い雪',
      73: '雪',
      75: '強い雪',
      80: 'にわか雨',
      81: 'にわか雨',
      82: '激しいにわか雨',
      95: '雷雨',
      96: '雷雨',
      99: '激しい雷雨'
    };

    return WEATHER_NAMES[code] || '不明';
  }


  // =====================================================
  // データ鮮度
  //
  // 1時間未満     通信正常
  // 1～3時間      更新遅延
  // 3時間以上     通信失敗
  // =====================================================

  function freshness(iso) {

    const generatedTime =
      new Date(iso).getTime();

    if (!Number.isFinite(generatedTime)) {
      return [
        '× 通信失敗',
        'error'
      ];
    }

    const ageHours =
      (
        Date.now() -
        generatedTime
      ) / 3600000;

    if (ageHours < 1) {

      return [
        '● 通信正常',
        'normal'
      ];

    }

    if (ageHours < 3) {

      return [
        '▲ 更新遅延',
        'delay'
      ];

    }

    return [
      '× 通信失敗',
      'error'
    ];
  }


  // =====================================================
  // 気象庁取得状態
  // =====================================================

  function updateWarningStatus(data) {

    let status = $('warningStatus');

    // HTML側にwarningStatusが無ければ
    // connectionの横へ自動生成する
    if (!status) {

      const connection =
        $('connection');

      if (
        !connection ||
        !connection.parentNode
      ) {
        return;
      }

      status =
        document.createElement('span');

      status.id =
        'warningStatus';

      status.style.marginLeft =
        '12px';

      status.style.padding =
        '4px 10px';

      status.style.borderRadius =
        '8px';

      status.style.fontWeight =
        'bold';

      connection.parentNode.insertBefore(
        status,
        connection.nextSibling
      );
    }

    if (
      data.warning_fetch_error
    ) {

      status.textContent =
        '⚠ 警報情報取得失敗';

      status.style.display =
        'inline-block';

      status.style.color =
        '#8a5700';

      status.style.backgroundColor =
        '#fff3cd';

      status.style.border =
        '2px solid #d39e00';

      return;
    }

    status.textContent = '';

    status.style.display =
      'none';
  }


  // =====================================================
  // データ表示
  // =====================================================

  function render(data) {

    if (
      !data ||
      !data.weather
    ) {
      return;
    }

    const weather =
      data.weather;

    $('temperature').textContent =
      fmt(
        weather.temperature
      );

    $('weather').textContent =
      weather.text ||
      weatherText(
        weather.code
      );

    $('rainProbability').textContent =
      fmt(
        weather.rain_probability,
        0
      );

    $('precipitation').textContent =
      fmt(
        weather.precipitation
      );

    $('windSpeed').textContent =
      fmt(
        weather.wind_speed
      );

    $('minTemperature').textContent =
      fmt(
        weather.min_temperature
      );

    // Python側では
    // 2026-11-19T16:32
    // の形式で出力されるため
    // HH:MMだけ表示
    if (weather.sunset) {

      const sunsetDate =
        new Date(
          weather.sunset
        );

      if (
        Number.isFinite(
          sunsetDate.getTime()
        )
      ) {

        $('sunset').textContent =
          new Intl.DateTimeFormat(
            'ja-JP',
            {
              timeZone: 'Asia/Tokyo',
              hour: '2-digit',
              minute: '2-digit'
            }
          ).format(
            sunsetDate
          );

      } else {

        $('sunset').textContent =
          weather.sunset;
      }

    } else {

      $('sunset').textContent =
        '--:--';
    }


    // ===================================================
    // データ生成時刻
    // ===================================================

    const generatedAt =
      data.generated_at;

    if (generatedAt) {

      const generatedDate =
        new Date(
          generatedAt
        );

      if (
        Number.isFinite(
          generatedDate.getTime()
        )
      ) {

        $('generatedAt').textContent =
          new Intl.DateTimeFormat(
            'ja-JP',
            {
              timeZone: 'Asia/Tokyo',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              weekday: 'short',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            }
          ).format(
            generatedDate
          );

      } else {

        $('generatedAt').textContent =
          '--';
      }

    } else {

      $('generatedAt').textContent =
        '--';
    }


    // ===================================================
    // 通信状態
    // ===================================================

    const [
      connectionText,
      connectionClass
    ] = freshness(
      generatedAt
    );

    $('connection').textContent =
      connectionText;

    $('connection').className =
      `status ${connectionClass}`;


    // ===================================================
    // アラート
    // ===================================================

    alerts =
      Array.isArray(data.alerts)
        ? data.alerts
        : [];


    // ===================================================
    // 総合判定
    // ===================================================

    const level =
      data.judgement?.level ||
      'normal';

    const label =
      data.judgement?.label ||
      (
        alerts.length
          ? '注意情報あり'
          : '通常'
      );

    $('judgement').textContent =
      label;

    $('judgementBox').className =
      `judgement ${level}`;


    // ===================================================
    // 発表・判定中の情報
    // ===================================================

    $('activeInfo').textContent =
      alerts.length
        ? alerts
            .map(
              (alert) =>
                alert.title
            )
            .join('　／　')
        : '発表・判定中の情報はありません';


    // ===================================================
    // 気象庁取得エラー
    // ===================================================

    updateWarningStatus(
      data
    );


    // ===================================================
    // 全画面注意表示
    // ===================================================

    showOverlay();
  }


  // =====================================================
  // 全画面注意表示
  //
  // immediate = true
  // → 時刻に関係なく即時表示
  //
  // その他
  // → 毎時00分～10分のみ表示
  // =====================================================

  function showOverlay() {

    if (rotationTimer) {

      clearInterval(
        rotationTimer
      );

      rotationTimer =
        null;
    }

    const urgent =
      alerts.filter(
        (alert) =>
          Boolean(
            alert.immediate
          )
      );

    const now =
      new Date();

    const minute =
      Number(
        new Intl.DateTimeFormat(
          'en-CA',
          {
            timeZone: 'Asia/Tokyo',
            minute: '2-digit'
          }
        ).format(now)
      );

    let shown = [];

    // 警報級・日没がある場合は
    // 即時項目だけを優先表示
    if (urgent.length) {

      shown = urgent;

    } else if (
      minute >= 0 &&
      minute < 10
    ) {

      // 注意情報は毎時00～10分
      shown = alerts;

    }

    const overlay =
      $('alertOverlay');

    if (!shown.length) {

      overlay.hidden =
        true;

      alertIndex = 0;

      return;
    }

    alertIndex = 0;


    // ===================================================
    // 画像描画
    // ===================================================

    const draw = () => {

      const alert =
        shown[alertIndex];

      const image =
        $('overlayImage');

      const fallback =
        $('overlayFallback');

      overlay.hidden =
        false;

      fallback.textContent =
        alert.title;

      fallback.style.display =
        'none';

      image.style.display =
        'block';

      image.alt =
        alert.title;

      image.onerror = () => {

        image.style.display =
          'none';

        fallback.style.display =
          'block';
      };

      const imagePath =
        IMAGE_MAP[
          alert.key
        ];

      if (imagePath) {

        image.src =
          `${imagePath}?v=5`;

      } else {

        image.style.display =
          'none';

        fallback.style.display =
          'block';
      }

      $('overlayCount').textContent =
        shown.length > 1
          ? `${alertIndex + 1} / ${shown.length}`
          : '';

      alertIndex =
        (
          alertIndex + 1
        ) %
        shown.length;
    };


    // 最初の1枚を即表示
    draw();


    // 複数ある場合は20秒ごとに切替
    if (shown.length > 1) {

      rotationTimer =
        setInterval(
          draw,
          ROTATION_MS
        );
    }
  }


  // =====================================================
  // キャッシュ保存
  // =====================================================

  function saveCache(data) {

    try {

      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify(data)
      );

    } catch (error) {

      console.warn(
        'キャッシュ保存失敗',
        error
      );
    }
  }


  // =====================================================
  // キャッシュ取得
  // =====================================================

  function loadCache() {

    try {

      const raw =
        localStorage.getItem(
          CACHE_KEY
        );

      if (!raw) {
        return null;
      }

      return JSON.parse(
        raw
      );

    } catch (error) {

      console.warn(
        'キャッシュ読込失敗',
        error
      );

      return null;
    }
  }


  // =====================================================
  // データ取得
  // =====================================================

  async function load() {

    try {

      const response =
        await fetch(
          `data/current.json?t=${Date.now()}`,
          {
            cache: 'no-store'
          }
        );

      if (!response.ok) {

        throw new Error(
          `HTTP ${response.status}`
        );
      }

      const data =
        await response.json();

      if (
        !data ||
        !data.weather ||
        !data.generated_at
      ) {

        throw new Error(
          'current.jsonの形式が不正です'
        );
      }

      const generatedTime =
        new Date(
          data.generated_at
        ).getTime();

      if (
        !Number.isFinite(
          generatedTime
        )
      ) {

        throw new Error(
          'generated_atが不正です'
        );
      }

      saveCache(
        data
      );

      render(
        data
      );

    } catch (error) {

      console.error(
        '気象データ取得失敗',
        error
      );

      const last =
        loadCache();

      if (last) {

        render(
          last
        );

        $('connection').textContent =
          '▲ 更新遅延';

        $('connection').className =
          'status delay';

      } else {

        $('connection').textContent =
          '× データなし';

        $('connection').className =
          'status error';

        $('activeInfo').textContent =
          '最新情報を取得できていません';
      }
    }
  }


  // =====================================================
  // 現在時刻
  // =====================================================

  function clock() {

    $('clock').textContent =
      new Intl.DateTimeFormat(
        'ja-JP',
        {
          timeZone: 'Asia/Tokyo',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }
      ).format(
        new Date()
      );
  }


  // =====================================================
  // 毎秒処理
  //
  // 00分への切替・10分での解除・日没表示などを
  // データ再取得を待たず反映させる
  // =====================================================

  function tick() {

    clock();

    showOverlay();
  }


  // =====================================================
  // 起動
  // =====================================================

  window.addEventListener(
    'resize',
    fit
  );

  fit();

  // 起動直後にキャッシュがあれば先に表示
  const cachedData =
    loadCache();

  if (cachedData) {

    render(
      cachedData
    );
  }

  // 最新データ取得
  load();

  clock();

  // 時計・表示タイミング確認
  setInterval(
    tick,
    1000
  );

  // 気象データ取得
  // 5分間隔
  setInterval(
    load,
    REFRESH_MS
  );

})();
