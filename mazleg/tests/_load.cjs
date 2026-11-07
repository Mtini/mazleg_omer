// Loads the browser modules (UMD-style) into Node for unit tests.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const cache = {};
module.exports = function load(name) {
  if (cache[name]) return cache[name];
  if (name === 'scene3d') load('engine');
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', name + '.js'), 'utf8');
  const mod = { exports: {} };
  vm.runInThisContext('(function (module, exports, require) {' + code + '\n})', { filename: name + '.js' })(mod, mod.exports, (n) => load(n.replace('./', '').replace('.js', '')));
  return (cache[name] = mod.exports);
};
