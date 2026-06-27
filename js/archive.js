/* 压缩文件解析器 —— 统一接口，支持 ZIP / tar / tar.gz(tgz) / RAR */

const ArchiveHandler = {
  // ===== 公开接口 =====
  isArchive(name) {
    return /\.(zip|tar(\.gz)?|tgz|gz|rar)$/i.test(name);
  },

  async extract(file) {
    const ext = this._getExt(file.name);
    const ab = await this._readAsArrayBuffer(file);
    const u8 = new Uint8Array(ab);

    switch (ext) {
      case 'zip':
        return this._extractZip(u8, file.name);
      case 'tar':
        return this._normalizeFiles(this._parseTar(u8), file.name);
      case 'gz':
        return this._extractSingleGz(u8, file.name);
      case 'tgz':
      case 'tar.gz':
        return this._extractTarGz(u8, file.name);
      case 'rar':
        return this._extractRar(ab, file.name);
      default:
        throw new Error('不支持的压缩格式: ' + ext);
    }
  },

  async getPreviewText(file) {
    const files = await this.extract(file);
    const textFile = files.find(f => this._isTextFile(f.name));
    if (!textFile) throw new Error('压缩包中未找到文本文件');
    const decoder = new TextDecoder('UTF-8');
    const content = decoder.decode(textFile.data);
    return content.split(/\r?\n/).slice(0, 200).join('\n');
  },

  // ===== 文件读取 =====
  _readAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  },

  // ===== ZIP 提取（fflate 优先，JSZip 回退）=====
  async _extractZip(u8, fileName) {
    if (typeof fflate === 'undefined' && typeof JSZip === 'undefined') {
      throw new Error('未加载 ZIP 解析库（需加载 fflate 或 JSZip）');
    }

    const useFflate = typeof fflate !== 'undefined';
    let textFiles;

    if (useFflate) {
      const zipFiles = fflate.unzipSync(u8);
      const allNames = Object.keys(zipFiles);
      textFiles = [];
      for (const name of allNames) {
        textFiles.push({ name, data: zipFiles[name] });
      }
    } else {
      const zip = await JSZip.loadAsync(u8.buffer);
      const allNames = Object.keys(zip.files);
      textFiles = [];
      for (const name of allNames) {
        const entry = zip.files[name];
        if (entry.dir) continue;
        const content = await entry.async('uint8array');
        textFiles.push({ name, data: content });
      }
    }

    return this._normalizeFiles(textFiles, fileName, true);
  },

  // ===== 单文件 GZ（如 .log.gz）=====
  async _extractSingleGz(u8, fileName) {
    if (typeof fflate === 'undefined') {
      throw new Error('未加载 fflate 库，无法解压 .gz 文件');
    }
    const decompressed = fflate.gunzipSync(u8);
    const innerName = fileName.replace(/\.gz$/i, '');
    return this._normalizeFiles([{ name: innerName, data: decompressed }], fileName);
  },

  // ===== tar.gz / tgz 提取 =====
  async _extractTarGz(u8, fileName) {
    if (typeof fflate === 'undefined') {
      throw new Error('未加载 fflate 库，无法解压 .tar.gz 文件');
    }
    const decompressed = fflate.gunzipSync(u8);
    const files = this._parseTar(decompressed);
    return this._normalizeFiles(files, fileName, true);
  },

  // ===== RAR 提取（待浏览器兼容的 RAR 库接入）=====
  async _extractRar(ab, fileName) {
    throw new Error('RAR 格式暂不支持浏览器端解压，请使用 ZIP 或 tar.gz 格式');
  },

  // ===== tar 解析（纯 USTAR 格式支持）=====
  _parseTar(u8) {
    const files = [];
    let offset = 0;

    while (offset + 512 <= u8.length) {
      const header = u8.slice(offset, offset + 512);

      // 全0 block 表示结束
      if (header[0] === 0) break;

      const name = this._tarDecodeStr(header, 0, 100);
      const prefix = this._tarDecodeStr(header, 345, 155);
      const fullName = prefix ? prefix + '/' + name : name;
      const sizeStr = this._tarDecodeStr(header, 124, 12);
      const typeFlag = String.fromCharCode(header[156]);
      let size = 0;
      if (sizeStr) {
        size = parseInt(sizeStr.trim(), 8);
      }

      offset += 512;

      if (typeFlag === '0' || typeFlag === '' || typeFlag === '\0') {
        const data = u8.slice(offset, offset + size);
        files.push({ name: fullName, data });
      }

      offset += Math.ceil(size / 512) * 512;
    }

    return files;
  },

  _tarDecodeStr(u8, start, len) {
    let end = start + len;
    while (end > start && u8[end - 1] === 0) end--;
    if (end <= start) return '';
    const bytes = u8.slice(start, end);
    return new TextDecoder('UTF-8').decode(bytes);
  },

  // ===== 结果统一处理 =====
  _normalizeFiles(fileList, archiveName, isArchive = false) {
    return fileList
      .filter(f => !this._isHiddenDir(f.name))
      .map(f => ({
        name: f.name,
        displayName: f.name,
        archiveName: archiveName,
        data: f.data,
        size: f.data.length,
        isTextFile: this._isTextFile(f.name)
      }));
  },

  _isTextFile(name) {
    const lower = name.toLowerCase();
    return /\.(log|txt|json|xml|csv|out|err|trace|conf|cfg|properties|yml|yaml|md|sh|bat|ps1|py|js|ts|java|rb|php|pl)$/.test(lower) ||
           !/\.(exe|dll|so|dylib|class|jar|war|ear|png|jpg|jpeg|gif|bmp|ico|svg|webp|mp3|mp4|avi|mov|wmv|flv|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|gz|tar|bz2|7z|iso|dmg|ttf|otf|woff|woff2|eot)$/.test(lower);
  },

  _isHiddenDir(name) {
    const parts = name.split('/');
    return parts.some(p => p === '' || p === '.' || p === '..' || p.startsWith('__MACOSX'));
  },

  _getExt(name) {
    const lower = name.toLowerCase();
    if (/\.tar\.gz$/.test(lower)) return 'tar.gz';
    if (/\.tgz$/.test(lower)) return 'tgz';
    if (/\.tar$/.test(lower)) return 'tar';
    if (/\.zip$/.test(lower)) return 'zip';
    if (/\.gz$/.test(lower)) return 'gz';
    if (/\.rar$/.test(lower)) return 'rar';
    return '';
  }
};
