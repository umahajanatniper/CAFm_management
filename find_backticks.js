const fs = require('fs');
const text = fs.readFileSync('app.js', 'utf8');
text.split(/\n/).forEach((line, idx) => {
  const count = (line.match(/`/g) || []).length;
  if (count > 1) {
    console.log(idx + 1, count, line);
  }
});
