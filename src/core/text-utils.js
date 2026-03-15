function normalizeSpace(str) {
  const value = String(str || '');
  let output = '';
  let sawWhitespace = false;

  for (const character of value) {
    const isWhitespace = /\s/.test(character);
    if (isWhitespace) {
      sawWhitespace = output.length > 0;
      continue;
    }
    if (sawWhitespace) {
      output += ' ';
      sawWhitespace = false;
    }
    output += character;
  }

  return output;
}

function stripCombiningMarks(value) {
  let output = '';

  for (const character of value) {
    const codePoint = character.codePointAt(0);
    const isCombiningMark = codePoint >= 0x0300 && codePoint <= 0x036f;
    if (!isCombiningMark) {
      output += character;
    }
  }

  return output;
}

function normalizeForMatch(str) {
  return stripCombiningMarks(normalizeSpace(str).normalize('NFD')).toLowerCase();
}

module.exports = {
  normalizeSpace,
  normalizeForMatch,
};
