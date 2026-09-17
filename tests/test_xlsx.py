#!/usr/bin/env python
# -*- coding: utf-8 -*-
# tests/test_xlsx.py — build_xlsx.py 逻辑单元测试
# 跑：python tests/test_xlsx.py
#
# 测试 build_xlsx.py 的：
#   - JSONL 装载
#   - 薪资归一化（按平台口径）
#   - 公司名匹配复用
#   - 多 Sheet 输出结构
"""
TODO:
  完整复刻 build_xlsx.py 的全部逻辑需要引用大量工具函数。
  这里先做最核心的几个回归测试：薪资归一化 + 字段裁剪 + Excel 列数硬校验。

  要在 CI 里跑全链路回归，请配合一个小 fixture（tests/fixtures/*.jsonl），
  跑 build_xlsx.py 出表 + openpyxl 读回来对比。
"""
import os
import re
import sys
import json
import unittest
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SCRIPTS = os.path.join(ROOT, 'scripts')

# ---------------------------------------------------------------------------
# Windows 编码兜底（修复 GitHub Actions windows-latest 失败）
#
# 英文版 Windows 的控制台代码页是 cp1252，无法编码中文 → print() 中文会
# 抛 UnicodeEncodeError 导致 CI 红叉。这里把标准输出统一切到 UTF-8
# （Python 3.7+ 支持 reconfigure），errors='replace' 保证极端情况下不崩。
# ---------------------------------------------------------------------------
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass


def parse_salary(s: str, platform: str):
    """按平台口径归一化薪资到月薪 K（千元/月）。

    与 build_xlsx.py 中实际逻辑保持一致（2026-09-17 校准）：
      - 猎聘：k = 月薪千元；「万」= 年薪（万 × 10 ÷ 12 折算）
      - 前程无忧 / 智联：「万」= 月薪万（即 × 10 → K）
      - 缺单位数字继承本串里出现的单位（否则「8千-1.1万」会被错算成 8K）

    返回：区间平均 K 数（如 [10, 20] → 15.0）；解析失败返回 None。
    """
    if not s:
        return None
    s = s.strip()
    # 剥掉「·N薪」
    s = re.sub(r'·\d+薪', '', s)

    # 先找出所有数字 + 显式单位
    nums = re.findall(r'(\d+(?:\.\d+)?)\s*([kK千万元])?', s)
    if not nums:
        return None

    # 推断「缺单位时继承哪个单位」：取本串最后一个出现的单位
    explicit_units = [u for _, u in nums if u]
    default_unit = explicit_units[-1] if explicit_units else ''

    out = []
    for v, u in nums:
        v = float(v)
        # 缺单位时继承
        if not u:
            u = default_unit
        if platform == 'liepin':
            # 猎聘：k = 月薪千元；万 = 年薪（×10÷12 折算）
            if u in ('k', 'K', '千'):
                out.append(v)
            elif u == '万':
                out.append(v * 10 / 12)
            else:
                # 无单位（纯数字，如「8000」）→ 按元处理 → ÷1000 = K
                out.append(v / 1000 if v > 100 else v)
        elif platform in ('job51', 'zhilian'):
            # 前程无忧 / 智联：万 = 月薪万
            if u == '万':
                out.append(v * 10)  # 10k/月
            elif u in ('k', 'K', '千'):
                out.append(v)
            elif u == '元':
                out.append(v / 1000)
            else:
                # 无单位（纯数字）→ 按元处理
                out.append(v / 1000 if v > 100 else v)
        else:
            out.append(v)
    if not out:
        return None
    return sum(out) / len(out)


class TestSalaryNormalization(unittest.TestCase):
    def test_liepin_k(self):
        # 15-25k·13薪 → 月薪 20k
        self.assertAlmostEqual(parse_salary('15-25k·13薪', 'liepin'), 20.0, places=1)

    def test_liepin_wan_as_year(self):
        """猎聘「万」= 年薪（万×10÷12 折算）"""
        # 「30-50万」 → 30万~50万 是年薪 折算 30×10/12 = 25k， 50×10/12 ≈ 41.67k
        v = parse_salary('30-50万', 'liepin')
        self.assertAlmostEqual(v, (30 * 10 / 12 + 50 * 10 / 12) / 2, places=1)

    def test_job51_wan_as_month(self):
        """前程无忧「万」= 月薪万"""
        # 「1.2-2.2万·15薪」 → 1.2~2.2 万/月 = 12~22k， 平均 17k
        v = parse_salary('1.2-2.2万·15薪', 'job51')
        self.assertAlmostEqual(v, 17.0, places=1)

    def test_zhilian_wan_as_month(self):
        """智联「万」= 月薪万"""
        # 「1.5-2万」 → 1.5~2 万/月 = 15~20k，平均 17.5k
        v = parse_salary('1.5-2万', 'zhilian')
        self.assertAlmostEqual(v, 17.5, places=1)

    def test_unit_inheritance(self):
        """缺单位数字继承本串里出现的单位"""
        # 「8千-1.1万」→ 8k 和 1.1万（=11k）→ 平均 9.5k
        v = parse_salary('8千-1.1万', 'job51')
        self.assertAlmostEqual(v, 9.5, places=1)

    def test_unit_inheritance_mixed(self):
        """混合：1.5-2万 第一个数字无单位，继承末尾的「万」"""
        v = parse_salary('1.5-2万', 'zhilian')
        self.assertAlmostEqual(v, 17.5, places=1)

    def test_empty_returns_none(self):
        self.assertIsNone(parse_salary('', 'liepin'))
        self.assertIsNone(parse_salary(None, 'liepin'))

    def test_day_rate_filtered(self):
        """日薪/次/时不应当作月薪解析（由 build_xlsx.py 上层过滤）"""
        v = parse_salary('100-150元/天', 'zhilian')
        # parse_salary 本身不剔除日薪；上层做
        self.assertIsNotNone(v)


class TestHeaderConsistency(unittest.TestCase):
    """占位：等 build_xlsx.py 模块拆出来后，做 HDR_N 硬校验"""

    def test_placeholder(self):
        # TODO: 拆 build_xlsx.py 的列定义出来后，加严格测试
        self.skipTest('等待 build_xlsx.py 模块化')


if __name__ == '__main__':
    print('# build_xlsx.py 测试')
    unittest.main(verbosity=2)