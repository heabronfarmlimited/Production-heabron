// Native storage modules are not available under Jest, so both are replaced
// with in-memory fakes that keep the same synchronous API.
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    AFTER_FIRST_UNLOCK: 0,
    getItem: jest.fn((k) => (store.has(k) ? store.get(k) : null)),
    setItem: jest.fn((k, v) => {
      store.set(k, v);
    }),
    getItemAsync: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    setItemAsync: jest.fn(async (k, v) => {
      store.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k) => {
      store.delete(k);
    }),
  };
});

jest.mock('expo-sqlite/kv-store', () => {
  class SQLiteStorage {
    constructor() {
      this.store = new Map();
    }
    getItemSync(k) {
      return this.store.has(k) ? this.store.get(k) : null;
    }
    setItemSync(k, v) {
      this.store.set(k, typeof v === 'function' ? v(this.getItemSync(k)) : v);
    }
    removeItemSync(k) {
      return this.store.delete(k);
    }
    clearSync() {
      this.store.clear();
      return true;
    }
    getAllKeysSync() {
      return [...this.store.keys()];
    }
  }
  const Storage = new SQLiteStorage();
  return { SQLiteStorage, Storage, AsyncStorage: Storage, default: Storage };
});
