'use strict';

(() => {

  const $ = (id) => document.getElementById(id);

  const CACHE_KEY = 'ome_safety_last_v6';

  const REFRESH_MS = 5 * 60 * 1000;
  const ROTATION_MS = 20 * 1000;

  let currentData = null;
  let alerts = [];

  let alertIndex = 0;
  let lastRotationTime = 0;
  let lastQueueSignature = '';
  let lastDisplayedKey = '';

  let fetchFailed = false;


  // =====================================================
  // 画像
  // =====================================================

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
  // 日時処理
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


  // =====================================================
  // 日没時刻表示
  //
  // 以下のすべてに対応
  //
  // 16:32
  // 2026-11-19T16:32
  // 2026-11-19T16:32:00
  // 2026-11-19T07:32:00Z
  // =====================================================

  function formatTime(value) {

    if (!value) {
      return '--:--';
    }

    const text =
      String(value).trim();


    // HH:MM
    if (
      /^\d{2}:\d{2}$/.test(text)
    ) {
      return text;
    }


    // YYYY-MM-DDTHH:MM
    //
    // Open-Meteoから返される
    // タイムゾーン指定済みのローカル時刻
    if (
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)
    ) {
      return text.slice(11, 16);
    }


    // YYYY-MM-DDTHH:MM:SS
    if (
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)
    ) {
      return text.slice(11, 16);
    }


    // Z または +09:00 などの
    // タイムゾーン付きISO日時
    const date =
      new Date(text);

    if (
      !Number.isFinite(
        date.getTime()
      )
    ) {

      console.warn(
        '日没時刻を解析できません',
        value
      );

      return '--:--';
    }


    return new Intl.DateTimeFormat(
      'ja-JP',
      {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }
    ).format(date);
  }


  // =====================================================
  // 日本時間の「分」
  // =====================================================

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
      ).formatToParts(
        new Date()
      );

    const minutePart =
      parts.find(
        (part) =>
          part.type === 'minute'
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

    return (
      WEATHER_NAMES[
        Number(code)
      ] ||
      '不明'
    );
  }


  // =====================================================
  // データ鮮度
  //
  // 1時間未満
  // → 通信正常
  //
  // 1～3時間
  // → 更新遅延
  //
  // 3時間以上
  // → 通信失敗
  // =====================================================

  function freshness(iso) {

    const generatedTime =
      new Date(
        iso
      ).getTime();

    if (
      !Number.isFinite(
        generatedTime
      )
    ) {

      return [
        '× 通信失敗',
        'error'
      ];
    }


    const ageMilliseconds =
      Math.max(
        0,
        Date.now() -
          generatedTime
      );


    const ageHours =
      ageMilliseconds /
      (
        60 *
        60 *
        1000
      );


    if (
      ageHours < 1
    ) {

      return [
        '● 通信正常',
        'normal'
      ];
    }


    if (
      ageHours < 3
    ) {

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
  // 通信状態
  //
  // 毎秒generated_atを確認
  // =====================================================

  function updateConnectionStatus() {

    if (!currentData) {
      return;
    }


    const [
      freshnessText,
      freshnessClass
    ] = freshness(
      currentData.generated_at
    );


    let text =
      freshnessText;

    let className =
      freshnessClass;


    // JSON取得自体が失敗している場合
    if (fetchFailed) {

      if (
        freshnessClass ===
        'error'
      ) {

        text =
          '× 通信失敗';

        className =
          'error';

      } else {

        text =
          '▲ 更新遅延';

        className =
          'delay';
      }
    }


    const connection =
      $('connection');

    if (connection) {

      connection.textContent =
        text;

      connection.className =
        `status ${className}`;
    }
  }


  // =====================================================
  // 気象庁・防災情報取得状態
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
      document.createElement(
        'span'
      );


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


    // 気象庁警報・注意報だけでなく
    // 雷予報取得失敗も監視
    const warningError =
      data.warning_fetch_error ||
      data.warningFetchError ||
      data.thunder_forecast_error ||
      null;


    if (warningError) {

      status.textContent =
        '⚠ 防災情報の一部を取得できていません';

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


    status.textContent =
      '';

    status.hidden =
      true;

    status.style.display =
      'none';
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
  // アラート整形
  // =====================================================

  function normalizeAlerts(value) {

    if (
      !Array.isArray(value)
    ) {

      return [];
    }


    return value

      .filter(

        (alert) =>

          alert &&

          typeof alert.key ===
            'string' &&

          typeof alert.title ===
            'string'

      )

      .map(

        (alert) => ({

          key:
            alert.key,

          title:
            alert.title,

          immediate:
            Boolean(
              alert.immediate
            ),

          source:
            alert.source || ''

        })

      );
  }


  // =====================================================
  // 全画面表示対象
  //
  // immediate = true
  // → 常時即時表示
  //
  // その他
  // → 毎時00分～10分未満
  // =====================================================

  function getOverlayAlerts() {

    const urgent =
      alerts.filter(
        (alert) =>
          Boolean(
            alert.immediate
          )
      );


    // 警報級・日没を優先
    if (
      urgent.length > 0
    ) {

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
  // オーバーレイ非表示
  // =====================================================

  function hideOverlay() {

    const overlay =
      $('alertOverlay');


    if (overlay) {

      overlay.hidden =
        true;
    }


    alertIndex =
      0;

    lastRotationTime =
      0;

    lastQueueSignature =
      '';

    lastDisplayedKey =
      '';
  }


  // =====================================================
  // 全画面警告
  //
  // 毎秒呼ばれても
  // 20秒ローテーションをリセットしない
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


    // アラート内容自体が変化した場合のみ
    // 1枚目へ戻す
    if (
      signature !==
      lastQueueSignature
    ) {

      alertIndex =
        0;


      lastRotationTime =
        currentTime;


      lastQueueSignature =
        signature;


      lastDisplayedKey =
        '';
    }


    // 内容が同じ場合は
    // 20秒経過時のみ次へ
    else if (
      shown.length > 1 &&
      currentTime -
        lastRotationTime >=
        ROTATION_MS
    ) {

      alertIndex =
        (
          alertIndex + 1
        ) %
        shown.length;


      lastRotationTime =
        currentTime;
    }


    alertIndex %=
      shown.length;


    const alert =
      shown[
        alertIndex
      ];


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


      image.onerror =
        () => {

          image.style.display =
            'none';


          if (fallback) {

            fallback.style.display =
              'block';
          }
        };


      const imagePath =
        IMAGE_MAP[
          alert.key
        ];


      if (imagePath) {

        // 同じ画像を毎秒読み直さない
        if (
          lastDisplayedKey !==
          alert.key
        ) {

          image.src =
            `${imagePath}?v=8`;


          lastDisplayedKey =
            alert.key;
        }

      } else {

        image.style.display =
          'none';


        lastDisplayedKey =
          '';


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
  // メイン表示
  // =====================================================

  function render(data) {

    if (
      !isUsableData(data)
    ) {

      return;
    }


    currentData =
      data;


    const weather =
      data.weather;


    // ===================================================
    // 現在気温
    // ===================================================

    const temperature =
      $('temperature');

    if (temperature) {

      temperature.textContent =
        fmt(
          weather.temperature
        );
    }


    // ===================================================
    // 天気
    // ===================================================

    const weatherElement =
      $('weather');

    if (weatherElement) {

      weatherElement.textContent =
        weather.text ||
        weatherText(
          weather.code
        );
    }


    // ===================================================
    // 降水確率
    // ===================================================

    const rainProbability =
      $('rainProbability');

    if (rainProbability) {

      rainProbability.textContent =
        fmt(
          weather.rain_probability,
          0
        );
    }


    // ===================================================
    // 降水量
    // ===================================================

    const precipitation =
      $('precipitation');

    if (precipitation) {

      precipitation.textContent =
        fmt(
          weather.precipitation
        );
    }


    // ===================================================
    // 風速
    // ===================================================

    const windSpeed =
      $('windSpeed');

    if (windSpeed) {

      windSpeed.textContent =
        fmt(
          weather.wind_speed
        );
    }


    // ===================================================
    // 最低気温
    // ===================================================

    const minTemperature =
      $('minTemperature');

    if (minTemperature) {

      minTemperature.textContent =
        fmt(
          weather.min_temperature
        );
    }


    // ===================================================
    // 日没時刻
    //
    // Pythonが毎回取得した
    // weather.sunsetを表示
    // ===================================================

    const sunset =
      $('sunset');

    if (sunset) {

      sunset.textContent =
        formatTime(
          weather.sunset
        );
    }


    // ===================================================
    // データ生成時刻
    // ===================================================

    const generatedAt =
      $('generatedAt');

    if (generatedAt) {

      generatedAt.textContent =
        formatDateTime(
          data.generated_at
        );
    }


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
      data.judgement ||
      {};


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


    const judgementElement =
      $('judgement');


    if (judgementElement) {

      judgementElement.textContent =
        label;
    }


    const judgementBox =
      $('judgementBox');


    if (judgementBox) {

      judgementBox.className =
        `judgement ${level}`;
    }


    // ===================================================
    // 発表・判定中情報
    // ===================================================

    const activeInfo =
      $('activeInfo');


    if (activeInfo) {

      activeInfo.textContent =
        alerts.length
          ? alerts
              .map(
                (alert) =>
                  alert.title
              )
              .join('　／　')
          : '発表・判定中の情報はありません';
    }


    // ===================================================
    // 気象庁情報取得状態
    // ===================================================

    updateWarningStatus(
      data
    );


    // ===================================================
    // 通信状態
    // ===================================================

    updateConnectionStatus();


    // ===================================================
    // オーバーレイ
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
  // キャッシュ読込
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


      return isUsableData(
        cached
      )
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
  // 最新データ取得
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


      const nextData =
        await response.json();


      if (
        !isUsableData(
          nextData
        )
      ) {

        throw new Error(
          'current.jsonの形式が不正です'
        );
      }


      fetchFailed =
        false;


      currentData =
        nextData;


      saveCache(
        nextData
      );


      render(
        nextData
      );


    } catch (error) {

      console.error(
        '気象データ取得失敗',
        error
      );


      fetchFailed =
        true;


      const cached =
        isUsableData(
          currentData
        )
          ? currentData
          : loadCache();


      // =================================================
      // キャッシュあり
      // =================================================

      if (
        isUsableData(
          cached
        )
      ) {

        currentData =
          cached;


        render(
          cached
        );


        updateConnectionStatus();
      }


      // =================================================
      // キャッシュなし
      // =================================================

      else {

        currentData =
          null;


        alerts =
          [];


        hideOverlay();


        const connection =
          $('connection');


        if (connection) {

          connection.textContent =
            '× データなし';


          connection.className =
            'status error';
        }


        const activeInfo =
          $('activeInfo');


        if (activeInfo) {

          activeInfo.textContent =
            '最新情報を取得できていません';
        }


        const judgement =
          $('judgement');


        if (judgement) {

          judgement.textContent =
            '確認中';
        }


        const judgementBox =
          $('judgementBox');


        if (judgementBox) {

          judgementBox.className =
            'judgement normal';
        }
      }
    }
  }


  // =====================================================
  // 時計
  // =====================================================

  function clock() {

    const clockElement =
      $('clock');


    if (!clockElement) {
      return;
    }


    clockElement.textContent =
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
  // 1秒ごとの処理
  //
  // ・時計更新
  // ・データ鮮度確認
  // ・00～10分表示制御
  // ・20秒ローテーション
  // =====================================================

  function tick() {

    clock();

    updateConnectionStatus();

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


  // 保存済みデータを先に表示
  const cachedData =
    loadCache();


  if (cachedData) {

    currentData =
      cachedData;


    render(
      cachedData
    );
  }


  // 最新データ取得
  load();


  // 初回更新
  tick();


  // =====================================================
  // 毎秒
  // =====================================================

  window.setInterval(
    tick,
    1000
  );


  // =====================================================
  // 5分ごとに最新current.json取得
  // =====================================================

  window.setInterval(
    load,
    REFRESH_MS
  );

})();
