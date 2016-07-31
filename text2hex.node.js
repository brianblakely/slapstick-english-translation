const fs = require(`fs`),
      jconv = require(`jconv`);

class Text2Hex {
  constructor(tbl) {
    this.tbl = tbl;

    this.loadedTable = new Promise((resolve, reject)=> {
      fs.readFile(tbl, (err, data)=> {
        if(err) {
          reject(err);
          return;
        }

        data = jconv.convert(data, `SJIS`, `UTF8`).toString();

        const entries = new Map(
          data
            .split(/\r\n|\n/)
            .filter(entry=> !!entry.trim())
            .map(entry=> {
              const [key, val] = entry.split(`=`);

              return [key, val];
            })
        );

        resolve(entries);
      });
    });
  }

  getHex(str, lim=``) {
    return new Promise((resolve, reject)=> {
      this.loadedTable.then(entries=> {
        const result = [];

        const words = str.split(lim);

        for(const word of words) {
          let wordFound = false;

          for(const [hex, text] of entries) {
            if(text === word) {
              wordFound = true;

              result.push(hex);
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
      }).catch(e=> console.error(e));
    });
  }

  getText(str, lim=2) {
    return new Promise((resolve, reject)=> {
      this.loadedTable.then(entries=> {
        const result = [];

        const re = new RegExp(`.{1,${lim}}`, `g`);

        const words = str.match(re).map(word=> word.toUpperCase());

        for(const word of words) {
          if(!entries.has(word)) {
            resolve(`Entry not found: ${word}!`);
            return false;
          }

          result.push(entries.get(word));
        }

        resolve({
          input: str,
          output: result.join(``)
        });
      }).catch(e=> console.error(e));
    });
  }
}

module.exports = Text2Hex;

// Command line usage.

if(require.main === module) {
        // arg 1: Table file.
  const tbl = process.argv[2],
        // arg 2: String to turn into hex.
        str = process.argv[3],
        // flag: Search text by hex.
        rev = process.argv.includes(`-r`),
        // flag: Search by character or word;
        // default is character.
        lim =
          !process.argv.includes(`-w`)
            ? !rev
              ? ``
              : 2
            : ` `;

  if(!tbl || !str) {
    console.error(`Usage: node text2hex.node.js <table> <string> [-cwr]`);

    process.exit(1);
  }

  const text2hex = new Text2Hex(tbl);

  const method = !rev
    ? text2hex.getHex(str, lim)
    : text2hex.getText(str, lim);

  method
    .then(result=>console.info(result.output || result))
    .catch(err=>console.error(err));
}
