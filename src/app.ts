import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import { env } from '@/config/env.js';
import { apiLimiter } from '@/shared/middlewares/rateLimiter.middleware.js';
import { errorHandler } from '@/shared/middlewares/errorHandler.middleware.js';

// Module routes
import authRoutes from '@/modules/auth/auth.routes.js';
import userRoutes from '@/modules/user/user.routes.js';
import chatRoutes from '@/modules/chat/index.js';
import contactRoutes from '@/modules/contact/contact.routes.js';
import newsfeedRoutes from '@/modules/newsfeed/newsfeed.routes.js';
import mediaRoutes from '@/modules/media/media.routes.js';
import aiRoutes from '@/modules/ai/ai.routes.js';
import adminRoutes from '@/modules/admin/admin.routes.js';
import searchRoutes from '@/modules/search/search.routes.js';
import agoraRoutes from '@/modules/agora/agora.routes.js';
import liveRoutes from '@/modules/live/live.routes.js';

const app = express();
app.set('trust proxy', 1);

// --- Middleware ---
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);

app.use(
  cors({
    origin: env.CORS_ORIGINS.split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(apiLimiter);

app.get('/', (_req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date().toISOString() });
});

// --- Health check ---
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- API Routes ---
const API_PREFIX = `/api/${env.API_VERSION}`;
app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/users`, userRoutes);
app.use(`${API_PREFIX}/chat`, chatRoutes);
app.use(`${API_PREFIX}/contacts`, contactRoutes);
app.use(`${API_PREFIX}/newsfeed`, newsfeedRoutes);
app.use(`${API_PREFIX}/media`, mediaRoutes);
app.use(`${API_PREFIX}/ai`, aiRoutes);
app.use(`${API_PREFIX}/admin`, adminRoutes);
app.use(`${API_PREFIX}/search`, searchRoutes);
app.use(`${API_PREFIX}/agora`, agoraRoutes);
app.use(`${API_PREFIX}/live`, liveRoutes);

// --- Error handler---
app.use(errorHandler);

export { app };
