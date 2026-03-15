const { normalizeSpace } = require('./text-utils');

function readFiniteNumber(value, fallback) {
  if (Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function normalizeCacheKind(value) {
  return normalizeSpace(value || 'unknown') || 'unknown';
}

function normalizeCacheKey(value) {
  return normalizeSpace(value == null ? '' : String(value)) || '?';
}

function normalizeNamespace(value) {
  return normalizeSpace(value || '') || null;
}

function createParsedCacheEntry(input) {
  const source = input && typeof input === 'object' ? input : {};
  const cachedAt = readFiniteNumber(source.now, Date.now());
  const ttl = Math.max(0, readFiniteNumber(source.ttlMs, 0));

  return {
    schemaVersion: readFiniteNumber(source.schemaVersion, 1),
    cacheKind: normalizeCacheKind(source.cacheKind),
    cacheKey: normalizeCacheKey(source.cacheKey),
    userNamespace: normalizeNamespace(source.userNamespace),
    cachedAt,
    expiresAt: cachedAt + ttl,
    value: source.value,
  };
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function normalizeCacheIdentity(value) {
  return {
    cacheKind: normalizeSpace(value.cacheKind || '') || null,
    cacheKey: normalizeSpace(value.cacheKey == null ? '' : String(value.cacheKey)) || null,
    userNamespace: normalizeNamespace(value.userNamespace),
  };
}

function matchOptionalEntryValue(entryValue, expected) {
  if (!expected) {
    return true;
  }
  return normalizeSpace(entryValue || '') === expected;
}

function hasIdentityCriteria(identity) {
  return Boolean(identity.cacheKind) || Boolean(identity.cacheKey);
}

function hasMatchingCacheIdentity(entry, identity) {
  if (normalizeNamespace(entry?.userNamespace) !== identity.userNamespace) {
    return false;
  }
  if (!hasIdentityCriteria(identity)) {
    return true;
  }
  if (!matchOptionalEntryValue(entry?.cacheKind, identity.cacheKind)) {
    return false;
  }
  return matchOptionalEntryValue(
    entry?.cacheKey == null ? '' : String(entry.cacheKey),
    identity.cacheKey
  );
}

function readCurrentAt(options) {
  if (Number.isFinite(options.now)) {
    return options.now;
  }
  return Date.now();
}

function isObjectEntry(value) {
  return Boolean(value) && typeof value === 'object';
}

function hasFreshExpiry(entry, currentAt) {
  if (!Number.isFinite(entry.expiresAt)) {
    return false;
  }
  return entry.expiresAt >= currentAt;
}

function isParsedCacheEntryFresh(entry, options) {
  const currentOptions = asObject(options);

  if (!isObjectEntry(entry)) {
    return false;
  }

  if (currentOptions.forceRefresh) {
    return false;
  }

  const identity = normalizeCacheIdentity(currentOptions);
  if (!hasMatchingCacheIdentity(entry, identity)) {
    return false;
  }

  return hasFreshExpiry(entry, readCurrentAt(currentOptions));
}

module.exports = {
  createParsedCacheEntry,
  isParsedCacheEntryFresh,
};
