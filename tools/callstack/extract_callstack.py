#!/usr/bin/env python3
"""项目函数调用栈提取工具（issue #57）

扫描 C/C++/Java 项目源码，提取函数定义与函数之间的调用关系，
生成函数调用栈文件（供时间线「调用栈」模式加载）。

生成的文件包含两种格式（callstack.js 均支持）：
  - 缩进树：每级缩进代表一层调用（entry 函数 → 被调函数）
  - 箭头链：A <- B <- C（C 调用 B，B 调用 A）

用法:
  python3 tools/callstack/extract_callstack.py <源码目录>
  python3 tools/callstack/extract_callstack.py <源码目录> --output out.stack
  python3 tools/callstack/extract_callstack.py <源码目录> --lang cpp
  python3 tools/callstack/extract_callstack.py <源码目录> --entry main --entry run

参数:
  --lang       cpp | java | auto（默认 auto，按扩展名自动识别）
  --entry      入口函数名（可多次指定；默认自动选取入口/根函数）
  --output     输出文件（默认 example/callstack_demo.txt）
  --max-depth  树的最大深度（默认 8，防止递归导致无限展开）
  --no-arrow   不输出箭头链部分（仅缩进树）
"""

import os
import re
import sys
from collections import defaultdict

SUFFIX_CPP = {'.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx'}
SUFFIX_JAVA = {'.java'}

# 函数定义模式：返回类型 + 函数名 + (参数) + { 
# 优先匹配非以 ; 结尾的（排除函数声明）
DEF_RE = {
    'cpp': re.compile(
        r'(?:[\w:<>,\*\&\[\]\s]+?)\s+([A-Za-z_]\w*)\s*\(([^;{]*?)\)\s*(?:const\s*)?(?:noexcept\s*)?(?:override\s*)?\{'
    ),
    'java': re.compile(
        r'(?:public|protected|private|static|final|synchronized|native|abstract|default)\s+(?:[\w<>\[\],\s]+?)\s+([A-Za-z_]\w*)\s*\(([^{;]*?)\)\s*(?:throws\s+[\w,.\s]+)?\{'
    ),
}

# 函数调用模式：函数名( （排除定义本身与常见关键字）
CALL_RE = re.compile(r'(?<![A-Za-z0-9_$])([A-Za-z_]\w*)\s*\(')

# 异步/回调 API：参数列表中的已知函数名将被识别为「回调边」。
# 例：std::thread t(worker, 10) → launchAsync -> worker
#     std::async(..., worker, ...) → launchAsync -> worker
#     pthread_create(&t, NULL, handler, arg) → startThread -> handler
#     std::bind(worker, ...) / std::function f = worker → 回调/引用
ASYNC_API_RE = re.compile(
    r'\b(?:std::thread|std::async|std::bind|pthread_create|pthread_create_attr)\s*\(([^;()]*)\)')
STDFUNC_RE = re.compile(
    r'\bstd::function\s*<\s*[^>]*>\s*(\w+)\s*=\s*([A-Za-z_]\w*)')

# 回调注册类 API：参数列表中的已知函数名被识别为「注册回调边」
# 例：registerHandler(handlerImpl) / setCallback(onEvent) / addListener(listen)
CALLBACK_API_RE = re.compile(
    r'\b(?:register\w*|set\w*Callback|set\w*Handler|add\w*Listener|add\w*Observer|on\w*Event|attach\w*|install\w*)\s*\(([^;()]*)\)')

# 函数指针赋值别名：HandlerFn h = handlerImpl;  或  h = handlerImpl;
FNPTR_ALIAS_RE = re.compile(r'(?:^|[\s{};])([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*;')

SKIP_CALLS = {
    'if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof', 'new', 'delete',
    'printf', 'fprintf', 'sprintf', 'snprintf', 'strlen', 'strcpy', 'memcpy',
    'assert', 'throw', 'try', 'malloc', 'free', 'realloc', 'calloc', 'sizeof',
    'print', 'println', 'synchronized', 'instanceof', 'enum', 'class', 'extends',
    'implements', 'super', 'this', 'join', 'detach', 'wait',
}

