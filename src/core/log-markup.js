const ALLOWED_TAGS = new Set(['a', 'b', 'br', 'i', 'span', 'u']);

function escapeRegExp(text) {
  const source = String(text);
  let output = '';

  for (const char of source) {
    if (String.raw`\\^$.*+?()[]{}|`.includes(char)) {
      output += '\\';
    }
    output += char;
  }

  return output;
}

function isAsciiLetter(value) {
  const lower = value.toLowerCase();
  return lower >= 'a' && lower <= 'z';
}

function isAsciiLettersOnly(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }

  for (const char of value) {
    if (!isAsciiLetter(char)) {
      return false;
    }
  }

  return true;
}

function isHexColor(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed);
}

function extractColorFromStyle(styleText) {
  const declarations = String(styleText || '').split(';');

  for (const declaration of declarations) {
    const separatorIndex = declaration.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }

    const propertyName = declaration.slice(0, separatorIndex).trim().toLowerCase();
    if (propertyName !== 'color') {
      continue;
    }

    return declaration.slice(separatorIndex + 1).trim();
  }

  return '';
}

function isSafeColor(value) {
  return isHexColor(value) || isAsciiLettersOnly(value);
}

function isWhitespaceCharacter(value) {
  return value === ' ' || value === '\n' || value === '\r' || value === '\t' || value === '\f';
}

function isAsciiTagName(value) {
  return isAsciiLettersOnly(value);
}

function isAttributeNameCharacter(value) {
  const codePoint = value.codePointAt(0);
  const code = codePoint == null ? -1 : codePoint;

  return (
    (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || value === ':' || value === '-'
  );
}

function resolveHrefUrl(rawHref, baseUrl) {
  if (typeof URL.canParse !== 'function') {
    return null;
  }
  if (!URL.canParse(rawHref, baseUrl)) {
    return null;
  }
  return new URL(rawHref, baseUrl);
}

function sanitizeHref(rawHref, baseUrl) {
  if (typeof rawHref !== 'string' || rawHref.trim() === '') {
    return null;
  }
  const resolved = resolveHrefUrl(rawHref, baseUrl || 'https://www.pbinfo.ro/');
  if (!resolved) {
    return null;
  }
  const protocol = resolved.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    return null;
  }
  return resolved.toString();
}

function parseCloseTag(innerTag) {
  const closeName = innerTag.slice(1).trim();
  if (!isAsciiTagName(closeName)) return null;

  return createParsedTag('close', closeName.toLowerCase(), {});
}

function splitTagContent(innerTag) {
  let splitIndex = 0;
  while (splitIndex < innerTag.length && !isWhitespaceCharacter(innerTag[splitIndex])) {
    splitIndex += 1;
  }

  return createSplitTagContentResult(
    innerTag.slice(0, splitIndex),
    splitIndex < innerTag.length ? innerTag.slice(splitIndex + 1) : ''
  );
}

function applySafeColorToElement(element, safeTagName, attrs) {
  if (safeTagName !== 'span') {
    return;
  }

  const color = extractColorFromStyle(attrs.style);
  if (color && isSafeColor(color)) {
    element.style.color = color;
  }
}

function applySafeAnchorAttributes(element, attrs, baseUrl) {
  const href = sanitizeHref(attrs.href, baseUrl);
  if (!href) {
    return false;
  }

  element.href = href;
  element.target = '_blank';
  element.rel = 'noopener noreferrer';
  return true;
}

function createAllowedElement(tagName, attrs, doc, baseUrl) {
  const safeTagName = String(tagName || '').toLowerCase();
  if (!ALLOWED_TAGS.has(safeTagName)) {
    return null;
  }

  const element = doc.createElement(safeTagName);
  applySafeColorToElement(element, safeTagName, attrs);
  if (safeTagName === 'a' && !applySafeAnchorAttributes(element, attrs, baseUrl)) {
    return null;
  }

  return element;
}

