#!/usr/bin/env python3
"""perf 调用栈 → web_log_viewer 调用栈文件（issue #57 动态分析通道）

将 Linux perf 采集的真实调用栈转换为时间线「调用栈」模式可加载的文件：
  - 输入一：perf script 原始输出（--perf-script）
  - 输入二：已折叠的 folded 格式（--folded，形如 "a;b;c 42"，每行一个栈 + 次数）

输出文件含：
  - 调用树（缩进树，子节点按调用次数降序 → 热点在前）
  - 调用边（箭头链，A <- B 表示 A 调用 B）

优点：动态采集包含函数指针 / 异步回调 / 虚函数分派等运行时才确定的真实调用关系。

用法:
  python3 tools/callstack/perf_to_callstack.py --folded folded.txt --output out.txt
  python3 tools/callstack/perf_to_callstack.py --perf-script perf.script --output out.txt
  或通过 collect_perf_callstack.sh 一键采集
"""

import re
import sys
from collections import Counter, defaultdict

FRAME_RE = re.compile(r'^\s+\S+\s+([^\s()]+?)(?:\+0x[0-9a-fA-F]+)?\s+\(')
FRAME_SIMPLE_RE = re.compile(r'^\s+\S+\s+([^\s()]+)(?:\s+\()?')
EVENT_RE = re.compile(r'^\S+\s+\d+\s+\[\d+\]')
SKIP_SYMS = {'[unknown]', '[kernel.kallsyms]', '[vdso]', '[vsyscall]', '(__GI_)'}


def parse_perf_script(text):
    """解析 perf script 输出 → folded 计数 {路径字符串: 次数}"""
    stacks = Counter()
    stack = []
    for line in text.split('\n'):
        if not line.strip():
            if stack:
                stacks[';'.join(reversed(stack))] += 1
                stack = []
            continue
        if EVENT_RE.match(line) or (not line.startswith((' ', '\t')) and ':' in line and '#' not in line):
            if stack:
                stacks[';'.join(reversed(stack))] += 1
                stack = []
            continue
        m = FRAME_RE.match(line)
        if not m:
            m = FRAME_SIMPLE_RE.match(line)
        if not m:
            continue
        sym = m.group(1)
        if not sym or sym in SKIP_SYMS or sym.startswith('0x') or sym == 'pthread_barrier_wait':
            continue
        stack.append(sym)
    if stack:
        stacks[';'.join(reversed(stack))] += 1
    return stacks


def parse_folded(text):
    """解析 folded 格式 → 计数 {路径: 次数}"""
    stacks = Counter()
    for line in text.split('\n'):
        line = line.strip()
        if not line:
            continue
        parts = line.rsplit(None, 1)
        if len(parts) == 2 and parts[1].lstrip('-').isdigit():
            stacks[parts[0]] += int(parts[1])
        else:
            stacks[parts[0]] += 1
    return stacks


def build_tree(stacks):
    """由 folded 计数构建调用树。返回 (root 节点, 调用边计数)"""
    root = {'name': '（根）', 'children': {}, 'weight': 0}
    edges = Counter()
    for path, count in stacks.items():
        nodes = [n for n in path.split(';') if n]
        if not nodes:
            continue
        cur = root
        cur['weight'] += count
        for i, name in enumerate(nodes):
            if name not in cur['children']:
                cur['children'][name] = {'name': name, 'children': {}, 'weight': 0}
            cur = cur['children'][name]
            cur['weight'] += count
            if i > 0:
                edges[(nodes[i - 1], name)] += count
    return root, edges


def render_tree(node, depth=0, out=None):
    """缩进树渲染：子节点按 weight 降序"""
    if out is None:
        out = []
    if depth > 0:
        out.append('  ' * (depth - 1) + node['name'])
    for child in sorted(node['children'].values(), key=lambda c: -c['weight']):
        render_tree(child, depth + 1, out)
    return out


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src_type, src = None, None
    output = 'example/perf_callstack.txt'
    i = 1
    while i < len(sys.argv):
        a = sys.argv[i]
        if a in ('--folded', '--perf-script') and i + 1 < len(sys.argv):
            src_type, src = a[2:], sys.argv[i + 1]; i += 2
        elif a == '--output' and i + 1 < len(sys.argv):
            output = sys.argv[i + 1]; i += 2
        else:
            i += 1
    if not src_type or not src:
        print('错误: 需要 --folded <文件> 或 --perf-script <文件>', file=sys.stderr)
        sys.exit(1)

    with open(src, encoding='utf-8', errors='replace') as f:
        text = f.read()
    if src_type == 'folded':
        stacks = parse_folded(text)
    else:
        stacks = parse_perf_script(text)
    if not stacks:
        print('错误: 未解析到任何调用栈（确认输入为 perf script / folded 格式）', file=sys.stderr)
        sys.exit(1)

    root, edges = build_tree(stacks)
    total = sum(stacks.values())
    tree_lines = render_tree(root)
    arrow_lines = [f'{a} <- {b}' for (a, b) in sorted(edges.keys())]

    lines = ['# 程序运行调用栈（由 perf 动态采集，tools/callstack/perf_to_callstack.py 转换）',
             f'# 采样栈数: {len(stacks)}  总调用次数: {total}  调用边数: {len(edges)}',
             '# 注意：动态采集仅包含程序实际运行过的调用路径',
             '#',
             '# ---- 调用树（按热度降序） ----']
    lines.extend(tree_lines)
    lines.append('')
    lines.append('# ---- 调用边（箭头链） ----')
    lines.extend(arrow_lines)
    with open(output, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print(f'已生成调用栈文件: {output}')
    print(f'  采样栈 {len(stacks)} 个, 总调用 {total} 次, 调用边 {len(edges)} 条')
    print(f'  在时间线「调用栈」模式中点击「📂 加载调用栈文件」即可加载')


if __name__ == '__main__':
    main()
