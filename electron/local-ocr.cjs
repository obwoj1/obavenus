const { createWorker } = require('tesseract.js');
const english = require('@tesseract.js-data/eng');
const path = require('node:path');
const { imageSize } = require('image-size');
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;

function createLocalOcr({ workerFactory = createWorker, workerPath = path.join(path.dirname(require.resolve('tesseract.js')), 'worker-script', 'node', 'index.js'), langPath = english.langPath } = {}) {
  let workerPromise;
  let workQueue = Promise.resolve();
  function getWorker() {
    workerPromise ||= workerFactory('eng', 1, { workerPath, langPath, gzip: english.gzip, cacheMethod: 'none' }).catch((error) => { workerPromise = null; throw error; });
    return workerPromise;
  }
  const recognizeImage = async function recognizeImage(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new RangeError('OCR images must be non-empty and 10 MB or smaller.');
    const { width, height } = imageSize(bytes);
    if (!width || !height || width * height > MAX_IMAGE_PIXELS) throw new RangeError('OCR images must be 40 megapixels or smaller.');
    const recognition = workQueue.then(async () => {
      const worker = await getWorker();
      const result = await worker.recognize(bytes);
      return String(result?.data?.text || '').trim();
    });
    workQueue = recognition.catch(() => {});
    return recognition;
  };
  recognizeImage.close = async () => {
    await workQueue;
    if (workerPromise) await (await workerPromise).terminate();
    workerPromise = null;
  };
  return recognizeImage;
}

module.exports = { createLocalOcr, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS };
