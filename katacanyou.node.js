// TODO: Output TBL with SHIFT-JIS encoding.

const fs = require(`fs`),
      jconv = require(`jconv`),
      Text2Hex = require(`./text2hex.node.js`),
      kataLookup = new Text2Hex(`./dialog-kata.tbl`);

const katacanyou = (file=`./roms/Slap Stick (Japan).sfc`)=> new Promise((resolve, reject)=> {
  const output = new Set();

  fs.readFile(file, (err, data)=> {
    if(err) {
      reject(err);
      return;
    }

    const hexen = data.toString(`hex`).toUpperCase()
      .match(/.{1,2}/g).join(` `)
      .match(/D4 (.{1,80}?) D5/g)
      .map(hex=> hex.replace(/D4 | D5/g, ``));

    const phrases = [];
    for(const hex of hexen) {
      if(hex.includes(`80`)) {
        continue;
      }

      const phrase = kataLookup.getText(hex.replace(/ /g, ``));

      phrases.push(phrase);
    }

    Promise.all(phrases).then(results=> {
      for(const result of results) {
        result.output
          && output.add(`D4${result.input}D5=${result.output}`);
      }
      resolve(output);
    });
  });
});

katacanyou()
  .then(result=>
    fs.writeFile(
      `kata.tbl`,
      Array.from(result).join(`\n`),
      err=> {
        if(err) {
          console.log(err);
        }
      }
    )
  )
  .catch(err=>console.log(err));
