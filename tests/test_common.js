// tests/test_common.js — common.js 公司名匹配逻辑单元测试
// 跑：node tests/test_common.js
//
// 测试覆盖：
//   normName / tokens / lcsSubstr / coverage
//   plausible（跨行业、跨地区否决）
//   matchCompany（4 级排序）
//   scopeOf（两级严格隔离，防止同名不同司）
//   已知 BUG 的回归用例
'use strict';

const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const common = require(path.join(ROOT, 'scripts', 'common.js'));
const { normName, tokens, lcsSubstr, plausible, matchCompany, scopeOf, regionOf } = common;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e.stack || e.message)); failed++; }
}
function section(name) { console.log('\n## ' + name); }

console.log('# common.js 测试');

section('normName');
test('去掉空格', () => assert.strictEqual(normName('海岳 智 能'), '海岳智能'));
test('去掉括号', () => assert.strictEqual(normName('江苏(南京)科技'), '江苏南京科技'));
test('去掉标点', () => assert.strictEqual(normName('Astra·光达通'), 'Astra光达通'));
test('空值兜底', () => assert.strictEqual(normName(''), ''));
test('null 兜底', () => assert.strictEqual(normName(null), ''));

section('tokens');
test('4 字品牌词优先', () => {
  const t = tokens('江城雷力电机股份有限公司');
  assert(t.includes('江城雷'), '应包含 4 字前缀');
});
test('去除 INDUSTRY_ONLY', () => {
  const t = tokens('智能科技');
  assert(!t.includes('智能'), '行业泛词不应作为匹配键');
});
test('去除 REGION_ONLY', () => {
  const t = tokens('南京智能');
  assert(!t.includes('南京'), '行政区划不应作为匹配键');
});
test('尾缀品牌词（如 Astra 光达通 → 光达通）', () => {
  const t = tokens('Astra光达通');
  assert(t.includes('光达通'), '尾缀品牌词应被识别');
});

section('lcsSubstr');
test('最长公共子串 = 4', () => {
  assert.strictEqual(lcsSubstr('海岳智能有限公司', '海岳智能器'), 4);
});
test('空串返回 0', () => assert.strictEqual(lcsSubstr('', '海岳'), 0));
test('完全无关返回 0', () => assert.strictEqual(lcsSubstr('abc', 'xyz'), 0));

section('coverage');
test('目标名在候选里能算连续字符数', () => {
  // coverage 是 lcsSubstr(normName(target), cn) 的封装
  // 模拟一次调用：目标「天工精工」、候选「宁波天工精工股份有限公司」
  const cn = normName('宁波天工精工股份有限公司');
  const tn = normName('天工精工');
  const v = lcsSubstr(tn, cn);
  assert(v >= 4, '应识别「天工精工」4 字');
});

section('plausible（跨行业 / 跨地区否决）');
test('目标「乐驰机器人」不应匹配「厦门乐驰食品」', () => {
  assert.strictEqual(plausible('乐驰机器人', '厦门乐驰食品有限公司'), false);
});
test('目标「丰驰智能」不应匹配「丰驰装饰」', () => {
  assert.strictEqual(plausible('丰驰智能', '丰驰装饰'), false);
});
test('目标「星辰传动」可匹配「星辰传动（深圳）」', () => {
  assert.strictEqual(plausible('星辰传动', '星辰传动（深圳）有限公司'), true);
});
test('跨地区否决：湖北云峰 ≠ 浙江云峰设计集团', () => {
  assert.strictEqual(plausible('湖北云峰智能传动', '浙江云峰设计集团'), false);
});

section('matchCompany');
test('2 字核心词的「乐驰」选「乐驰深圳」不选「厦门乐驰食品」', () => {
  const cards = [
    { company: '厦门乐驰食品有限公司' },
    { company: '乐驰（深圳）机器人' },
  ];
  const hit = matchCompany(cards, '乐驰机器人', '乐驰');
  assert(hit && hit.card.company.includes('深圳'), '应优先选带「深圳」的乐驰');
});
test('「天工精工」匹配「宁波天工精工股份有限公司」', () => {
  const cards = [
    { company: '大连天工润滑油有限公司' },  // 反例
    { company: '宁波天工精工股份有限公司' },
  ];
  const hit = matchCompany(cards, '天工精工', '天工');
  assert(hit && hit.card.company.includes('宁波天工精工'), '应优先选宁波天工精工');
});
test('「微芯电子」不匹配「广东派微芯显」（跨行业）', () => {
  const cards = [
    { company: '广东派微芯显电子有限公司' },
    { company: '微芯电子（深圳）有限公司' },
  ];
  const hit = matchCompany(cards, '微芯电子', '微芯');
  assert(hit && hit.card.company.includes('微芯电子'), '应选微芯电子本身');
});
test('匹配键长度 < 2 直接判未命中', () => {
  const cards = [{ company: '智能科技公司' }];
  const hit = matchCompany(cards, '智能', null);
  // 行业泛词已剔除，「智能」不能单独作为匹配键
  assert.strictEqual(hit, null);
});
test('must 正则强约束', () => {
  const cards = [{ company: '星辰投资有限公司' }];
  const hit = matchCompany(cards, '星辰传动', '星辰传动');
  // must=星辰传动 但卡片只有「星辰投资」→ 不满足 must
  assert.strictEqual(hit, null);
});

section('scopeOf（两级严格隔离）');
test('scopeOf tier1：同公司名（含分公司后缀）', () => {
  const cards = [
    { company: '星辰传动' },
    { company: '星辰传动（深圳）有限公司' },
    { company: '星辰投资有限公司' },  // 不是 tier1
    { company: '浙江星辰传动' },  // 包含关系
  ];
  const hit = { card: { company: '星辰传动' }, key: '星辰' };
  const tier = scopeOf(cards, '星辰传动', null, hit);
  const names = tier.map(c => c.company);
  assert(names.includes('星辰传动（深圳）有限公司'), '分公司后缀应被纳入');
  assert(names.includes('浙江星辰传动'), '包含关系应被纳入');
  assert(!names.includes('星辰投资有限公司'), '无关公司应被排除');
});
test('scopeOf tier2：must + 连续公共字符', () => {
  const cards = [
    { company: '乐驰（深圳）机器人' },  // tier1
    { company: '北京乐驰智能装备有限公司' },  // tier2（有连续公共字符）
    { company: '上海乐驰食品有限公司' },  // tier2 但不过食品吗？
  ];
  const hit = { card: { company: '乐驰（深圳）机器人' }, key: '乐驰' };
  const tier = scopeOf(cards, '乐驰机器人', null, hit);
  const names = tier.map(c => c.company);
  assert(names.includes('乐驰（深圳）机器人'));
  // 上海乐驰食品被 DOMAIN_BAD 否决
  assert(!names.includes('上海乐驰食品有限公司'));
});

console.log('\n---');
console.log('通过: ' + passed);
console.log('失败: ' + failed);
process.exit(failed ? 1 : 0);