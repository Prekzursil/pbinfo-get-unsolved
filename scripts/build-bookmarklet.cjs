const { buildRelease } = require('./build-release.cjs');

buildRelease().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