def detect_lang(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in SUFFIX_JAVA:
        return 'java'
    if ext in SUFFIX_CPP:
        return 'cpp'
    return None

def strip_comments(text):
    """去除 // 与 /* */ 注释（不处理字符串字面量，足够用于调用提取）"""
    text = re.sub(r'/\*.*?\*/', ' ', text, flags=re.S)
    text = re.sub(r'//[^\n]*', ' ', text)
    return text

def extract_body(text, brace_pos):
    """从 '{' 位置提取配对的函数体文本（大括号计数）"""
    depth = 0
    i = brace_pos
    n = len(text)
    while i < n:
        c = text[i]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return text[brace_pos:i + 1]
        i += 1
    return text[brace_pos:]

def scan_file(path, lang):
    """扫描单文件：返回 (函数定义 {name: body_text}, 文件内调用 {caller: set(callee)})"""
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            text = f.read()
    except OSError:
        return {}, {}
    text = strip_comments(text)
    regex = DEF_RE[lang]
    defs = {}
    for m in regex.finditer(text):
        name = m.group(1)
        if name in defs:
            continue
        # 函数体从 '{' 开始（用大括号配对提取），排除只有声明的匹配
        open_brace = text.find('{', m.start(), m.end())
        if open_brace < 0:
            continue
        body = extract_body(text, open_brace)
        defs[name] = body
    # 定义内调用关系
    calls = {}
    for name, body in defs.items():
        callees = set()
        for cm in CALL_RE.finditer(body):
            callee = cm.group(1)
            if callee == name:
                continue
            if callee in SKIP_CALLS:
                continue
            # 只统计本项目文件中出现过的函数名
            callees.add(callee)
        # 异步/回调 API：参数列表中的函数名 → 回调边
        for am in ASYNC_API_RE.finditer(body):
            for arg in re.findall(r'[A-Za-z_]\w*', am.group(1)):
                if arg in SKIP_CALLS:
                    continue
                callees.add(arg)
        # std::function f = worker → 引用边
        for sm in STDFUNC_RE.finditer(body):
            callees.add(sm.group(2))
        # 回调注册 API：参数列表中的函数名 → 注册边
        for cm in CALLBACK_API_RE.finditer(body):
            for arg in re.findall(r'[A-Za-z_]\w*', cm.group(1)):
                if arg in SKIP_CALLS:
                    continue
                callees.add(arg)
        if callees:
            calls[name] = callees

    # 函数指针别名：在文件内建立「别名 → 目标函数」映射，供跨函数解析间接调用。
    # 例如 HandlerFn h = handlerImpl; 后 h(...) 视为调用 handlerImpl。
    aliases = {}
    for am in FNPTR_ALIAS_RE.finditer(text):
        lhs, rhs = am.group(1), am.group(2)
        if rhs in defs:
            aliases[lhs] = rhs
    # 将别名调用展开：在任一函数体内如果出现 alias(...)，视为调用目标函数
    if aliases:
        for name, body in defs.items():
            for alias, target in aliases.items():
                if re.search(r'(?<![A-Za-z0-9_$])' + re.escape(alias) + r'\s*\(', body):
                    calls.setdefault(name, set()).add(target)
    return defs, calls

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    src_dir = sys.argv[1]
    output = 'example/callstack_demo.txt'
    lang = 'auto'
    entries = []
    max_depth = 8
    no_arrow = False
    i = 2
    while i < len(sys.argv):
        a = sys.argv[i]
        if a == '--output' and i + 1 < len(sys.argv):
            output = sys.argv[i + 1]; i += 2
        elif a == '--lang' and i + 1 < len(sys.argv):
            lang = sys.argv[i + 1]; i += 2
        elif a == '--entry' and i + 1 < len(sys.argv):
            entries.append(sys.argv[i + 1]); i += 2
        elif a == '--max-depth' and i + 1 < len(sys.argv):
            max_depth = int(sys.argv[i + 1]); i += 2
        elif a == '--no-arrow':
            no_arrow = True; i += 1
        else:
            i += 1

    if not os.path.isdir(src_dir):
        print(f'错误: 目录不存在: {src_dir}', file=sys.stderr)
        sys.exit(1)

    # 收集所有源文件
    files = []
    for root, dirs, names in os.walk(src_dir):
        dirs[:] = [d for d in dirs if d not in ('.git', '.svn', 'node_modules', 'build', 'dist', 'target')]
        for n in names:
            p = os.path.join(root, n)
            if lang == 'cpp' and os.path.splitext(n)[1].lower() in SUFFIX_CPP:
                files.append(p)
            elif lang == 'java' and os.path.splitext(n)[1].lower() in SUFFIX_JAVA:
                files.append(p)
            elif lang == 'auto' and detect_lang(p):
                files.append(p)
    if not files:
        print(f'错误: 未找到可识别的源文件（--lang 可指定 cpp/java）', file=sys.stderr)
        sys.exit(1)

    # 扫描全部文件 → 汇总定义与调用
    all_defs = set()
    calls = defaultdict(set)
    for p in files:
        l = lang if lang != 'auto' else detect_lang(p)
        if not l:
            continue
        defs, c = scan_file(p, l)
        all_defs.update(defs.keys())
        for caller, callees in c.items():
            calls[caller].update(callees)
    # 只保留本项目内定义的函数之间的调用
    for caller in list(calls.keys()):
        calls[caller] = {c for c in calls[caller] if c in all_defs}
        if not calls[caller]:
            del calls[caller]

    # 入口函数：用户指定，或不被任何函数调用的根函数（如 main）
    if not entries:
        called_by = set()
        for callees in calls.values():
            called_by.update(callees)
        entries = sorted(n for n in all_defs if n not in called_by)
    if not entries:
        print('错误: 未找到入口函数（所有函数均被调用，请用 --entry 指定）', file=sys.stderr)
        sys.exit(1)

    # 生成缩进树（DFS，带深度限制与环防护）
    tree_lines = []
    visited_path = set()
    def dfs(name, depth, prefix=''):
        indent = '  ' * depth
        tree_lines.append(f'{indent}{name}')
        if depth >= max_depth:
            return
        callees = sorted(calls.get(name, set()))
        for callee in callees:
            if callee in visited_path:
                continue
            visited_path.add(callee)
            dfs(callee, depth + 1)
            visited_path.discard(callee)
    for entry in entries:
        visited_path.add(entry)
        dfs(entry, 0)
        visited_path.discard(entry)

    # 生成箭头链（每条调用边一行）
    arrow_lines = []
    if not no_arrow:
        for caller in sorted(calls.keys()):
            for callee in sorted(calls[caller]):
                arrow_lines.append(f'{caller} <- {callee}')

    # 写出文件
    lines = ['# 项目函数调用栈（由 tools/callstack/extract_callstack.py 生成）',
             f'# 源码目录: {os.path.abspath(src_dir)}',
             f'# 函数数: {len(all_defs)}  调用边数: {sum(len(v) for v in calls.values())}',
             '#',
             '# ---- 调用树 ----']
    lines.extend(tree_lines)
    if arrow_lines:
        lines.append('')
        lines.append('# ---- 调用边（箭头链） ----')
        lines.extend(arrow_lines)
    with open(output, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print(f'已生成调用栈文件: {output}')
    print(f'  源文件: {len(files)} 个  函数: {len(all_defs)} 个  调用边: {sum(len(v) for v in calls.values())} 条')
    print(f'  入口函数: {", ".join(entries)}')
    print(f'  在时间线「调用栈」模式中点击「📂 加载调用栈文件」即可加载')

if __name__ == '__main__':
    main()
