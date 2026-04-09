import { newsfeedRepository } from './newsfeed.repository.js';
import type { IPost, IComment, IReel, ICreatePostDto, ICreateReelDto } from './newsfeed.types.js';

export const newsfeedService = {
  getFeed: async (_userId: string, _limit?: number): Promise<IPost[]> => {
    // TODO: Lấy bài viết từ bạn bè + public, sắp xếp theo thời gian
    void newsfeedRepository;
    return [];
  },

  createPost: async (_authorId: string, _data: ICreatePostDto): Promise<IPost> => {
    // TODO: Tạo bài viết mới, index vào Elasticsearch
    throw new Error('Chưa triển khai');
  },

  getPostById: async (postId: string): Promise<IPost | null> => {
    return newsfeedRepository.getPostById(postId);
  },

  updatePost: async (_postId: string, _data: Partial<ICreatePostDto>): Promise<void> => {
    // TODO: Cập nhật bài viết
    throw new Error('Chưa triển khai');
  },

  deletePost: async (_postId: string): Promise<void> => {
    // TODO: Xóa bài viết + comments liên quan
    throw new Error('Chưa triển khai');
  },

  reactToPost: async (_postId: string, _userId: string, _type: string): Promise<void> => {
    // TODO: Thêm/cập nhật reaction cho bài viết
    throw new Error('Chưa triển khai');
  },

  getComments: async (postId: string, limit?: number): Promise<IComment[]> => {
    return newsfeedRepository.getCommentsByPostId(postId, limit);
  },

  addComment: async (_postId: string, _authorId: string, _content: string, _parentId?: string): Promise<IComment> => {
    // TODO: Thêm bình luận, cập nhật commentsCount
    throw new Error('Chưa triển khai');
  },

  createReel: async (_authorId: string, _data: ICreateReelDto): Promise<IReel> => {
    // TODO: Tạo reel mới
    throw new Error('Chưa triển khai');
  },

  getReels: async (_limit?: number): Promise<IReel[]> => {
    // TODO: Lấy danh sách reels theo thuật toán đề xuất
    return [];
  },
};
