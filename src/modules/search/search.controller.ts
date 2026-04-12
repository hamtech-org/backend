import { Request, Response, NextFunction } from 'express';
import { searchService } from './search.service.js';
import { sendSuccess } from '@/shared/utils/response.js';
import type { ISearchOptions } from './search.types.js';

const parseSearchOptions = (req: Request): ISearchOptions => ({
  query: req.query.q as string,
  page: req.query.page ? Number(req.query.page) : undefined,
  pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
  sortBy: req.query.sortBy as string | undefined,
  sortOrder: req.query.sortOrder as 'asc' | 'desc' | undefined,
  userId: req.user?.userId, // Add current user ID
});

export const searchController = {
  searchMessages: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const options = parseSearchOptions(req);
      const results = await searchService.searchMessages(req.user!.userId, options);
      sendSuccess(res, results);
    } catch (error) { next(error); }
  },

  searchUsers: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const options = parseSearchOptions(req);
      const results = await searchService.searchUsers(options);
      sendSuccess(res, results);
    } catch (error) { next(error); }
  },

  searchUsersByContact: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const options = parseSearchOptions(req);
      const results = await searchService.searchUsersByContact(options);
      sendSuccess(res, results);
    } catch (error) { next(error); }
  },

  searchGroups: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const options = parseSearchOptions(req);
      const results = await searchService.searchGroups(options);
      sendSuccess(res, results);
    } catch (error) { next(error); }
  },

  searchPosts: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const options = parseSearchOptions(req);
      const results = await searchService.searchPosts(options);
      sendSuccess(res, results);
    } catch (error) { next(error); }
  },

  searchAll: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const options = parseSearchOptions(req);
      const results = await searchService.searchAll(req.user!.userId, options);
      sendSuccess(res, results);
    } catch (error) { next(error); }
  },

  searchAllChat: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const options = parseSearchOptions(req);
      const results = await searchService.searchAllChat(req.user!.userId, options);
      sendSuccess(res, results);
    } catch (error) { next(error); }
  },
};