function skipWhitespace(source, index) {
  let nextIndex = index;

  while (nextIndex < source.length && isWhitespaceCharacter(source[nextIndex])) {
    nextIndex += 1;
  }

  return nextIndex;
}

function readAttributeName(source, index) {
  const nameStart = index;
  let nextIndex = index;

  while (nextIndex < source.length && isAttributeNameCharacter(source[nextIndex])) {
    nextIndex += 1;
  }

  if (nameStart === nextIndex) return null;
  const normalizedName = source.slice(nameStart, nextIndex).toLowerCase();
  return createAttributeNameResult(normalizedName, nextIndex);
}

function readQuotedAttributeValue(source, index) {
  const valueStart = index;
  let nextIndex = index;

  while (nextIndex < source.length && source[nextIndex] !== '"') {
    nextIndex += 1;
  }

  if (nextIndex >= source.length) return null;

  const quotedValue = source.slice(valueStart, nextIndex);
  return createAttributeValueResult(quotedValue, nextIndex + 1);
}

function readAttributeEntry(source, index) {
  const nameResult = readAttributeName(source, index);
  let nextIndex;
  let valueResult;

  if (!nameResult) {
    return null;
  }

  nextIndex = skipWhitespace(source, nameResult.nextIndex);
  if (source[nextIndex] !== '=') {
    return null;
  }

  nextIndex = skipWhitespace(source, nextIndex + 1);
  if (source[nextIndex] !== '"') {
    return null;
  }

  valueResult = readQuotedAttributeValue(source, nextIndex + 1);
  if (!valueResult) {
    return null;
  }

  return createAttributeEntryResult(
    nameResult.attributeName,
    valueResult.value,
    valueResult.nextIndex
  );
}

function parseTagAttributes(rawAttrs) {
  const attrs = {};
  const source = String(rawAttrs || '');
  let index = 0;
  let entry;

  while (index < source.length) {
    index = skipWhitespace(source, index);
    if (index >= source.length) {
      break;
    }

    entry = readAttributeEntry(source, index);
    if (!entry) {
      break;
    }

    attrs[entry.attributeName] = entry.value;
    index = entry.nextIndex;
  }

  return attrs;
}

function isBreakTagText(tagText) {
  return tagText === '<br>' || tagText === '<br/>' || tagText === '<br />';
}

function parseOpenTag(innerTag) {
  const tagContent = splitTagContent(innerTag);
  const tagNameText = tagContent.tagNameText;
  const attrsText = tagContent.attrsText;
  if (!isAsciiTagName(tagNameText)) {
    return null;
  }
  return createParsedTag('open', tagNameText.toLowerCase(), parseTagAttributes(attrsText));
}

function extractInnerTagText(tagText) {
  if (!tagText.startsWith('<') || !tagText.endsWith('>')) {
    return null;
  }
  const innerTag = tagText.slice(1, -1).trim();
  if (!innerTag) {
    return null;
  }
  return innerTag;
}

function parseSupportedTag(rawTag) {
  const tagText = String(rawTag || '').trim();
  if (isBreakTagText(tagText)) {
    return createParsedTag('void', 'br', Object.create(Object.prototype));
  }
  const innerTag = extractInnerTagText(tagText);
  if (!innerTag) {
    return null;
  }
  if (innerTag.startsWith('/')) {
    return parseCloseTag(innerTag);
  }
  return parseOpenTag(innerTag);
}

function createParsedTag(kind, tagName, attrs) {
  const tag = Object.create(Object.prototype);
  tag.kind = kind;
  tag.tagName = tagName;
  tag.attrs = attrs;
  return tag;
}

function createSplitTagContentResult(tagNameText, attrsText) {
  const result = Object.create(Object.prototype);
  result.tagNameText = tagNameText;
  result.attrsText = attrsText;
  return result;
}

function createAttributeNameResult(attributeName, nextIndex) {
  const result = Object.create(Object.prototype);
  result.attributeName = attributeName;
  result.nextIndex = nextIndex;
  return result;
}

function createAttributeValueResult(value, nextIndex) {
  const result = Object.create(Object.prototype);
  result.value = value;
  result.nextIndex = nextIndex;
  return result;
}

