#!/usr/bin/env python3
"""Doxygen 调用图 → web_log_viewer 调用栈文件（issue #57 静态分析通道）

Doxygen 配合 Graphviz（CALL_GRAPH=YES + HAVE_DOT=YES）会为每个函数生成
Graphviz dot 格式的调用图。本脚本解析这些 dot 文件中的调用边，
转换为时间线「调用栈」模式可加载的缩进树 + 箭头链文件。

优点：静态覆盖全部源码路径（包括未运行的代码），适合作为动态采样的补充。

用法:
  python3 tools/callstack/doxygen_callstack.py --dot html/callgraph_*.dot --output out.txt
  python3 tools/callstack/doxygen_callstack.py --dot html/ --entry main --output out.txt
  python3 tools/callstack/doxygen_callstack.py --dot a.dot b.dot --output out.txt

参数:
  --dot        dot 文件或包含 dot 文件的目录（可多次指定）
  --entry      入口函数名（可多次；默认自动找不被任何函数调用的根）
  --output     输出文件（默认 example/doxygen_callstack.txt）
  --max-depth  树最大深度（默认 10）
"""

import os
import re
import sys
from collections import defaultdict

EDGE_RE = re.compile(r'"([^"]+)"\s*->\s*"([^"]+)"')
# Doxygen 节点名形如 "main" / "foo()" / "ns::Class::method()" → 取首个标识符
NAME_RE = re.compile(r'([A-Za-z_]\w*)')


def clean_name(raw):
    """清洗 Doxygen 节点名：去引号、去模板签名、取函数名"""
    raw = raw.replace('\\n', '').replace('"', '').replace('&', '').replace('$', '')
    raw = re.sub(r'<.*?>', '', raw)          # 去模板参数
    raw = raw.replace('()', '')               # 去空参括号
    # 取 "Class::method" 或 "ns::method" 的最后一段作为函数名
    parts = raw.split('::')
    raw = parts[-1] if parts else raw
    raw = raw.split('(')[0].strip()
    m = NAME_RE.match(raw)
    return m.group(1) if m else raw


def collect_edges(paths):
    """解析 dot 文件 → 边集合 {(caller, callee)}"""
    edges = set()
    for p in paths:
        if os.path.isdir(p):
            dot_files = [os.path.join(p, f) for f in os.listdir(p) if f.endswith('.dot')]
        elif p.endswith('.dot'):
            dot_files = [p]
        else:
            continue
        for df in dot_files:
            try:
                with open(df, encoding='utf-8', errors='replace') as f:
                    text = f.read()
            except OSError:
                continue
            for m in EDGE_RE.finditer(text):
                caller = clean_name(m.group(1))
                callee = clean_name(m.group(2))
                if caller and callee and caller != callee:
                    edges.add((caller, callee))
    return edges


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    dot_paths = []
    entries = []
    output = 'example/doxygen_callstack.txt'
    max_depth = 10
    i = 1
    while i < len(sys.argv):
        a = sys.argv[i]
        if a == '--dot' and i + 1 < len(sys.argv):
            dot_paths.append(sys.argv[i + 1]); i += 2
        elif a == '--entry' and i + 1 < len(sys.argv):
            entries.append(sys.argv[i + 1]); i += 2
        elif a == '--output' and i + 1 < len(sys.argv):
            output = sys.argv[i + 1]; i += 2
        elif a == '--max-depth' and i + 1 < len(sys.argv):
            max_depth = int(sys.argv[i + 1]); i += 2
        else:
            i += 1
    if not dot_paths:
        print('错误: 需要 --dot <dot文件或目录>', file=sys.stderr)
        sys.exit(1)

    edges = collect_edges(dot_paths)
    if not edges:
        print('错误: 未从 dot 文件中解析到调用边', file=sys.stderr)
        sys.exit(1)

    all_nodes = set()
    calls = defaultdict(set)
    for caller, callee in edges:
        all_nodes.add(caller)
        all_nodes.add(callee)
        calls[caller].add(callee)

    # 入口：用户指定或不被任何函数调用
    if not entries:
        called_by = {c for callees in calls.values() for c in callees}
        entries = sorted(n for n in all_nodes if n not in called_by)
    if not entries:
        print('错误: 未找到入口函数，请用 --entry 指定', file=sys.stderr)
        sys.exit(1)

    # DFS 生成缩进树（含环防护）
    tree_lines = []
    visited_path = set()
    def dfs(name, depth):
        tree_lines.append('  ' * depth + name)
        if depth >= max_depth:
            return
        for callee in sorted(calls.get(name, set())):
            if callee in visited_path:
                continue
            visited_path.add(callee)
            dfs(callee, depth + 1)
            visited_path.discard(callee)
    for entry in entries:
        visited_path.add(entry)
        dfs(entry, 0)
        visited_path.discard(entry)

    arrow_lines = [f'{a} <- {b}' for a, b in sorted(edges)]

    lines = ['# Doxygen 调用图（由 tools/callstack/doxygen_callstack.py 转换）',
             f'# 函数数: {len(all_nodes)}  调用边数: {len(edges)}',
             '# 注意：静态分析覆盖全部源码路径，但函数指针/虚函数分派可能缺失',
             '#',
             '# ---- 调用树 ----']
    lines.extend(tree_lines)
    lines.append('')
    lines.append('# ---- 调用边（箭头链） ----')
    lines.extend(arrow_lines)
    with open(output, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print(f'已生成调用栈文件: {output}')
    print(f'  函数 {len(all_nodes)} 个, 调用边 {len(edges)} 条, 入口: {", ".join(entries)}')
    print(f'  在时间线「调用栈」模式中点击「📂 加载调用栈文件」即可加载')


if __name__ == '__main__':
    main()
