#!/usr/bin/env python3
"""项目源码索引工具 — 扫描源码目录并生成「源码包」（zip + source-index.json）

用于 Web Log Viewer 的「日志与代码行关联」功能：
  - 按排除规则过滤掉依赖包、构建产物、配置文件等非源码文件（项目文件数可能上万）
  - 生成 source-index.json 索引 + 源码文件本体，打包为一个 zip
  - 前端导入该 zip 后，可点击日志中的 source 字段跳转到对应代码行

用法:
  python3 tools/source_link/index_source.py <项目路径>
  python3 tools/source_link/index_source.py <项目路径> -o source-bundle.zip
  python3 tools/source_link/index_source.py <项目路径> --exclude-dir third_party
  python3 tools/source_link/index_source.py <项目路径> --config .sourcelink.json

参数:
  项目路径                    要索引的源码目录
  -o, --output               输出 zip 路径（默认 source-bundle.zip）
  --exclude-dir              追加排除的目录名（可多次指定）
  --exclude-file             追加排除的文件名 glob（可多次指定）
  --config                   读取 JSON 配置文件（excludeDirs/excludeFiles/includeExts）
"""

import fnmatch
import json
import os
import sys
import zipfile
from datetime import datetime

# 默认排除目录（按路径片段匹配，任意层级命中即排除）
DEFAULT_EXCLUDE_DIRS = {
    '.git', '.svn', '.hg', '.idea', '.vscode', 'node_modules', 'bower_components',
    'vendor', '.venv', 'venv', 'site-packages', '__pycache__', '.gradle', '.m2',
    '.cargo', 'target', 'build', 'dist', 'out', 'bin', 'obj', 'CMakeFiles',
    '.next', '.nuxt', 'Pods', 'DerivedData', '.egg-info', '.pytest_cache',
    '.cache', 'logs', 'tmp', 'temp',
}

# 默认排除文件（basename glob 匹配）
DEFAULT_EXCLUDE_FILES = {
    '*.o', '*.obj', '*.a', '*.so', '*.dylib', '*.dll', '*.exe', '*.class',
    '*.pyc', '*.pyo', '*.jar', '*.war', '*.zip', '*.tar', '*.gz', '*.tgz',
    '*.png', '*.jpg', '*.jpeg', '*.gif', '*.ico', '*.svg', '*.woff', '*.woff2',
    '*.ttf', '*.eot', '*.map', '*.lock', 'package-lock.json', 'yarn.lock',
    'pnpm-lock.yaml', 'Cargo.lock', 'composer.lock', 'Gemfile.lock',
    '.DS_Store', 'Thumbs.db',
}

# 源码白名单扩展名（白名单之外一律排除）
SOURCE_EXTS = {
    '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.java', '.py',
    '.go', '.rs', '.js', '.jsx', '.ts', '.tsx', '.kt', '.kts', '.swift', '.cs',
    '.rb', '.php', '.scala', '.lua', '.pl', '.sh', '.sql',
}

LANG_MAP = {
    '.c': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp',
    '.h': 'cpp', '.hh': 'cpp', '.hpp': 'cpp', '.hxx': 'cpp',
    '.java': 'java', '.py': 'py', '.go': 'go', '.rs': 'rs',
    '.js': 'js', '.jsx': 'js', '.ts': 'ts', '.tsx': 'ts',
    '.kt': 'kotlin', '.kts': 'kotlin', '.swift': 'swift', '.cs': 'cs',
    '.rb': 'rb', '.php': 'php', '.scala': 'scala', '.lua': 'lua',
    '.pl': 'pl', '.sh': 'sh', '.sql': 'sql',
}

MAX_EXCLUDED_RECORDS = 500  # excluded 明细上限，防止超大项目索引膨胀


def load_config(config_path):
    cfg = {'excludeDirs': [], 'excludeFiles': [], 'includeExts': []}
    if not config_path:
        return cfg
    if not os.path.isfile(config_path):
        print(f'警告: 配置文件不存在: {config_path}', file=sys.stderr)
        return cfg
    try:
        with open(config_path, encoding='utf-8') as f:
            data = json.load(f)
        for key in ('excludeDirs', 'excludeFiles', 'includeExts'):
            val = data.get(key)
            if isinstance(val, list):
                cfg[key] = [str(x) for x in val]
        return cfg
    except (OSError, ValueError) as e:
        print(f'警告: 配置文件解析失败: {e}', file=sys.stderr)
        return cfg


def is_excluded_dir(rel_path, cfg):
    parts = rel_path.split('/')
    return any(p in DEFAULT_EXCLUDE_DIRS or p in cfg['excludeDirs'] for p in parts)


def is_excluded_file(name, cfg):
    patterns = list(DEFAULT_EXCLUDE_FILES) + list(cfg['excludeFiles'])
    return any(fnmatch.fnmatch(name.lower(), p.lower()) for p in patterns)


