/* ============================================================
   まごのて 需要検証LP ― アンケートフォーム
   要件対応：F-CT-01〜06 / F-FM-* / F-MS-01〜09 / NF-LP-07,08,10
   ------------------------------------------------------------
   設問を増減する場合は下の SCHEMA だけ編集してください。
   画面・進捗バー・バリデーション・送信項目は自動で追従します。
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 設定（デプロイ時に差し替える） ---------- */
  var CONFIG = {
    // Apps Script ウェブアプリのURL（apps-script/Code.gs をデプロイして取得）
    ENDPOINT: 'https://script.google.com/macros/s/__DEPLOY_ID__/exec'
  };
  // 送信までの経過秒数は meta.elapsed として送り、Apps Script 側で判定します
  // （クライアント側での判定は回避できるため、サーバー側に置いています）

  /* ---------- 設問定義（F-FM-01 / F-FM-R-* / F-FM-W-*） ---------- */
  var SCHEMA = {
    // 共通（分岐の起点）
    common: [{
      id: 'role', type: 'radio', required: true,
      q: 'あてはまるものを<br>お選びください',
      options: [
        { v: 'requester', label: '実家のことを誰かに頼みたい' },
        { v: 'worker',    label: '伊万里市で、地域の手伝いをしたい' }
      ]
    }],

    // 依頼側
    requester: [
      { id: 'r_area', type: 'radio', required: true,
        q: '親御さんのお住まいは<br>どちらですか',
        options: [
          { v: '伊万里市',   label: '佐賀県伊万里市' },
          { v: '近隣市町村', label: '伊万里市の近隣（唐津市・武雄市など）' },
          { v: 'それ以外',   label: 'それ以外の地域' }
        ] },
      { id: 'r_tasks', type: 'checkbox', required: true,
        q: '頼みたいことは<br>ありますか',
        hint: 'あてはまるものをすべてお選びください。',
        options: [
          { v: '農作業の手伝い', label: '農作業の手伝い' },
          { v: '掃除',           label: '掃除' },
          { v: '庭のお手入れ',   label: '庭のお手入れ' },
          { v: '買い物代行',     label: '買い物代行' },
          { v: '電球交換・修繕', label: '電球交換・簡単な修繕' },
          { v: '見守り・話し相手', label: '見守り・話し相手' }
        ],
        other: { id: 'r_tasks_other', placeholder: 'そのほか（自由にご記入ください）' } },
      { id: 'r_pay', type: 'radio', required: true,          /* ★H-01 一次判定 */
        q: 'どちらで頼みたいと<br>思われますか',
        hint: 'まごのては、作業後にお礼の金額（チップ）をご自身で選ぶ仕組みです。',
        options: [
          { v: 'チップを払って',   label: 'チップを払って頼みたい' },
          { v: '内容により使い分け', label: '内容によって使い分けたい' },
          { v: '無償で',           label: '無償で頼みたい' }
        ] },
      { id: 'r_tip', type: 'radio', required: true,          /* ★H-01 価格感 */
        q: 'チップを払うとしたら<br>いくらが妥当だと思いますか',
        hint: '1回あたりの目安でお答えください。',
        options: [
          { v: '500円',     label: '500円' },
          { v: '1000円',    label: '1,000円' },
          { v: '2000円',    label: '2,000円' },
          { v: '3000円以上', label: '3,000円以上' }
        ] },
      { id: 'email', type: 'email', required: false,
        q: 'ご連絡先をお聞かせ<br>いただけますか',
        hint: 'サービスを開始する際のご案内にのみ使用します。任意です。',
        placeholder: 'mail@example.com' }
    ],

    // 働き手側
    worker: [
      { id: 'w_area', type: 'radio', required: true,
        q: 'お住まいの市町村を<br>お選びください',
        options: [
          { v: '伊万里市', label: '伊万里市' },
          { v: '唐津市',   label: '唐津市' },
          { v: '武雄市',   label: '武雄市' },
          { v: '佐賀市',   label: '佐賀市' },
          { v: 'その他',   label: 'その他' }
        ] },
      { id: 'w_freq', type: 'radio', required: true,
        q: 'どのくらいの頻度なら<br>動けそうですか',
        options: [
          { v: '週1未満',   label: '週1回より少ない' },
          { v: '週1〜2回',  label: '週1〜2回' },
          { v: '週3回以上', label: '週3回以上' }
        ] },
      { id: 'w_free', type: 'radio', required: true,         /* ★H-01 供給側 */
        q: '無償の依頼も<br>受けたいと思いますか',
        hint: 'まごのてには、依頼者が無償を選んだ依頼と、チップのある依頼があります。',
        options: [
          { v: '受けたい', label: '無償の依頼も受けたい' },
          { v: '内容による', label: '内容による' },
          { v: '有償のみ', label: 'チップのある依頼だけ受けたい' }
        ] },
      { id: 'email', type: 'email', required: false,
        q: 'ご連絡先をお聞かせ<br>いただけますか',
        hint: 'サービスを開始する際のご案内にのみ使用します。任意です。',
        placeholder: 'mail@example.com' }
    ]
  };

  /* ---------- 状態 ---------- */
  var state = { role: null, idx: 0, answers: {}, started: 0, sending: false, done: false };

  var el = {};
  function $(s, r) { return (r || document).querySelector(s); }

  /* ---------- 計測（F-MS-05,06） ---------- */
  function track(name, params) {
    var p = params || {};
    try { if (typeof window.gtag === 'function') window.gtag('event', name, p); } catch (e) {}
    try { (window.dataLayer = window.dataLayer || []).push(Object.assign({ event: name }, p)); } catch (e) {}
  }

  /* ---------- 画面構築 ---------- */
  function steps() {
    return state.role ? SCHEMA.common.concat(SCHEMA[state.role]) : SCHEMA.common;
  }
  function total() {
    // 役割未選択のうちは依頼側（最長）の問数を仮表示する
    return 1 + SCHEMA[state.role || 'requester'].length;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function render() {
    var list = steps(), step = list[state.idx], n = total();

    // 進捗バー
    var bars = '';
    for (var i = 0; i < n; i++) bars += '<i class="' + (i <= state.idx ? 'on' : '') + '"></i>';
    el.prog.innerHTML = bars;
    el.stepno.textContent = '質問 ' + (state.idx + 1) + ' / ' + n;

    var h = '<div class="q">' + step.q + '</div>';
    if (step.hint) h += '<p class="qhint">' + esc(step.hint) + '</p>';
    h += '<div class="opts">';

    var saved = state.answers[step.id];

    if (step.type === 'radio' || step.type === 'checkbox') {
      var shape = step.type === 'radio' ? 'r' : 'c';
      step.options.forEach(function (o, i) {
        var checked = step.type === 'radio'
          ? (saved === o.v)
          : (Array.isArray(saved) && saved.indexOf(o.v) !== -1);
        h += '<label class="opt">'
           +   '<input type="' + step.type + '" name="' + esc(step.id) + '" value="' + esc(o.v) + '"'
           +     (checked ? ' checked' : '') + '>'
           +   '<span class="' + shape + '"></span>'
           +   '<span>' + esc(o.label) + '</span>'
           + '</label>';
      });
      if (step.other) {
        h += '<input class="field" type="text" id="' + esc(step.other.id) + '" maxlength="100"'
           + ' placeholder="' + esc(step.other.placeholder) + '"'
           + ' value="' + esc(state.answers[step.other.id] || '') + '">';
      }
    } else if (step.type === 'email') {
      h += '<input class="field" type="email" id="' + esc(step.id) + '" maxlength="120"'
         + ' autocomplete="email" inputmode="email"'
         + ' placeholder="' + esc(step.placeholder || '') + '"'
         + ' value="' + esc(saved || '') + '">';
    }
    h += '</div>';

    el.body.innerHTML = h;
    el.err.classList.remove('show');
    el.err.textContent = '';   // role="alert" が前の文言を読み上げないよう消す

    var last = state.idx === list.length - 1;
    el.next.textContent = last ? '回答を送信する' : '次へすすむ';
    el.back.style.display = state.idx === 0 ? 'none' : 'block';
    el.next.disabled = false;

    track('form_step', { step_index: state.idx + 1, step_id: step.id, role: state.role || '' });
  }

  /* ---------- 入力の取得と検証（NF-LP-10） ---------- */
  function collect() {
    var step = steps()[state.idx];
    if (step.type === 'radio') {
      var r = $('input[name="' + step.id + '"]:checked', el.body);
      return r ? r.value : null;
    }
    if (step.type === 'checkbox') {
      return Array.prototype.map.call(
        el.body.querySelectorAll('input[name="' + step.id + '"]:checked'),
        function (i) { return i.value; });
    }
    var f = $('#' + step.id, el.body);
    return f ? f.value.trim() : '';
  }

  function validate(step, val) {
    if (step.type === 'checkbox') {
      var other = step.other ? ($('#' + step.other.id, el.body) || {}).value : '';
      if (step.required && !val.length && !(other && other.trim())) {
        return 'ひとつ以上お選びください。';
      }
      return null;
    }
    if (step.required && !val) return 'お選びください。';
    if (step.type === 'email' && val) {
      if (val.length > 120) return 'メールアドレスが長すぎます。';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val)) return 'メールアドレスの形式をご確認ください。';
    }
    return null;
  }

  function showErr(msg) {
    el.err.textContent = msg;
    el.err.classList.add('show');
    el.err.scrollIntoView({ block: 'nearest' });
  }

  /* ---------- 遷移 ---------- */
  function onNext() {
    if (state.sending) return;
    var list = steps(), step = list[state.idx], val = collect();
    var msg = validate(step, val);
    if (msg) { track('form_error', { step_id: step.id }); return showErr(msg); }

    state.answers[step.id] = val;
    if (step.other) {
      var o = $('#' + step.other.id, el.body);
      if (o) state.answers[step.other.id] = o.value.trim().slice(0, 100);
    }
    if (step.id === 'role') state.role = val;

    if (state.idx === steps().length - 1) return submit();
    state.idx++;
    render();
    el.card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function onBack() {
    if (state.sending || state.idx === 0) return;
    state.answers[steps()[state.idx].id] = collect();
    state.idx--;
    render();
  }

  /* ---------- 送信（F-MS-08,09） ---------- */
  function utm() {
    var q = new URLSearchParams(location.search), o = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) {
      if (q.get(k)) o[k] = q.get(k).slice(0, 80);
    });
    return o;
  }

  function submit() {
    var elapsed = (Date.now() - state.started) / 1000;
    var payload = {
      role: state.role,
      answers: state.answers,
      meta: {
        elapsed: Math.round(elapsed),
        referrer: document.referrer.slice(0, 200),
        ua: navigator.userAgent.slice(0, 200),
        utm: utm(),
        hp: el.hp.value          // honeypot：人間なら必ず空（NF-LP-07）
      }
    };

    state.sending = true;
    el.next.disabled = true;
    el.next.textContent = '送信しています…';
    track('form_submit', { role: state.role });

    // Apps Script は OPTIONS を処理しないため、プリフライトを起こさない
    // text/plain で送る（受信側で JSON.parse する）
    fetch(CONFIG.ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); })
      .then(function (res) {
        if (res && res.ok === false) throw new Error(res.error || 'rejected');
        finish();
      })
      .catch(function (e) {
        state.sending = false;
        el.next.disabled = false;
        el.next.textContent = '回答を送信する';
        showErr('送信できませんでした。通信環境をご確認のうえ、もう一度お試しください。');
        track('form_fail', { reason: String(e && e.message || e).slice(0, 80) });
      });
  }

  function finish() {
    state.done = true;
    el.form.style.display = 'none';
    el.done.classList.add('show');
    el.done.scrollIntoView({ behavior: 'smooth', block: 'center' });
    track('form_complete', { role: state.role });
  }

  /* ---------- 初期化 ---------- */
  function init() {
    el.card   = $('#surveyCard');
    if (!el.card) return;
    el.form   = $('#surveyForm');
    el.prog   = $('#prog');
    el.stepno = $('#stepno');
    el.body   = $('#qbody');
    el.err    = $('#err');
    el.next   = $('#next');
    el.back   = $('#back');
    el.hp     = $('#hp_company');
    el.done   = $('#surveyDone');

    state.started = Date.now();

    // #next は type="submit"。click と submit の両方を拾うと onNext が二重に走るため、
    // submit だけを listen する（Enterキーでの送信もここで拾える）
    el.form.addEventListener('submit', function (e) { e.preventDefault(); onNext(); });
    el.back.addEventListener('click', onBack);

    // 選択したら即エラーを消す
    el.body.addEventListener('change', function () { el.err.classList.remove('show'); });

    // CTAクリックの計測。role指定があればQ1を先に埋める（F-CT-04）
    Array.prototype.forEach.call(document.querySelectorAll('[data-cta]'), function (a) {
      a.addEventListener('click', function () {
        var role = a.getAttribute('data-role');
        track('cta_click', { cta: a.getAttribute('data-cta'), role: role || '' });
        if (role && state.idx === 0 && !state.done) {
          state.role = role;
          state.answers.role = role;
          state.idx = 1;
          render();
        }
      });
    });

    render();
    track('form_view', {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
