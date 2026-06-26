// db.js - IndexedDB Pattern 存储 (前端数据库)

const PatternDB = {
  DB_NAME: 'WebLogViewerDB',
  DB_VERSION: 1,
  STORE_NAME: 'patterns',

  async open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  },

  async getAll() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        // 按创建时间倒序
        const list = request.result || [];
        list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        resolve(list);
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  },

  async add(pattern) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const record = {
        ...pattern,
        createdAt: pattern.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const request = store.add(record);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  },

  async update(id, updates) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) { reject(new Error('Pattern not found')); return; }
        Object.assign(record, updates, { updatedAt: new Date().toISOString() });
        const putReq = store.put(record);
        putReq.onsuccess = () => resolve(putReq.result);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
      tx.oncomplete = () => db.close();
    });
  },

  async remove(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  },

  async getByName(name) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const index = store.index('name');
      const request = index.get(name);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  },

  async exportAll() {
    const patterns = await this.getAll();
    const data = patterns.map(p => ({
      name: p.name,
      description: p.description || '',
      regex: p.regex || '',
      dateFormat: p.dateFormat || '',
      sampleLine: p.sampleLine || '',
      createdAt: p.createdAt
    }));
    return JSON.stringify(data, null, 2);
  },

  async importFromJSON(jsonStr) {
    let data;
    try {
      data = JSON.parse(jsonStr);
      if (!Array.isArray(data)) data = [data];
    } catch {
      throw new Error('无效的 JSON 格式');
    }
    let imported = 0;
    for (const item of data) {
      if (!item.name || !item.regex) continue;
      const existing = await this.getByName(item.name);
      if (existing) {
        await this.update(existing.id, {
          regex: item.regex,
          dateFormat: item.dateFormat || '',
          description: item.description || '',
          sampleLine: item.sampleLine || ''
        });
      } else {
        await this.add({
          name: item.name,
          description: item.description || '',
          regex: item.regex,
          dateFormat: item.dateFormat || '',
          sampleLine: item.sampleLine || ''
        });
      }
      imported++;
    }
    return imported;
  }
};
