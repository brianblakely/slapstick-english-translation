const fs = require(`fs`),
      jconv = require(`jconv`);

const text2hex = (tbl, str, lim=``, rev)=> new Promise((resolve, reject)=> {
  fs.readFile(tbl, (err, data)=> {
    if(err) {
      reject(err);
      return;
    }

    data = jconv.convert(data, `SJIS`, `UTF8`).toString();

    const result = [];

    const entries = data.split(`\n`);

    const words = !rev
      && str.split(lim)
      || str.match(/.{1,2}/g);

    for(const word of words) {
      let wordFound = false;

      for(const entry of entries) {
        const [hex, val] = entry.split(`=`);

        if(!rev && val && val === word) {
          wordFound = true;

          result.push(hex);
          break;
        } else if(rev && hex && hex.toUpperCase() === word.toUpperCase()) {
          wordFound = true;

          result.push(val);
          break;
        }
      }

      if(!wordFound) {
        resolve(`Entry not found: ${word}!`);
        return false;
      }
    }

    resolve({
      input: str,
      output: result.join(``)
    });
  });
});

module.exports = text2hex;

// Command line usage.

if(require.main === module) {
        // arg 1: Table file.
  const tbl = process.argv[2],
        // arg 2: String to turn into hex.
        str = process.argv[3],
        // arg 3: Search by character or word;
        // default is character.
        lim = (process.argv[4] || `-c`) === `-c`
          ? ``
          : ` `,
        // arg 4: Search text by hex.
        rev = process.argv.includes(`-r`);

  if(!tbl || !str) {
    console.log(`Usage: node text2hex.node.js <table> <string> [-cwr]`);

    return false;
  }

  text2hex(tbl, str, lim, rev)
    .then(result=>console.log(result))
    .catch(err=>console.log(err));
}
