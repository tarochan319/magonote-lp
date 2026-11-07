/**
 * まごのて 需要検証LP ― アンケート受信スクリプト
 *
 * 対応要件：F-MS-01〜09 / NF-LP-07（スパム対策）/ NF-LP-09（削除）/ NF-LP-10（検証）
 *
 * ■ セットアップ
 *   1. 回答を貯めるGoogleスプレッドシートを作る
 *   2. そのシートで 拡張機能 → Apps Script を開き、本ファイルの内容を貼り付ける
 *   3. 下の SHEET_NAME を必要に応じて変更する
 *   4. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *        次のユーザーとして実行：自分
 *        アクセスできるユーザー：全員
 *   5. 発行されたURLを assets/app.js の CONFIG.ENDPOINT に貼る
 *
 * ■ 注意
 *   コードを変更したら、必ず「デプロイを管理」から新しいバージョンを発行してください。
 *   発行しないと旧バージョンが動き続けます。
 */

var SHEET_NAME = '回答';

/** 列の定義。順序を変えるとシートの列順も変わります。 */
var COLUMNS = [
  '送信日時', '区分',
  // 依頼側
  '親の居住地', '頼みたい作業', 'そのほかの作業', '料金の希望', 'チップ妥当額',
  // 働き手側
  '居住市町村', '稼働頻度', '無償案件の受諾',
  // 共通
  'メールアドレス',
  // 計測用
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  '参照元', '所要秒数', 'UserAgent'
];

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ ok: false, error: 'empty' });
    }

    var data = JSON.parse(e.postData.contents);
    var a = data.answers || {};
    var m = data.meta || {};

    // --- スパム判定（NF-LP-07）---------------------------------
    // honeypot に値が入っている＝自動入力。成功を装って捨てる
    if (m.hp) { return json({ ok: true, skipped: 'hp' }); }
    // 人間が6問を4秒未満で終えることはない
    if (Number(m.elapsed) < 4) { return json({ ok: true, skipped: 'fast' }); }

    // --- 必須項目の検証（NF-LP-10）------------------------------
    var role = String(data.role || '');
    if (role !== 'requester' && role !== 'worker') {
      return json({ ok: false, error: 'bad_role' });
    }
    var email = clean(a.email, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return json({ ok: false, error: 'bad_email' });
    }

    var utm = m.utm || {};
    var row = [
      new Date(),
      role === 'requester' ? '依頼側' : '働き手側',
      clean(a.r_area, 40),
      clean(Array.isArray(a.r_tasks) ? a.r_tasks.join(' / ') : a.r_tasks, 300),
      clean(a.r_tasks_other, 100),
      clean(a.r_pay, 40),
      clean(a.r_tip, 40),
      clean(a.w_area, 40),
      clean(a.w_freq, 40),
      clean(a.w_free, 40),
      email,
      clean(utm.utm_source, 80),
      clean(utm.utm_medium, 80),
      clean(utm.utm_campaign, 80),
      clean(utm.utm_content, 80),
      clean(utm.utm_term, 80),
      clean(m.referrer, 200),
      Number(m.elapsed) || '',
      clean(m.ua, 200)
    ];

    // 同時送信が重なっても行が壊れないようロックを取る
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      sheet().appendRow(row);
    } finally {
      lock.releaseLock();
    }

    return json({ ok: true });

  } catch (err) {
    console.error(err);
    return json({ ok: false, error: 'server' });
  }
}

/** 動作確認用。ブラウザでデプロイURLを開くと表示されます。 */
function doGet() {
  return json({ ok: true, service: 'magonote-survey' });
}

/* ---------------- 内部処理 ---------------- */

/**
 * 文字列を安全な形に整える。
 * - 長さを切り詰める
 * - 制御文字を除去する
 * - 先頭が = + - @ の値はスプレッドシートが数式として解釈するため、
 *   先頭にアポストロフィを付けて文字列として扱わせる（数式インジェクション対策）
 */
function clean(v, max) {
  if (v === null || v === undefined) return '';
  var s = String(v).replace(/[\u0000-\u001F\u007F]/g, '').slice(0, max || 200).trim();
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

function sheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
  }
  if (sh.getLastRow() === 0) {
    sh.appendRow(COLUMNS);
    sh.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- 集計用ヘルパー ---------------- */

/**
 * 検証に必要な集計を「集計」シートに書き出します。
 * Apps Scriptエディタから手動で実行してください。
 *
 * 出すもの：
 *   - 依頼側／働き手側の件数（F-MS-01）
 *   - 依頼側の料金希望の内訳 ＝ H-01の一次判定（F-MS-02）
 *   - チップ妥当額の分布（F-MS-03）
 *   - 働き手側の無償受諾の内訳（F-MS-04）
 */
function buildSummary() {
  var sh = sheet();
  var last = sh.getLastRow();
  if (last < 2) { SpreadsheetApp.getUi().alert('回答がまだありません。'); return; }

  var rows = sh.getRange(2, 1, last - 1, COLUMNS.length).getValues();
  var col = {};
  COLUMNS.forEach(function (c, i) { col[c] = i; });

  var out = [['項目', '区分', '件数', '割合']];
  out = out.concat(tally(rows, col['区分'], '回答区分', rows.length));

  var req = rows.filter(function (r) { return r[col['区分']] === '依頼側'; });
  var wrk = rows.filter(function (r) { return r[col['区分']] === '働き手側'; });

  out = out.concat(tally(req, col['料金の希望'],   '依頼側：料金の希望（H-01）', req.length));
  out = out.concat(tally(req, col['チップ妥当額'], '依頼側：チップ妥当額',       req.length));
  out = out.concat(tally(req, col['親の居住地'],   '依頼側：親の居住地',         req.length));
  out = out.concat(tally(wrk, col['無償案件の受諾'], '働き手側：無償受諾（H-01）', wrk.length));
  out = out.concat(tally(wrk, col['居住市町村'],   '働き手側：居住市町村',       wrk.length));

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sm = ss.getSheetByName('集計') || ss.insertSheet('集計');
  sm.clear();
  sm.getRange(1, 1, out.length, 4).setValues(out);
  sm.getRange(1, 1, 1, 4).setFontWeight('bold');
  sm.setFrozenRows(1);
}

function tally(rows, idx, label, denom) {
  var map = {};
  rows.forEach(function (r) {
    var k = r[idx];
    if (k === '' || k === null || k === undefined) return;
    map[k] = (map[k] || 0) + 1;
  });
  return Object.keys(map).sort(function (a, b) { return map[b] - map[a]; })
    .map(function (k) {
      return [label, k, map[k], denom ? Math.round(map[k] / denom * 1000) / 10 + '%' : ''];
    });
}

/**
 * 【撤退・検証終了時】個人情報を削除します（NF-LP-09）。
 * メールアドレス列とUserAgent列・参照元を空にし、回答の統計部分だけ残します。
 * 完全に消す場合は、スプレッドシートごとゴミ箱に入れて完全削除してください。
 */
function purgePersonalData() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.alert('メールアドレス等の個人情報を削除します。元に戻せません。よろしいですか。',
                     ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;

  var sh = sheet();
  var last = sh.getLastRow();
  if (last < 2) return;

  ['メールアドレス', 'UserAgent', '参照元'].forEach(function (name) {
    var c = COLUMNS.indexOf(name) + 1;
    if (c > 0) sh.getRange(2, c, last - 1, 1).clearContent();
  });
  ui.alert('削除しました。Apps Scriptの実行ログも必要に応じて確認してください。');
}
