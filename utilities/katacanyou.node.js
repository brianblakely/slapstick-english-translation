const fs = require(`fs`),
      jconv = require(`jconv`),
      Text2Hex = require(`./text2hex.node.js`),
      kataLookup = new Text2Hex(`./dialog-kata.tbl`),
      kanjiLookup = new Text2Hex(`./dialog.tbl`);

const katacanyou = (file=`./roms/Slap Stick (Japan).sfc`)=> new Promise((resolve, reject)=> {
  const output = new Set();

  fs.readFile(file, (err, data)=> {
    if(err) {
      reject(err);
      return;
    }

    const hexen = [];

    data = data.toString(`hex`).toUpperCase().match(/.{1,2}/g);

    for(let i = 0, len = data.length; i < len; ++i) {
      let byte = data[i];

      if(byte !== `D4`) {
        continue;
      }

      const hex = [];

      while((byte = data[++i]) !== `D5` && i < len) {
        hex.push(byte);

        if([`80`, `82`, `83`].includes(byte) && data[i+1] === `D5`) {
          hex.push(`D5`);
          ++i;
        }
      }

      hex.length && hex.length < 200 && hexen.push(hex.join(``));
    }

    const phrases = [];
    for(const hex of hexen) {
      let phrase;

      // If the phrase includes kanji, process it letter by letter.
      if(hex.includes(`80`) || hex.includes(`81`) || hex.includes(`82`)) {
        phrase = new Promise((resolve, reject)=> {
          const hexLetters = hex.match(/.{1,2}/g),
                len = hexLetters.length,
                letters = [];

          for(let i = 0; i < len; ++i) {
            let letter = hexLetters[i];

            if(letter === `80` || letter === `81` || letter === `82`) {
              letter += hexLetters[++i];
              letters.push(kanjiLookup.getText(letter, 4));
            } else {
              letters.push(kataLookup.getText(letter));
            }
          }

          Promise.all(letters).then(results=> {
            let isValid = true;

            const result = results.reduce((prev, next)=> {
              if(!isValid || !prev.output || !next.output) {
                isValid = false;
                return `false`;
              }

              return {
                input: prev.input + next.input,
                output: prev.output + next.output
              };
            });

            // Return as a string if it isn't valid, or an object if it is.
            if(!isValid) {
              resolve(`Not valid`);
            } else {
              resolve(result);
            }
          }).catch(e=> console.error(e));
        });
      }
      // If the phrase is entirely Katakana, process it all together.
      else {
        phrase = kataLookup.getText(hex);
      }

      phrases.push(phrase);
    }

    Promise.all(phrases).then(results=> {
      for(const result of results) {
        result.output
          && output.add(`D4${result.input}D5=${result.output}`);
      }
      resolve(output);
    }).catch(e=> console.error(e));
  });
});

katacanyou()
  .then(result=>
    fs.writeFile(
      `dailog-kata-phrases.tbl`,

      jconv.encode(
        Array.from(result).join(`\n`),
        `SJIS`
      ),

      err=> {
        if(err) {
          console.error(err);
        }
      }
    )
  )
  .catch(err=>console.error(err));
