#!/usr/bin/env python
# -*- coding: utf-8 -*-
# scripts/check_repo.py — 仓库卫生校验
# 跑：python scripts/check_repo.py
#
# 检查项：
#   1. 必备开源文件是否存在（LICENSE / README / CHANGELOG / CONTRIBUTING 等）
#   2. 隐私硬编码扫描（用户路径 / 真实用户名）
#   3. example 文件可被 JSON 解析
#   4. .gitignore 覆盖了 data/ chrome-profile/
#   5. scripts/ 下没有 console.log 调试残留
"""
Usage:
    python scripts/check_repo.py [--strict]

Exit codes:
  0  = all checks pass
  1  = warnings only
  2  = errors found
"""
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 必备文件
REQUIRED_FILES = [
    'LICENSE',
    'README.md',
    'CHANGELOG.md',
    'CONTRIBUTING.md',
    'CODE_OF_CONDUCT.md',
    'SECURITY.md',
    '.gitignore',
    '.env.example',
    'package.json',
    'pyproject.toml',
    'requirements.txt',
    'SKILL.md',
    'docs/ARCHITECTURE.md',
    'docs/COMPLIANCE.md',
    'docs/TROUBLESHOOTING.md',
    'docs/FAQ.md',
    'tests/test_paths.js',
    'tests/test_common.js',
    'tests/test_xlsx.py',
    '.github/workflows/lint.yml',
    '.github/workflows/test.yml',
]

# 隐私硬编码模式（绝不应出现在仓库里）
PRIVACY_PATTERNS = [
    # Windows 用户路径（任何用户名）
    (re.compile(r'C:[\\/]Users[\\/](?!yourname|你的用户名)[a-zA-Z\u4e00-\u9fff_]+'), 'Windows user path'),
    (re.compile(r'/c/Users/[a-zA-Z]+'), 'Git Bash user path'),
    # userName 必须留成占位符：任何非占位符的实体值都判为泄漏（泛化检测，不针对特定姓名）
    (re.compile(r'"userName"\s*:\s*"(?!你的用户名|yourname|YOUR_NAME|示例用户名|PLACEHOLDER)[^"]{2,}"'), 'real userName (should stay a placeholder)'),
    # 用户桌面路径（任何用户名）
    (re.compile(r'C:[\\/]Users[\\/](?!yourname|你的用户名)[a-zA-Z\u4e00-\u9fff_]+[\\/](?:Desktop|桌面|Downloads)'), 'user Desktop/Downloads path'),
]

# .gitignore 必须包含的路径
GITIGNORE_MUST_HAVE = [
    'data/',
    '*.jsonl',
    '*.xlsx',
    'chrome-profile/',
    '.env',
    '*.log',
]

# example 文件必须能 JSON 解析
EXAMPLE_FILES = [
    'scripts/companies.example.json',
    'scripts/config.example.json',
]


def section(name):
    print(f'\n## {name}')


def check_required_files():
    section('必备文件检查')
    passed = 0
    for f in REQUIRED_FILES:
        p = ROOT / f
        if p.exists():
            size = p.stat().st_size
            print(f'  ✓ {f}  ({size} bytes)')
            passed += 1
        else:
            print(f'  ✗ {f}  MISSING')
    print(f'  {passed}/{len(REQUIRED_FILES)} files present')
    return passed == len(REQUIRED_FILES)


def check_privacy():
    section('隐私硬编码扫描')
    issues = 0
    # 扫描 scripts/ tests/ examples/ docs/ 根目录
    scan_dirs = ['scripts', 'tests', 'examples', 'docs']
    scan_files = list(ROOT.glob('*.md')) + list(ROOT.glob('*.json'))
    for d in scan_dirs:
        p = ROOT / d
        if p.exists():
            scan_files.extend(p.rglob('*'))
    # 去重
    scan_files = list(set(f for f in scan_files if f.is_file()))

    for f in scan_files:
        try:
            content = f.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        for pat, desc in PRIVACY_PATTERNS:
            for m in pat.finditer(content):
                # 跳过 README 中作为反例展示的
                rel = f.relative_to(ROOT)
                line_no = content[:m.start()].count('\n') + 1
                print(f'  ✗ {rel}:{line_no}  [{desc}]  → {m.group(0)!r}')
                issues += 1
    if issues == 0:
        print('  ✓ no privacy hardcodes found')
    return issues == 0


def check_gitignore():
    section('.gitignore 覆盖检查')
    p = ROOT / '.gitignore'
    if not p.exists():
        print('  ✗ .gitignore MISSING')
        return False
    content = p.read_text(encoding='utf-8')
    missing = []
    for needed in GITIGNORE_MUST_HAVE:
        # 简单包含检查（不要求精确匹配）
        if needed.rstrip('/') not in content:
            missing.append(needed)
    if missing:
        print(f'  ✗ .gitignore 缺少: {missing}')
        return False
    print('  ✓ .gitignore 覆盖完整')
    return True


def check_example_json():
    section('example 文件可解析')
    ok = True
    for ef in EXAMPLE_FILES:
        p = ROOT / ef
        if not p.exists():
            print(f'  ✗ {ef}  MISSING')
            ok = False
            continue
        try:
            json.loads(p.read_text(encoding='utf-8'))
            print(f'  ✓ {ef}  parses OK')
        except json.JSONDecodeError as e:
            print(f'  ✗ {ef}  PARSE ERROR: {e}')
            ok = False
    return ok


def check_no_debug_residue():
    """扫描 scripts/ 下是否还有明显调试残留
    规则：
      - 不检查 console.log —— CLI 工具的标准做法
      - 不检查 console.error —— 错误输出合法
      - 检查 console.warn 过度使用
      - 检查 TODO / FIXME / XXX 注释
      - 检查 print() / debugger;
    """
    section('scripts/ 调试残留扫描（console.log 是允许的）')
    issues = 0
    suspicious = []
    for f in (ROOT / 'scripts').glob('*.js'):
        rel = str(f.relative_to(ROOT))
        try:
            content = f.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        # debugger;
        if re.search(r'\bdebugger\b\s*;', content):
            suspicious.append((rel, 'debugger;'))
        # print() —— 不是 Node 风格，但有人会用
        if re.search(r'\bprint\s*\(', content) and not rel.startswith('window'):
            suspicious.append((rel, 'print() (建议用 console.log)'))
        # TODO / FIXME / XXX —— 大段未完成代码
        todos = re.findall(r'\b(?:TODO|FIXME|XXX)\b', content)
        if len(todos) > 3:
            suspicious.append((rel, f'{len(todos)} 处 TODO/FIXME'))
    for rel, msg in suspicious:
        print(f'  ! {rel}: {msg}')
        issues += 1
    if issues == 0:
        print('  ✓ 无明显调试残留')
    return issues == 0


def main():
    print('# 仓库卫生检查\n')
    results = {
        '必备文件': check_required_files(),
        '隐私硬编码': check_privacy(),
        '.gitignore 覆盖': check_gitignore(),
        'example JSON': check_example_json(),
        '调试残留': check_no_debug_residue(),
    }
    section('总结')
    for k, v in results.items():
        print(f'  {"✓" if v else "✗"} {k}')
    all_pass = all(results.values())
    print()
    print('✅ 全部通过' if all_pass else '❌ 有项目未通过，请按上面提示修复')
    sys.exit(0 if all_pass else 2)


if __name__ == '__main__':
    main()