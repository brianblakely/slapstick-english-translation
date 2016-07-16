      // arg 1: table file
const tbl = process.argv[2],
      // arg 2: string to turn into hex
      str = process.argv[3],
      // arg 3: search by character or word
      // default is character
      lim = (process.argv[4] || `-c`) === `-c`
        ? ``
        : ` `;

const fs = require(`fs`),
      jconv = require(`jconv`);

fs.readFile(tbl, (err, data)=> {
  if(err) {
    return console.log(err);
  }

  data = jconv.convert(data, `SJIS`, `UTF8`).toString();

  const hexen = [];

  const entries = data.split(`\n`)

  for(const entry of entries) {
    const [hex, val] = entry.split(`=`);

    for(const word of str.split(lim)) {
      if(val && (val.includes(word) || val === str)) {
        hexen.push(hex);
      }
    }
  }

  console.log(hexen.join(``));
});
