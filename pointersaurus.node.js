const fs = require(`fs`);

const calcPointer = (offset)=> `${
  (parseInt(offset, 16) + parseInt(`C00000`, 16))
    .toString(16)
    .match(/.{1,2}/g)
    .reverse()
    .join(``)
    .toUpperCase()
}000000`.substr(0,8);

const tickOffset = (offset, amount)=> (parseInt(offset, 16) + amount).toString(16).toUpperCase();

const arrayIndex = (arrO, arrI)=> {
  let indexOf = -1;

  for(let i = 0, len = arrO.length; i < len; ++i) {
    const el = arrO[i];

    if(el === arrI[0]) {
      let j = 1;

      while(arrO[i+j] === arrI[j]) {
        ++j;
      }

      if(j === arrI.length) {
        indexOf = i;
        return indexOf;
      }
    }
  }

  return indexOf;
};

const crawlFromOffset = (offset, data, tick)=> {
  const len = data.length;

  while(
    !~arrayIndex(data.match(/.{1,2}/g), calcPointer(offset).match(/.{1,2}/g))
    && parseInt(offset, 16) > 0
    && parseInt(offset, 16) < data.length
  ) {
    offset = tickOffset(offset, tick);
  }

  return {
    offset,
    pointer: calcPointer(offset),
    location: arrayIndex(data.match(/.{1,2}/g), calcPointer(offset).match(/.{1,2}/g)).toString(16).toUpperCase()
  };
};

const pointersaurus = (file=`./roms/Slap Stick (Japan).sfc`, offset)=> new Promise((resolve, reject)=> {
  fs.readFile(file, (err, data)=> {
    if(err) {
      reject(err);
      return;
    }

    data = data.toString(`hex`).toUpperCase();

    offset = offset.toUpperCase();

    if(data.includes(calcPointer(offset))) {
      resolve(`The pointer for offset ${offset} is ${calcPointer(offset)}, which resides at offset ${arrayIndex(data.match(/.{1,2}/g), calcPointer(offset).match(/.{1,2}/g)).toString(16).toUpperCase()}`);
    } else {
      const revPointer = crawlFromOffset(offset, data, -1),
            fwdPointer = crawlFromOffset(offset, data, 1);

      resolve(`
        We couldn't find a valid pointer for offset ${offset}, but we did find these nearby:
        - Pointer ${revPointer.pointer} for offset ${revPointer.offset} at offset ${revPointer.location}
        - Pointer ${fwdPointer.pointer} for offset ${fwdPointer.offset} at offset ${fwdPointer.location}
      `);
    }
  });
});

pointersaurus(undefined, `5DF31`)
  .then(result=> console.info(result))
  .catch(err=> console.error(err));
