// MMKV v4 is built on Nitro Modules, whose JS entry point requires the native
// binary at import time. MMKV itself swaps in an in-memory implementation when
// it detects Jest, but only after this import has already happened — so the
// native module is stubbed out here.
jest.mock('react-native-nitro-modules', () => ({
  NitroModules: {
    createHybridObject: jest.fn(),
    hasHybridObject: jest.fn(() => false),
    box: jest.fn((v) => v),
    unbox: jest.fn((v) => v),
  },
  getHostComponent: jest.fn(),
  callback: jest.fn((fn) => fn),
}));
