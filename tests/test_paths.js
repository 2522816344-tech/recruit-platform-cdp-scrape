// tests/test_paths.js — paths.js 单元测试
// 跑：node tests/test_paths.js
//
// 测试不修改文件系统（除 createTempDir 外），保证可重复执行
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

// 必须在所有环境变量污染之前清空
delete process.env.SCRAPE_DIR;
delete process.env.SCRAPE_DATA;
delete process.env.SCRAPE_CONFIG;
delete process.env.SCRAPE_COMPANIES;

const ROOT = path.resolve(__dirname, '..');
const { DIR, DATA, CONFIG, COMPANIES, DEFAULTS, ensureData, loadConfig, loadCompanies, paceMs, out, progress } =
  require(path.join(ROOT, 'scripts', 'paths.js'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e.stack || e.message)); failed++; }
}
function section(name) { console.log('\n## ' + name); }

console.log('# paths.js 测试');
console.log('ROOT = ' + ROOT);
console.log('DIR  = ' + DIR);

section('默认路径');
test('DIR 不为空', () => assert(DIR && typeof DIR === 'string'));
test('DATA 是 DIR/data', () => assert(DATA === path.join(DIR, 'data')));
test('CONFIG = DIR/config.json', () => assert(CONFIG === path.join(DIR, 'config.json')));
test('COMPANIES = DIR/companies.json', () => assert(COMPANIES === path.join(DIR, 'companies.json')));

section('DEFAULTS');
test('DEFAULTS.title 默认值存在', () => assert(typeof DEFAULTS.title === 'string'));
test('DEFAULTS.platforms 至少 1 个平台', () => assert(Array.isArray(DEFAULTS.platforms) && DEFAULTS.platforms.length > 0));
test('DEFAULTS.pace 包含 liepin', () => assert(Array.isArray(DEFAULTS.pace.liepin) && DEFAULTS.pace.liepin.length === 2));
test('DEFAULTS.nJobsPerCompany 是数字', () => assert(typeof DEFAULTS.nJobsPerCompany === 'number'));

section('ensureData');
test('ensureData 返回字符串路径', () => {
  const d = ensureData();
  assert(typeof d === 'string' && d.length > 0);
});

section('out() 与 progress()');
test('out(name) 拼出 data/name', () => {
  assert(out('liepin_all.jsonl') === path.join(DATA, 'liepin_all.jsonl'));
});
test('progress(name) 拼出 data/.progress_name', () => {
  assert(progress('liepin') === path.join(DATA, '.progress_liepin'));
});

section('paceMs');
test('paceMs 返回数字', () => {
  assert(typeof paceMs(DEFAULTS, 'liepin') === 'number');
});
test('paceMs 在 [min, max] 区间内', () => {
  for (let i = 0; i < 100; i++) {
    const v = paceMs(DEFAULTS, 'liepin');
    assert(v >= DEFAULTS.pace.liepin[0] && v <= DEFAULTS.pace.liepin[1]);
  }
});
test('paceMs 未知平台走默认区间', () => {
  const v = paceMs(DEFAULTS, 'unknown-platform');
  assert(v >= 3000 && v <= 5000);
});

section('loadConfig 找不到 config.json 时返回默认');
test('loadConfig 缺省时返回 DEFAULTS 副本', () => {
  // 在不存在的目录跑
  const oldDir = process.env.SCRAPE_DIR;
  process.env.SCRAPE_DIR = path.join(os.tmpdir(), 'rps_test_' + Date.now());
  delete require.cache[require.resolve(path.join(ROOT, 'scripts', 'paths.js'))];
  const p2 = require(path.join(ROOT, 'scripts', 'paths.js'));
  const cfg = p2.loadConfig();
  assert.deepStrictEqual(cfg.platforms, DEFAULTS.platforms);
  assert.strictEqual(cfg.title, DEFAULTS.title);
  if (oldDir) process.env.SCRAPE_DIR = oldDir;
});

section('loadCompanies 两种格式');
test('纯字符串数组能转成 {n,kw}', () => {
  const tmp = path.join(os.tmpdir(), 'rp_co_' + Date.now() + '.json');
  fs.writeFileSync(tmp, JSON.stringify(['星辰传动', '云智动力']));
  const oldS = process.env.SCRAPE_COMPANIES;
  process.env.SCRAPE_COMPANIES = tmp;
  delete require.cache[require.resolve(path.join(ROOT, 'scripts', 'paths.js'))];
  const p3 = require(path.join(ROOT, 'scripts', 'paths.js'));
  const list = p3.loadCompanies();
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].n, '星辰传动');
  assert.strictEqual(list[0].kw, '星辰传动');
  fs.unlinkSync(tmp);
  if (oldS) process.env.SCRAPE_COMPANIES = oldS;
});

test('完整格式保留 kw/alt/must', () => {
  const tmp = path.join(os.tmpdir(), 'rp_co_' + Date.now() + '.json');
  fs.writeFileSync(tmp, JSON.stringify([
    { n: '海岳智能', kw: '海岳', alt: '海岳智能', must: '机电' }
  ]));
  const oldS = process.env.SCRAPE_COMPANIES;
  process.env.SCRAPE_COMPANIES = tmp;
  delete require.cache[require.resolve(path.join(ROOT, 'scripts', 'paths.js'))];
  const p4 = require(path.join(ROOT, 'scripts', 'paths.js'));
  const list = p4.loadCompanies();
  assert.strictEqual(list[0].kw, '海岳');
  assert.strictEqual(list[0].alt, '海岳智能');
  assert.strictEqual(list[0].must, '机电');
  fs.unlinkSync(tmp);
  if (oldS) process.env.SCRAPE_COMPANIES = oldS;
});

section('跨平台');
test('在 Linux / macOS / Windows 上都能加载', () => {
  // paths.js 已 require 过；只需不抛异常
  assert(typeof DEFAULTS.title === 'string');
});

console.log('\n---');
console.log('通过: ' + passed);
console.log('失败: ' + failed);
process.exit(failed ? 1 : 0);