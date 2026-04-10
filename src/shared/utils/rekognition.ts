import {
  RekognitionClient,
  CreateCollectionCommand,
  IndexFacesCommand,
  SearchFacesByImageCommand,
  DeleteFacesCommand,
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
