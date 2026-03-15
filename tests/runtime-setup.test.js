const test = require('node:test');
const assert = require('node:assert/strict');

const {
  THEME_STORAGE_KEY,
  SETUP_PREFS_STORAGE_KEY,
  isBrowserRuntimeAvailable,
  loadThemePreference,
  persistThemePreference,
  styleWizardControl,
  applyThemePreference,
  loadSetupPreferences,
  saveSetupPreferences,
  parseIdRangeInput,
} = require('../src/core/runtime-setup');

function createStorage(initialState = {}) {
  const state = new Map(Object.entries(initialState));

  return {
    getItem(key) {
      return state.has(key) ? state.get(key) : null;
    },
    setItem(key, value) {
      state.set(key, String(value));
    },
    dump() {
      return Object.fromEntries(state.entries());
    },
  };
}

function createTargetElement() {
  return {
    dataset: {},
    setAttribute() {},
  };
}

test('runtime setup helpers detect browser globals without typeof checks', () => {
  assert.equal(isBrowserRuntimeAvailable({}), false);
  assert.equal(isBrowserRuntimeAvailable({ window: {}, document: undefined }), false);
  assert.equal(isBrowserRuntimeAvailable({ window: {}, document: {} }), true);
});

test('runtime setup helpers normalize persisted theme preferences', () => {
  const storage = createStorage({
    [THEME_STORAGE_KEY]: 'dark',
  });

  assert.equal(loadThemePreference(storage), 'dark');
  assert.equal(loadThemePreference(createStorage()), 'system');
  assert.equal(loadThemePreference(createStorage({ [THEME_STORAGE_KEY]: 'unexpected' })), 'system');
});

test('runtime setup helpers apply and persist theme changes', () => {
  const storage = createStorage();
  const targetElement = createTargetElement();
  const documentElement = createTargetElement();

  const darkTheme = applyThemePreference('dark', targetElement, {
    fallbackTarget: documentElement,
    localStorageApi: storage,
  });
  const systemTheme = applyThemePreference('system', targetElement, {
    fallbackTarget: documentElement,
    localStorageApi: storage,
  });

  assert.equal(darkTheme, 'dark');
  assert.equal(systemTheme, 'system');
  assert.equal(storage.dump()[THEME_STORAGE_KEY], 'system');
  assert.equal('theme' in targetElement.dataset, false);
  assert.equal('theme' in documentElement.dataset, false);

  persistThemePreference('light', storage);
  assert.equal(storage.dump()[THEME_STORAGE_KEY], 'light');
});

test('runtime setup helpers read and save setup preferences safely', () => {
  const storage = createStorage({
    [SETUP_PREFS_STORAGE_KEY]: JSON.stringify({ scanMode: 'id-range', startPage: 7 }),
  });

  assert.deepEqual(loadSetupPreferences(storage), {
    scanMode: 'id-range',
    startPage: 7,
  });

  saveSetupPreferences(
    {
      verifyUnsolved: true,
      speedPreset: 'safe',
    },
    storage
  );

  assert.deepEqual(JSON.parse(storage.dump()[SETUP_PREFS_STORAGE_KEY]), {
    verifyUnsolved: true,
    speedPreset: 'safe',
  });
  assert.deepEqual(
    loadSetupPreferences(createStorage({ [SETUP_PREFS_STORAGE_KEY]: 'not-json' })),
    {}
  );
});

test('runtime setup helpers parse id ranges and single end caps', () => {
  assert.deepEqual(parseIdRangeInput('15-42', ''), { startId: 15, endId: 42 });
  assert.deepEqual(parseIdRangeInput('', '99'), { startId: 1, endId: 99 });
  assert.equal(parseIdRangeInput('0-42', ''), null);
  assert.equal(parseIdRangeInput('bad-range', ''), null);
});

test('runtime setup helpers style controls and fall back through storage failures', () => {
  const control = { style: {} };
  const failingStorage = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  const fallbackTarget = {
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };

  assert.equal(styleWizardControl(control), control);
  assert.equal(control.style.width, '100%');
  assert.equal(loadThemePreference(failingStorage), 'system');
  assert.equal(
    applyThemePreference('light', null, {
      fallbackTarget,
      localStorageApi: failingStorage,
    }),
    'light'
  );
  assert.equal(fallbackTarget.attributes['data-theme'], 'light');
});