def is_source_ext(name, cfg):
    ext = os.path.splitext(name)[1].lower()
    return ext in SOURCE_EXTS or ext in cfg['includeExts']


def collect_files(root, cfg):
    """遍历项目，返回 (源码文件相对路径列表, 统计信息)"""
    files = []
    scanned = 0
    excluded_dirs = []
    excluded_files = []
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root)
        rel_dir = '' if rel_dir == '.' else rel_dir.replace(os.sep, '/')
        kept = []
        for d in dirnames:
            rel = d if not rel_dir else rel_dir + '/' + d
            if is_excluded_dir(rel, cfg):
                if len(excluded_dirs) < MAX_EXCLUDED_RECORDS:
                    excluded_dirs.append(rel)
            else:
                kept.append(d)
        dirnames[:] = kept
        for name in filenames:
            rel = name if not rel_dir else rel_dir + '/' + name
            scanned += 1
            if is_excluded_file(name, cfg) or not is_source_ext(name, cfg):
                if len(excluded_files) < MAX_EXCLUDED_RECORDS:
                    excluded_files.append(rel)
                continue
            files.append(rel)
    files.sort()
    return files, scanned, excluded_dirs, excluded_files


def read_source(path, rel):
    with open(path, encoding='utf-8', errors='replace') as f:
        content = f.read()
    lines = content.count('\n')
    if content and not content.endswith('\n'):
        lines += 1
    ext = os.path.splitext(rel)[1].lower()
    lang = LANG_MAP.get(ext, 'text')
    return content, lines, lang


def build_index(root, cfg):
    files, scanned, excluded_dirs, excluded_files = collect_files(root, cfg)
    entries = []
    total_size = 0
    for rel in files:
        abspath = os.path.join(root, rel.replace('/', os.sep))
        try:
            content, lines, lang = read_source(abspath, rel)
        except OSError:
            continue
        size = len(content.encode('utf-8', errors='replace'))
        total_size += size
        entries.append({
            'path': rel,
            'basename': os.path.basename(rel),
            'size': size,
            'lines': lines,
            'lang': lang,
        })
    index = {
        'schema': 1,
        'project': os.path.basename(os.path.abspath(root)) or root,
        'generatedAt': datetime.now().astimezone().isoformat(timespec='seconds'),
        'stats': {
            'scanned': scanned,
            'indexed': len(entries),
            'totalBytes': total_size,
            'excludedDirs': len(excluded_dirs),
            'excludedFiles': len(excluded_files),
        },
        'excluded': (
            [{'type': 'dir', 'path': p} for p in excluded_dirs] +
            [{'type': 'file', 'path': p} for p in excluded_files]
        ),
        'files': entries,
    }
    return index, files


def write_bundle(index, files, root, output):
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('source-index.json', json.dumps(index, ensure_ascii=False, indent=2))
        for rel in files:
            abspath = os.path.join(root, rel.replace('/', os.sep))
            try:
                with open(abspath, encoding='utf-8', errors='replace') as f:
                    content = f.read()
            except OSError:
                continue
            zf.writestr(rel, content)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    src_dir = sys.argv[1]
    output = 'source-bundle.zip'
    cfg = load_config(None)

    i = 2
    while i < len(sys.argv):
        a = sys.argv[i]
        if a in ('-o', '--output') and i + 1 < len(sys.argv):
            output = sys.argv[i + 1]
            i += 2
        elif a == '--exclude-dir' and i + 1 < len(sys.argv):
            cfg['excludeDirs'].append(sys.argv[i + 1])
            i += 2
        elif a == '--exclude-file' and i + 1 < len(sys.argv):
            cfg['excludeFiles'].append(sys.argv[i + 1])
            i += 2
        elif a == '--config' and i + 1 < len(sys.argv):
            cfg = load_config(sys.argv[i + 1])
            i += 2
        else:
            i += 1

    if not os.path.isdir(src_dir):
        print(f'错误: 项目目录不存在: {src_dir}', file=sys.stderr)
        sys.exit(1)

    index, files = build_index(src_dir, cfg)
    if not files:
        print('错误: 未找到可索引的源码文件（检查排除规则或扩展名白名单）', file=sys.stderr)
        sys.exit(1)

    write_bundle(index, files, src_dir, output)

    st = index['stats']
    print(f'已生成源码包: {output}')
    print(f'  项目: {index["project"]}')
    print(f'  扫描: {st["scanned"]} 个文件  索引: {st["indexed"]} 个源码文件  '
          f'({st["totalBytes"] / 1024:.1f} KB)')
    print(f'  排除: {st["excludedDirs"]} 个目录 / {st["excludedFiles"]} 个文件')
    print('  在 Web Log Viewer 中点击「📄 源码 → 📦 导入源码包」即可加载')


if __name__ == '__main__':
    main()
