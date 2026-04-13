import multer from 'multer';

const memory = multer.memoryStorage();

/** Max body for largest single file (video). */
const MAX_VIDEO = 100 * 1024 * 1024;

export const uploadSingleMiddleware = multer({
  storage: memory,
  limits: { fileSize: MAX_VIDEO, files: 1 },
}).single('file');

export const uploadMultiMiddleware = multer({
  storage: memory,
  limits: { fileSize: MAX_VIDEO, files: 10 },
}).array('files', 10);
