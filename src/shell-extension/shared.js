const DEFAULTS = {
  verifyUnsolved: false,
  cacheEnabled: true,
  forceRefresh: false,
  cacheTtlMs: 900000,
  navScope: 'visible',
};

function isObjectRecord(value) {
  return value != null && Object(value) === value;
}

function isCallable(value) {
  return Object.prototype.toString.call(value) === '[object Function]';
}

function getApi() {
  return globalThis.browser ?? globalThis.chrome ?? null;
}

function getStorageArea(api = getApi()) {
  return api?.storage?.sync ?? api?.storage?.local ?? null;
}

function cloneSettings(defaults, values) {
  return {
    ...(isObjectRecord(defaults) ? defaults : undefined),
    ...(isObjectRecord(values) ? values : undefined),
  };
}

function normalizeSettings(raw) {
  let ttl = Number(raw?.cacheTtlMs);

  if (!Number.isFinite(ttl)) {
    ttl = DEFAULTS.cacheTtlMs;
  }

  return {
    verifyUnsolved: raw?.verifyUnsolved === true,
    cacheEnabled: raw?.cacheEnabled !== false,
    forceRefresh: raw?.forceRefresh === true,
    cacheTtlMs: ttl,
    navScope: raw?.navScope === 'all' ? 'all' : 'visible',
  };
}

function hasThen(request) {
  return Boolean(request?.then);
}

function onResolved(callback, value) {
  callback(value);
}

function onRejected(callback, fallbackValue) {
  return function () {
    callback(fallbackValue);
  };
}

function normalizeRejectedError(error, fallbackMessage) {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) {
      return error;
    }
  }
  return new Error(fallbackMessage);
}

function normalizeRejectedMessage(error, fallbackMessage) {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) {
      return message;
    }
  }
  return fallbackMessage;
}

function storageGet(defaults, callback, api = getApi()) {
  const area = getStorageArea(api);

  if (area?.get === undefined) {
    callback(cloneSettings(defaults, null));
    return;
  }

  if (area.get.length <= 1) {
    const request = area.get(defaults);

    if (hasThen(request)) {
      request.then(
        function (items) {
          onResolved(callback, cloneSettings(defaults, items));
        },
        onRejected(callback, cloneSettings(defaults, null))
      );
      return;
    }
  }

  area.get(defaults, function (items) {
    if (api?.runtime?.lastError) {
      callback(cloneSettings(defaults, null));
      return;
    }

    callback(cloneSettings(defaults, items));
  });
}

function storageSet(values, callback, api = getApi()) {
  const area = getStorageArea(api);

  if (area?.set === undefined) {
    callback(null);
    return;
  }

  if (area.set.length <= 1) {
    const request = area.set(values);

    if (hasThen(request)) {
      request.then(
        function () {
          callback(null);
        },
        function (error) {
          callback(normalizeRejectedError(error, 'storage.set failed'));
        }
      );
      return;
    }
  }

  area.set(values, function () {
    if (api?.runtime?.lastError) {
      callback(new Error(api.runtime.lastError.message));
      return;
    }

    callback(null);
  });
}

function queryTabs(query, callback, api = getApi()) {
  if (api?.tabs?.query === undefined) {
    callback([]);
    return;
  }

  if (api.tabs.query.length <= 1) {
    const request = api.tabs.query(query);

    if (hasThen(request)) {
      request.then(
        function (tabs) {
          callback(Array.isArray(tabs) ? tabs : []);
        },
        onRejected(callback, [])
      );
      return;
    }
  }

  api.tabs.query(query, function (tabs) {
    if (api?.runtime?.lastError) {
      callback([]);
      return;
    }

    callback(Array.isArray(tabs) ? tabs : []);
  });
}

function sendTabMessage(tabId, message, callback, api = getApi()) {
  if (api?.tabs?.sendMessage === undefined) {
    callback({ ok: false, error: 'tabs.sendMessage unavailable' });
    return;
  }

  if (api.tabs.sendMessage.length <= 2) {
    const request = api.tabs.sendMessage(tabId, message);

    if (hasThen(request)) {
      request.then(
        function (response) {
          callback(response ?? { ok: false, error: 'no response' });
        },
        function (error) {
          callback({ ok: false, error: normalizeRejectedMessage(error, 'sendMessage failed') });
        }
      );
      return;
    }
  }

  api.tabs.sendMessage(tabId, message, function (response) {
    if (api?.runtime?.lastError) {
      callback({ ok: false, error: api.runtime.lastError.message });
      return;
    }

    callback(response ?? { ok: false, error: 'no response' });
  });
}

function openTab(url, api = getApi(), options = null) {
  const normalizedUrl = String(url || '').trim();
  const openerTabId = Number.isFinite(options?.openerTabId) ? options.openerTabId : null;

  if (!normalizedUrl) {
    return false;
  }

  if (api?.tabs?.create !== undefined) {
    const payload = { url: normalizedUrl };

    if (openerTabId !== null) {
      payload.openerTabId = openerTabId;
    }

    api.tabs.create(payload);
    return true;
  }

  if (isCallable(globalThis.open)) {
    globalThis.open(normalizedUrl, '_blank', 'noopener,noreferrer');
    return true;
  }

  return false;
}

module.exports = {
  DEFAULTS,
  isObjectRecord,
  isCallable,
  getApi,
  getStorageArea,
  cloneSettings,
  normalizeSettings,
  hasThen,
  onResolved,
  onRejected,
  normalizeRejectedError,
  normalizeRejectedMessage,
  storageGet,
  storageSet,
  queryTabs,
  sendTabMessage,
  openTab,
};
