const fs = require(`fs`);

const hiromOffset = parseInt(`C00000`, 16);

const calcPointer = (offset)=> `${
  (parseInt(offset, 16) + hiromOffset)
    .toString(16)
    .toUpperCase()
    .match(/.{1,2}/g)
    .reverse()
    .join(``)
}00000000`.substr(0,8);

const tickOffset = (offset, amount)=> (parseInt(offset, 16) + amount).toString(16).toUpperCase();

const arrayIndex = (arrO, arrI, startIndex = 0)=> {
  let indexOf = -1;

  const lenI = arrI.length;

  for(let i = startIndex, len = arrO.length; i < len; ++i) {
    if(arrO[i] === arrI[0]) {
      let j = 1;

      while(arrO[i+j] === arrI[j]) {
        ++j;
      }

      if(j === lenI) {
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
    !~arrayIndex(data, calcPointer(offset).match(/.{1,2}/g))
    && parseInt(offset, 16) > 0
    && parseInt(offset, 16) < data.length
  ) {
    offset = tickOffset(offset, tick);
  }

  return {
    offset,
    pointer: calcPointer(offset),
    location: arrayIndex(data, calcPointer(offset).match(/.{1,2}/g)).toString(16).toUpperCase()
  };
};

const pointersaurus = (file=`./roms/Slap Stick (Japan).sfc`, offset)=> new Promise((resolve, reject)=> {
  fs.readFile(file, (err, data)=> {
    if(err) {
      reject(err);
      return;
    }

    const dataStr = data.toString(`hex`).toUpperCase(),
          dataArr = dataStr.match(/.{1,2}/g);

    offset = offset.toUpperCase();

    const offsetIndex = arrayIndex(dataArr, calcPointer(offset).match(/.{1,2}/g));

    if(~offsetIndex) {
      resolve(`The pointer for offset ${offset} is ${calcPointer(offset)}, which resides at offset ${offsetIndex.toString(16).toUpperCase()}`);
    } else {
      const revPointer = crawlFromOffset(offset, dataArr, -1),
            fwdPointer = crawlFromOffset(offset, dataArr, 1);

      resolve(`
        We couldn't find a valid pointer for offset ${offset}, but we did find these nearby:
        - Pointer ${revPointer.pointer} for offset ${revPointer.offset} at offset ${revPointer.location}
        - Pointer ${fwdPointer.pointer} for offset ${fwdPointer.offset} at offset ${fwdPointer.location}
      `);
    }
  });
});

pointersaurus(undefined, `5A3ED`)
  .then(result=> console.info(result))
  .catch(err=> console.error(err));
