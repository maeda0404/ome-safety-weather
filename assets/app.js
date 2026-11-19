'use strict';

(() => {

  const $ = (id) => document.getElementById(id);

  const CACHE_KEY = 'ome_safety_last_v5';

  const REFRESH_MS = 5 * 60 * 1000;
  const ROTATION_MS = 20 * 1000;

  let alerts = [];

  let alertIndex = 0;
  let lastRotationTime = 0;
  let lastQueueSignature = '';
  let lastDisplayedKey = '';

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
  // 日時変換
  // =====================================================

  function parseDate(value) {

    if (!value) {
      return null;
    }

    const date = new Date(value);

    if (!Number.isFinite(date.getTime())) {
      return null;
    }

    return date;
  }


  function formatDateTime(value) {

    const date = parseDate(value);

    if (!date) {
      return '--';
    }

    return new Intl.DateTimeFormat(
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
    ).format(date);
  }


  function formatTime(value) {

    const date = parseDate(value);

    if (!date) {
      return '--:--';
    }

    return new Intl.DateTimeFormat(
      'ja-JP',
      {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        minute: '2-digit'
      }
    ).format(date);
  }


  function getJapanMinute() {

    const parts =
      new Intl.DateTimeFormat(
        'en-CA',
        {
          timeZone: 'Asia/Tokyo',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23'
        }
      ).formatToParts(new Date());

    const minutePart =
      parts.find(
        (part) => part.type === 'minute'
      );

    const minute =
      Number(
        minutePart
          ? minutePart.value
          : NaN
      );

    return Number.isFinite(minute)
      ? minute
      : 0;
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
      77: '霧雪',
      80: 'にわか雨',
      81: 'にわか雨',
      82: '激しいにわか雨',
      85: 'にわか雪',
      86: '強いにわか雪',
      95: '雷雨',
      96: '雷雨',
      99: '激しい雷雨'
    };

    return WEATHER_NAMES[Number(code)] || '不明';
  }


  // =====================================================
  // データ鮮度
  //
  // 1時間未満：通信正常
  // 1～3時間：更新遅延
  // 3時間以上：通信失敗
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

    const ageMilliseconds =
      Math.max(
        0,
        Date.now() - generatedTime
      );

    const ageHours =
      ageMilliseconds / 3600000;

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
  // 気象庁情報の取得状態
  // =====================================================

  function getWarningStatusElement() {

    let status =
      $('warningStatus');

    if (status) {
      return status;
    }

    const connection =
      $('connection');

    if (
      !connection ||
      !connection.parentNode
    ) {
      return null;
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

    status.style.whiteSpace =
      'nowrap';

    status.hidden =
      true;

    connection.parentNode.insertBefore(
      status,
      connection.nextSibling
    );

    return status;
  }


  function updateWarningStatus(data) {

    const status =
      getWarningStatusElement();

    if (!status) {
      return;
    }

    const warningError =
      data.warning_fetch_error ||
      data.warningFetchError ||
      null;

    if (warningError) {

      status.textContent =
        '⚠ 警報情報取得失敗';

      status.hidden =
        false;

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
    status.hidden = true;
    status.style.display = 'none';
  }


  // =====================================================
  // データ検証
  // =====================================================

  function isUsableData(data) {

    if (
      !data ||
      !data.weather ||
      !data.generated_at
    ) {
      return false;
    }

    const generatedTime =
      new Date(
        data.generated_at
      ).getTime();

    return Number.isFinite(
      generatedTime
    );
  }


  // =====================================================
  // アラートの整形
  // =====================================================

  function normalizeAlerts(value) {

    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter(
        (alert) =>
          alert &&
          typeof alert.key === 'string' &&
          typeof alert.title === 'string'
      )
      .map(
        (alert) => ({
          key: alert.key,
          title: alert.title,
          immediate: Boolean(
            alert.immediate
          ),
          source: alert.source || ''
        })
      );
  }


  // =====================================================
  // 表示対象のアラート取得
  //
  // immediate=true：
  // 時刻に関係なく即時表示
  //
  // その他：
  // 毎時00分～10分未満に表示
  // =====================================================

  function getOverlayAlerts() {

    const urgent =
      alerts.filter(
        (alert) =>
          Boolean(alert.immediate)
      );

    if (urgent.length > 0) {

      // 即時情報がある場合は
      // 即時情報を優先して表示する
      return urgent;
    }

    const minute =
      getJapanMinute();

    if (
      minute >= 0 &&
      minute < 10
    ) {
      return alerts;
    }

    return [];
  }


  // =====================================================
  // オーバーレイを閉じる
  // =====================================================

  function hideOverlay() {

    const overlay =
      $('alertOverlay');

    if (overlay) {
      overlay.hidden = true;
    }

    alertIndex = 0;
    lastRotationTime = 0;
    lastQueueSignature = '';
    lastDisplayedKey = '';
  }


  // =====================================================
  // 全画面警告表示
  //
  // setIntervalでローテーションせず、
  // 時刻差で20秒経過を判定する。
  //
  // tick()から毎秒呼ばれても、
  // ローテーション時刻はリセットされない。
  // =====================================================

  function showOverlay() {

    const shown =
      getOverlayAlerts();

    const overlay =
      $('alertOverlay');

    if (!overlay) {
      return;
    }

    if (!shown.length) {

      hideOverlay();

      return;
    }

    const signature =
      shown
        .map(
          (alert) =>
            `${alert.key}:${alert.title}`
        )
        .join('|');

    const currentTime =
      Date.now();

    // 表示対象が変更された場合のみ
    // 1枚目へ戻す
    if (
      signature !==
      lastQueueSignature
    ) {

      alertIndex = 0;

      lastRotationTime =
        currentTime;

      lastQueueSignature =
        signature;

      lastDisplayedKey = '';

    } else if (
      shown.length > 1 &&
      currentTime -
        lastRotationTime >=
        ROTATION_MS
    ) {

      // 20秒経過した場合だけ
      // 次の画像へ進める
      alertIndex =
        (
          alertIndex + 1
        ) %
        shown.length;

      lastRotationTime =
        currentTime;
    }

    // アラート数が途中で減った場合の保険
    alertIndex %=
      shown.length;

    const alert =
      shown[alertIndex];

    const image =
      $('overlayImage');

    const fallback =
      $('overlayFallback');

    const overlayCount =
      $('overlayCount');

    overlay.hidden =
      false;

    if (fallback) {

      fallback.textContent =
        alert.title;

      fallback.style.display =
        'none';
    }

    if (image) {

      image.alt =
        alert.title;

      image.style.display =
        'block';

      image.onerror = () => {

        image.style.display =
          'none';

        if (fallback) {
          fallback.style.display =
            'block';
        }
      };

      const imagePath =
        IMAGE_MAP[alert.key];

      if (imagePath) {

        // 同じ画像を毎秒再設定しない
        // 不要な再読込やちらつきを防止する
        if (
          lastDisplayedKey !==
          alert.key
        ) {

          image.src =
            `${imagePath}?v=6`;

          lastDisplayedKey =
            alert.key;
        }

      } else {

        image.style.display =
          'none';

        lastDisplayedKey = '';

        if (fallback) {
          fallback.style.display =
            'block';
        }
      }
    }

    if (overlayCount) {

      overlayCount.textContent =
        shown.length > 1
          ? `${alertIndex + 1} / ${shown.length}`
          : '';
    }
  }


  // =====================================================
  // データ表示
  // =====================================================

  function render(data) {

    if (!isUsableData(data)) {
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

    $('sunset').textContent =
      formatTime(
        weather.sunset
      );

    $('generatedAt').textContent =
      formatDateTime(
        data.generated_at
      );


    // ===================================================
    // 通信状態
    // ===================================================

    const [
      connectionText,
      connectionClass
    ] = freshness(
      data.generated_at
    );

    $('connection').textContent =
      connectionText;

    $('connection').className =
      `status ${connectionClass}`;


    // ===================================================
    // アラート
    // ===================================================

    alerts =
      normalizeAlerts(
        data.alerts
      );


    // ===================================================
    // 総合判定
    // ===================================================

    const judgement =
      data.judgement || {};

    const level =
      judgement.level ||
      (
        alerts.length
          ? 'caution'
          : 'normal'
      );

    const label =
      judgement.label ||
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
    // 発表・判定中情報
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
    // 気象庁情報の取得状態
    // ===================================================

    updateWarningStatus(
      data
    );


    // ===================================================
    // 全画面警告
    // ===================================================

    showOverlay();
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

      const cached =
        JSON.parse(raw);

      return isUsableData(cached)
        ? cached
        : null;

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

      if (!isUsableData(data)) {

        throw new Error(
          'current.jsonの形式が不正です'
        );
      }

      saveCache(data);

      render(data);

    } catch (error) {

      console.error(
        '気象データ取得失敗',
        error
      );

      const cached =
        loadCache();

      if (cached) {

        render(cached);

        $('connection').textContent =
          '▲ 更新遅延';

        $('connection').className =
          'status delay';

      } else {

        alerts = [];

        hideOverlay();

        $('connection').textContent =
          '× データなし';

        $('connection').className =
          'status error';

        $('activeInfo').textContent =
          '最新情報を取得できていません';

        $('judgement').textContent =
          '確認中';

        $('judgementBox').className =
          'judgement normal';
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
  // ・時計更新
  // ・00分で注意情報表示開始
  // ・10分で注意情報表示終了
  // ・20秒ごとの画像切替
  //
  // タイマーを再生成しないため、
  // ローテーションは毎秒リセットされない。
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

  // 保存済みデータがあれば
  // 通信完了を待たず先に表示する
  const cachedData =
    loadCache();

  if (cachedData) {
    render(cachedData);
  }

  // 最新データ取得
  load();

  // 初回時計・オーバーレイ更新
  tick();

  // 毎秒更新
  window.setInterval(
    tick,
    1000
  );

  // 5分ごとに最新JSONを取得
  window.setInterval(
    load,
    REFRESH_MS
  );

})();
