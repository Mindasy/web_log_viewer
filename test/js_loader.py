"""js_loader.py — 从真实 JS 源码提取纯函数，翻译为 Python 后执行

不依赖 Node.js 或任何第三方库。
只适用于纯数学/逻辑函数（无 DOM、无闭包、无异步）。

工作方式：
  1. 用 regex 提取 JS 文件中的对象字面量
  2. 按字段类型（值/方法/箭头函数）翻译为 Python 语法
  3. exec() 执行翻译后的代码
  4. 返回命名空间，可直接调用
"""

import re
import os


def _translate_js_expr(expr):
    """将 JS 表达式翻译为 Python 表达式"""
    expr = expr.replace('Math.min(', 'min(')
    expr = expr.replace('Math.max(', 'max(')
    expr = expr.replace('Math.round(', 'round(')
    expr = expr.replace('Math.floor(', 'int(')
    expr = expr.replace('Math.ceil(', 'int(')
    expr = expr.replace('this.', '')
    expr = expr.replace('===', '==')
    expr = expr.replace('!==', '!=')
    return expr


def _translate_js_body(body):
    """将 JS 函数体翻译为 Python（处理控制流）"""
    body = _translate_js_expr(body)
    # 去掉 const/let/var
    body = re.sub(r'\b(const|let|var)\s+', '', body)
    
    # 展开花括号为缩进（使用 4 格缩进匹配 Python 规范）
    lines = []
    indent = 0
    buf = ''
    i = 0
    while i < len(body):
        ch = body[i]
        if ch == '{':
            lines.append(' ' * (indent * 4) + buf.strip())
            buf = ''
            indent += 1
        elif ch == '}':
            if buf.strip():
                lines.append(' ' * (indent * 4) + buf.strip())
            buf = ''
            indent = max(0, indent - 1)
            # 看看后面有没有 else
            rest = body[i+1:].lstrip()
            if rest.startswith('else'):
                lines.append(' ' * (indent * 4) + 'else:')
                i += 1 + len('else')
                while i < len(body) and body[i] in ' \t':
                    i += 1
                continue
        elif ch == ';':
            if buf.strip():
                lines.append(' ' * (indent * 4) + buf.strip())
            buf = ''
        else:
            buf += ch
        i += 1
    if buf.strip():
        lines.append(' ' * (indent * 4) + buf.strip())
    
    # if (cond) → if cond:
    result = []
    for line in lines:
        line = re.sub(r'^(\s*)if\s*\(', r'\1if ', line)
        line = re.sub(r'^(\s*)else if\s*\(', r'\1elif ', line)
        stripped = line.strip()
        # 去掉 if/elif/while/for 条件后多余的 )
        if stripped.startswith(('if ', 'elif ', 'while ', 'for ')) and stripped.endswith(')'):
            line = line.rstrip(')')
            stripped = line.strip()
        # 确保 if/elif/else/for/while 行末尾加 :
        if not stripped.endswith(':'):
            if stripped.startswith(('if ', 'elif ', 'else', 'for ', 'while ')):
                line += ':'
        result.append(line)

    return '\n'.join(result)


def extract_object(source, object_name='SM'):
    """从 JS 源码中提取 const OBJECT_NAME = { ... }; 并翻译为 Python 模块。"""
    # 定位对象开始
    pattern = re.compile(
        rf'(?:const|let|var)\s+{object_name}\s*=\s*\{{',
        re.MULTILINE
    )
    m = pattern.search(source)
    if not m:
        raise ValueError(f"在源码中未找到 {object_name} 对象")
    
    start = m.start()
    # 手动匹配花括号（处理嵌套）
    brace_depth = 0
    obj_end = None
    i = source.index('{', start)  # 第一个 {
    for j in range(i, len(source)):
        if source[j] == '{':
            brace_depth += 1
        elif source[j] == '}':
            brace_depth -= 1
            if brace_depth == 0:
                obj_end = j + 1
                break
    if obj_end is None:
        raise ValueError("花括号不匹配")
    
    block = source[i + 1:obj_end - 1]  # 去掉首尾 {}
    
    # 按顶层逗号分割（跳过字符串、括号、花括号）
    lines = []
    current = []
    depth = 0          # {} 深度
    paren_depth = 0    # () 深度
    in_str = None
    for ch in block:
        if ch in ('"', "'", '`') and (not current or current[-1] != '\\'):
            if in_str is None:
                in_str = ch
            elif in_str == ch:
                in_str = None
        if in_str is not None:
            current.append(ch)
            continue
        if ch == '(':
            paren_depth += 1
        elif ch == ')':
            paren_depth -= 1
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
        if ch == ',' and depth == 0 and paren_depth == 0:
            lines.append(''.join(current).strip())
            current = []
        else:
            current.append(ch)
    tail = ''.join(current).strip()
    if tail:
        lines.append(tail)
    
    # 翻译每一行为 Python
    py_lines = []
    for line in lines:
        if not line:
            continue
        # 跳过非顶层字段 (if, typeof 等)
        if line.startswith('if ') or line.startswith('typeof '):
            continue
        
        # 去掉开头的 // 注释行（JS 对象内的注释）
        line = re.sub(r'(?:^|\n)\s*//[^\n]*', '', line).strip()
        if not line:
            continue
        
        # 方法定义: key(params) { body }
        func_m = re.match(
            r'(\w+)\s*\(([^)]*)\)\s*\{(.*)\}',
            line, re.DOTALL
        )
        if func_m:
            name = func_m.group(1)
            params = func_m.group(2).strip()
            body = func_m.group(3).strip()

            # 翻译函数体（含控制流）
            body = _translate_js_body(body)
            # 去掉行尾分号
            body = re.sub(r';\s*$', '', body, flags=re.MULTILINE)

            py_lines.append(f'def {name}({params}):')
            for sub_line in body.split('\n'):
                if sub_line.strip():
                    # 基缩进 4 格（函数体内部） + 括号展开产生的缩进
                    py_lines.append('    ' + sub_line)
            continue
        
        # 箭头函数: key: (params) => expr
        arrow_m = re.match(
            r'(\w+)\s*:\s*\(([^)]*)\)\s*=>\s*(.+)',
            line
        )
        if arrow_m:
            name = arrow_m.group(1)
            params = arrow_m.group(2).strip()
            body = _translate_js_expr(arrow_m.group(3).strip())
            py_lines.append(f'def {name}({params}):')
            py_lines.append(f'    return {body}')
            continue
        
        # 值: key: value
        kv_m = re.match(r'(\w+)\s*:\s*(.+)', line)
        if kv_m:
            key = kv_m.group(1)
            val = _translate_js_expr(kv_m.group(2).strip().rstrip(','))
            py_lines.append(f'{key} = {val}')
    
    source_py = '\n'.join(py_lines)
    return source_py


def load_js_object(file_path, object_name='SM'):
    """
    从 JS 文件加载一个纯函数对象。
    
    返回 dict，键是函数名/常量名，值是对应的 Python 可调用对象或值。
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        source = f.read()
    
    py_source = extract_object(source, object_name)
    
    ns = {'min': min, 'max': max, 'round': round, 'int': int}
    exec(py_source, ns, ns)
    return ns