function createAttributeEntryResult(attributeName, value, nextIndex) {
  const result = Object.create(Object.prototype);
  result.attributeName = attributeName;
  result.value = value;
  result.nextIndex = nextIndex;
  return result;
}

function resolveBaseUrl(doc, options) {
  if (options && typeof options.baseUrl === 'string' && options.baseUrl.trim()) {
    return options.baseUrl;
  }

  return doc?.location?.href || 'https://www.pbinfo.ro/';
}

function appendSafeOpenTag(parsedTag, doc, baseUrl, stack, appendText) {
  const element = createAllowedElement(parsedTag.tagName, parsedTag.attrs, doc, baseUrl);
  if (element) {
    stack.at(-1).appendChild(element);
    if (parsedTag.tagName !== 'br') {
      stack.push(element);
    }
    return;
  }

  appendText(parsedTag.raw);
}

function appendSafeCloseTag(parsedTag, stack, appendText) {
  const closeName = String(parsedTag.tagName || '').toLowerCase();
  for (let index = stack.length - 1; index > 0; index -= 1) {
    if (stack[index].tagName.toLowerCase() === closeName) {
      stack.length = index;
      return;
    }
  }

  appendText(parsedTag.raw);
}

function appendParsedTag(parsedTag, doc, baseUrl, stack, appendText) {
  if (parsedTag.kind === 'void') {
    stack.at(-1).appendChild(doc.createElement('br'));
    return;
  }

  if (parsedTag.kind === 'close') {
    appendSafeCloseTag(parsedTag, stack, appendText);
    return;
  }

  appendSafeOpenTag(parsedTag, doc, baseUrl, stack, appendText);
}

function appendTextNode(doc, stack, text) {
  if (!text) {
    return;
  }

  stack.at(-1).appendChild(doc.createTextNode(text));
}

function findTagBounds(raw, startIndex) {
  const tagStart = raw.indexOf('<', startIndex);
  let tagEnd;

  if (tagStart === -1) {
    return null;
  }

  tagEnd = raw.indexOf('>', tagStart + 1);
  if (tagEnd === -1) {
    return null;
  }

  const bounds = {};
  bounds.tagStart = tagStart;
  bounds.tagEnd = tagEnd;
  return bounds;
}

function appendMarkupTag(rawTag, doc, baseUrl, stack) {
  const parsedTag = parseSupportedTag(rawTag);

  if (parsedTag == null) {
    appendTextNode(doc, stack, rawTag);
    return;
  }

  appendParsedTag({ ...parsedTag, raw: rawTag }, doc, baseUrl, stack, function (text) {
    appendTextNode(doc, stack, text);
  });
}

function appendSimpleMarkup(target, markup, options) {
  const doc = target.ownerDocument;
  const fragment = doc.createDocumentFragment();
  const stack = [fragment];
  const raw = String(markup || '');
  let lastIndex = 0;
  const baseUrl = resolveBaseUrl(doc, options);
  let bounds = findTagBounds(raw, 0);

  while (bounds) {
    appendTextNode(doc, stack, raw.slice(lastIndex, bounds.tagStart));
    appendMarkupTag(raw.slice(bounds.tagStart, bounds.tagEnd + 1), doc, baseUrl, stack);
    lastIndex = bounds.tagEnd + 1;
    bounds = findTagBounds(raw, lastIndex);
  }

  appendTextNode(doc, stack, raw.slice(lastIndex));
  target.appendChild(fragment);
}

module.exports = {
  appendSimpleMarkup,
  createAllowedElement,
  parseSupportedTag,
  parseTagAttributes,
  resolveBaseUrl,
  appendSafeCloseTag,
  isAsciiLettersOnly,
  isHexColor,
  extractColorFromStyle,
  skipWhitespace,
  readAttributeName,
  readQuotedAttributeValue,
  readAttributeEntry,
  findTagBounds,
  sanitizeHref,
  isSafeColor,
  escapeRegExp,
};
