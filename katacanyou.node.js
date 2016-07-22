const fs = require(`fs`),
      text2hex = require(`./text2hex.node.js`);

const katacanyou = (file=`./roms/Slap Stick (Japan).sfc`)=> new Promise((resolve, reject)=> {
  const output = new Set();

  fs.readFile(file, (err, data)=> {
    if(err) {
      reject(err);
      return;
    }

    const hex = data.toString(`hex`).toUpperCase().match(/.{1,2}/g).join(` `);

    const re = /D4 (.{1,100}?) D5/g;

    const hexen = [];

    let match;
    while(match = re.exec(hex)) {
      hexen.push(match[1]);
    }

    const phrases = [];
    for(const hex of hexen) {
      if(hex.includes(`80`)) {
        continue;
      }

      console.log(hex);

      const phrase = text2hex(`dialog-kata.tbl`, hex.replace(/ /g, ``), ``, true);

      phrases.push(phrase);

      // const bytes = hex.split(` `);
      //
      // for(let i = 0; i < bytes.length; ++i) {
      //   const byte = bytes[i];
      //
      //   switch(byte) {
      //     case `80`:
      //       characters.push(text2hex(`./dialog.tbl`, byte+bytes[++i]), true);
      //       break;
      //     default:
      //       characters.push(text2hex(`./dialog-kata.tbl`, byte, ``, true));
      //       break;
      //   }
      // }

      // phrases.push(Promise.all(characters));
    }

    Promise.all(phrases).then(results=> {
      for(const result of results) {
        console.log(result);
        !result.includes(`Entry not found`)
          && output.add(`D4${result.input}D5=${result.output}`);
      }
      output.add(output.size);
      resolve(output);
    });
  });
});

katacanyou()
  .then(result=>console.log(Array.from(result).join(`\n`)))
  .catch(err=>console.log(err));
  // .then(result=>fs.writeFile(`kata.tbl`, Array.from(result).join(`\n`),  err=> {
  //   if(err) {
  //     console.log(err);
  //   }
  //
  //   console.log(Array.from(result).join(`\n`));
  // }))
