import winston from 'winston';

const { combine, timestamp, printf, colorize, errors } = winston.format;
const isProduction = process.env.NODE_ENV === 'production';

const logFormat = printf(({ level, message, timestamp: ts, stack }) => {
  const logMessage = stack ?? message;
  return `${ts as string} [${level}]: ${String(logMessage)}`;
});

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: combine(colorize(), logFormat),
  }),
];

if (!isProduction) {
  transports.push(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
    }),
  );
}

export const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: combine(errors({ stack: true }), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat),
  transports,
});
