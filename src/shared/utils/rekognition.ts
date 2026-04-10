import {
  RekognitionClient,
  CreateCollectionCommand,
  IndexFacesCommand,
  SearchFacesByImageCommand,
  DeleteFacesCommand,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
} from '@aws-sdk/client-rekognition';
import { env } from '@/config/env.js';
import { logger } from '@/shared/utils/logger.js';

// ──────────────────────────────────────────────
// Client
// ──────────────────────────────────────────────

const rekognitionClient = new RekognitionClient({
  region: env.AWS_REGION,
  ...(env.AWS_ACCESS_KEY_ID && {
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  }),
});

const COLLECTION_ID = env.REKOGNITION_COLLECTION_ID;
const FACE_MATCH_THRESHOLD = env.REKOGNITION_FACE_MATCH_THRESHOLD;

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Tạo Rekognition Collection nếu chưa tồn tại
 * Gọi 1 lần khi khởi động server hoặc qua setup script
 */
export const ensureCollectionExists = async (): Promise<void> => {
  try {
    await rekognitionClient.send(
      new CreateCollectionCommand({ CollectionId: COLLECTION_ID }),
    );
    logger.info(`Rekognition collection "${COLLECTION_ID}" đã được tạo`);
  } catch (error: unknown) {
    const err = error as Error;
    if (err.name === 'ResourceAlreadyExistsException') {
      logger.debug(`Rekognition collection "${COLLECTION_ID}" đã tồn tại`);
    } else {
      throw error;
    }
  }
};

// ──────────────────────────────────────────────
// Face Operations
// ──────────────────────────────────────────────

export interface FaceSearchResult {
  userId: string;
  similarity: number;
  faceId: string;
}

/**
 * Đăng ký khuôn mặt vào collection
 * - Chỉ lấy 1 khuôn mặt nổi bật nhất
 * - Lưu userId vào ExternalImageId để tra cứu ngược
 *
 * @returns FaceId từ Rekognition (lưu vào DB để xóa sau)
 */
export const indexFace = async (
  userId: string,
  imageBytes: Buffer,
): Promise<string> => {
  const result = await rekognitionClient.send(
    new IndexFacesCommand({
      CollectionId: COLLECTION_ID,
      Image: { Bytes: imageBytes },
      ExternalImageId: userId,
      MaxFaces: 1,
      QualityFilter: 'AUTO',
      DetectionAttributes: ['DEFAULT'],
    }),
  );

  const faceRecords = result.FaceRecords;
  if (!faceRecords || faceRecords.length === 0) {
    throw new Error('Không phát hiện khuôn mặt trong ảnh');
  }

  const faceId = faceRecords[0].Face?.FaceId;
  if (!faceId) {
    throw new Error('Không thể lấy FaceId từ Rekognition');
  }

  logger.info(`Face indexed for user ${userId}, faceId: ${faceId}`);
  return faceId;
};

/**
 * Tìm khuôn mặt trong collection
 * - Trả về userId + similarity nếu tìm thấy
 * - Trả về null nếu không khớp
 */
export const searchFace = async (
  imageBytes: Buffer,
): Promise<FaceSearchResult | null> => {
  try {
    const result = await rekognitionClient.send(
      new SearchFacesByImageCommand({
        CollectionId: COLLECTION_ID,
        Image: { Bytes: imageBytes },
        MaxFaces: 1,
        FaceMatchThreshold: FACE_MATCH_THRESHOLD,
      }),
    );

    const matches = result.FaceMatches;
    if (!matches || matches.length === 0) {
      return null;
    }

    const bestMatch = matches[0];
    const externalImageId = bestMatch.Face?.ExternalImageId;
    const similarity = bestMatch.Similarity ?? 0;
    const faceId = bestMatch.Face?.FaceId ?? '';

    if (!externalImageId) {
      return null;
    }

    return {
      userId: externalImageId,
      similarity,
      faceId,
    };
  } catch (error: unknown) {
    const err = error as Error;
    // Nếu không phát hiện khuôn mặt trong ảnh đầu vào
    if (err.name === 'InvalidParameterException') {
      return null;
    }
    throw error;
  }
};

/**
 * Xóa khuôn mặt khỏi collection bằng FaceId
 */
export const deleteFace = async (faceId: string): Promise<void> => {
  await rekognitionClient.send(
    new DeleteFacesCommand({
      CollectionId: COLLECTION_ID,
      FaceIds: [faceId],
    }),
  );
  logger.info(`Face deleted from collection: ${faceId}`);
};

// ──────────────────────────────────────────────
// Face Liveness (Anti-Spoofing)
// ──────────────────────────────────────────────

export interface FaceLivenessResult {
  sessionId: string;
  confidence: number;
  isLive: boolean;
}

/**
 * Tạo session mới cho face liveness check
 * User phải hoàn thành movement challenge trước khi index face
 *
 * @returns sessionId để sử dụng ở frontend + backend verify
 */
export const createLivenessSession = async (): Promise<string> => {
  try {
    const result = await rekognitionClient.send(new CreateFaceLivenessSessionCommand({}));

    const sessionId = result.SessionId;
    if (!sessionId) {
      throw new Error('Không thể tạo liveness session');
    }

    logger.debug(`Liveness session created: ${sessionId}`);
    return sessionId;
  } catch (error) {
    logger.error('Failed to create liveness session:', error);
    throw error;
  }
};

/**
 * Xác thực face liveness bằng session ID
 * - Gọi sau khi user hoàn thành movement challenge ở frontend
 * - Trả về độ tin cậy và kết quả (live hay spoofed)
 *
 * @param sessionId - Session ID từ createLivenessSession
 * @returns { sessionId, confidence, isLive }
 */
export const detectFaceLiveness = async (
  sessionId: string,
): Promise<FaceLivenessResult> => {
  try {
    const result = await rekognitionClient.send(
      new GetFaceLivenessSessionResultsCommand({
        SessionId: sessionId,
      }),
    );

    const confidence = result.Confidence ?? 0; // Already in 0-100 range
    // AWS trả về:
    // - Confidence: 0-100 (độ tin cậy)
    // - Status: 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'IN_PROGRESS' | 'CREATED'
    const isSucceeded = result.Status === 'SUCCEEDED';
    const isLive = isSucceeded && confidence >= 80; // Ngưỡng 80%

    const livenessResult: FaceLivenessResult = {
      sessionId,
      confidence: Math.round(confidence * 100) / 100,
      isLive,
    };

    if (isLive) {
      logger.debug(`✅ Face liveness verified (confidence: ${confidence.toFixed(2)}%)`);
    } else {
      logger.warn(`❌ Face liveness failed (confidence: ${confidence.toFixed(2)}%)`);
    }

    return livenessResult;
  } catch (error) {
    logger.error('Failed to get face liveness session results:', error);
    throw error;
  }
};
