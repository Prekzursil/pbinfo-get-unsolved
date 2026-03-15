const test = require('node:test');
const assert = require('node:assert/strict');

const { detectPbinfoUserNamespace } = require('../src/core');

function makeAnchor(href, containers = []) {
  return {
    href,
    closest(selector) {
      return containers.includes(selector) ? {} : null;
    },
  };
}

test('detectPbinfoUserNamespace: prefers header account links and ignores content author links', () => {
  const headerLink = makeAnchor('/utilizator/321/demo-user', ['header', 'nav', '.navbar']);
  const contentLink = makeAnchor('/utilizator/9/problem-author', ['main', 'article']);
  const root = {
    querySelectorAll(selector) {
      if (selector === 'a[href*="/utilizator/"]') return [contentLink, headerLink];
      return [];
    },
  };

  assert.equal(detectPbinfoUserNamespace(root), '321:demo-user');
});

test('detectPbinfoUserNamespace: returns null when only content links are present', () => {
  const contentLink = makeAnchor('/utilizator/9/problem-author', ['main', 'article']);
  const root = {
    querySelectorAll(selector) {
      if (selector === 'a[href*="/utilizator/"]') return [contentLink];
      return [];
    },
  };

  assert.equal(detectPbinfoUserNamespace(root), null);
});
