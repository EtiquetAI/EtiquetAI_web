const fs = require('fs');
const path = require('path');

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.isFile() && full.endsWith('.js')) fixFile(full);
  }
}

function fixFile(file) {
  let s = fs.readFileSync(file, 'utf8');
  s = s.replace(/(from\s+['"])(\.\.\/|\.\/)([^'";]+)(['"])/g, (m, pre, dot, mid, post) => {
    if (mid.endsWith('.js') || mid.match(/\.[a-zA-Z0-9]+$/)) return m; // already has extension
    return pre + dot + mid + '.js' + post;
  });
  fs.writeFileSync(file, s, 'utf8');
}

const dist = path.join(__dirname, 'dist');
if (fs.existsSync(dist)) {
  walk(dist);
  console.log('Fixed imports in dist');
} else {
  console.error('dist folder not found');
  process.exit(1);
}
