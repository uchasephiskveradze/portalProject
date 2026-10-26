import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { Post } from '../models/post.model';
import { POST_STATUS } from '../models/post-status.model';
import { PostsApiService } from '../services/posts-api.service';
import { PostsViewStorageService } from '../services/posts-view-storage.service';
import { PostsListStore } from './posts-list.store';

describe('PostsListStore', () => {
  const approvedPost: Post = {
    id: '1',
    title: 'Approved Post',
    author: 'Author',
    description: 'Short description text',
    content: 'a'.repeat(100),
    createdAt: '2026-01-02T00:00:00.000Z',
    status: POST_STATUS.approved,
  };

  let store: InstanceType<typeof PostsListStore>;
  let api: { getPosts: ReturnType<typeof vi.fn> };

  const listResult = { posts: [approvedPost], totalItems: 1 };

  beforeEach(() => {
    api = { getPosts: vi.fn(() => of(listResult)) };

    TestBed.configureTestingModule({
      providers: [
        PostsListStore,
        { provide: PostsApiService, useValue: api },
        {
          provide: PostsViewStorageService,
          useValue: { read: () => 'pagination' as const, write: vi.fn() },
        },
      ],
    });

    store = TestBed.inject(PostsListStore);
  });

  it('should request only approved posts from the API', async () => {
    store.loadPosts();

    await vi.waitFor(() => expect(store.loading()).toBe(false));

    expect(api.getPosts).toHaveBeenCalledWith({
      force: false,
      query: {
        status: POST_STATUS.approved,
        titleLike: undefined,
        sort: 'createdAt',
        order: 'desc',
        page: 1,
        limit: store.pageSize,
      },
    });
    expect(store.posts()).toEqual([approvedPost]);
    expect(store.totalItems()).toBe(1);
  });

  it('should set an error when loading fails', async () => {
    api.getPosts.mockReturnValue(throwError(() => new Error('network')));

    store.loadPosts();

    await vi.waitFor(() => expect(store.loading()).toBe(false));

    expect(store.error()).toBe('errors.posts.load');
    expect(store.posts()).toEqual([]);
  });

  it('should refetch with title search without toggling initial loading', async () => {
    store.loadPosts();
    await vi.waitFor(() => expect(store.posts()).toEqual([approvedPost]));

    store.setSearchInput('Approved');
    await vi.waitFor(() => expect(store.filtering()).toBe(false));

    expect(store.loading()).toBe(false);
    expect(api.getPosts).toHaveBeenLastCalledWith({
      force: false,
      query: {
        status: POST_STATUS.approved,
        titleLike: 'Approved',
        sort: 'createdAt',
        order: 'desc',
        page: 1,
        limit: store.pageSize,
      },
    });
  });

  it('should request the current page from the API in pagination mode', async () => {
    api.getPosts.mockReturnValue(of({ posts: [approvedPost], totalItems: 25 }));

    store.loadPosts();
    await vi.waitFor(() => expect(store.loading()).toBe(false));

    store.setPage(2);
    await vi.waitFor(() => expect(store.filtering()).toBe(false));

    expect(store.currentPage()).toBe(2);
    expect(api.getPosts).toHaveBeenLastCalledWith({
      force: false,
      query: {
        status: POST_STATUS.approved,
        titleLike: undefined,
        sort: 'createdAt',
        order: 'desc',
        page: 2,
        limit: store.pageSize,
      },
    });
  });

  it('should append the next page in infinite scroll mode', async () => {
    const secondPost: Post = { ...approvedPost, id: '2', title: 'Second Post' };
    const infiniteApi = {
      getPosts: vi
        .fn()
        .mockReturnValueOnce(of({ posts: [approvedPost], totalItems: 2 }))
        .mockReturnValueOnce(of({ posts: [approvedPost, secondPost], totalItems: 2 })),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        PostsListStore,
        { provide: PostsApiService, useValue: infiniteApi },
        {
          provide: PostsViewStorageService,
          useValue: { read: () => 'infinite-scroll' as const, write: vi.fn() },
        },
      ],
    });

    const infiniteStore = TestBed.inject(PostsListStore);

    infiniteStore.loadPosts();
    await vi.waitFor(() => expect(infiniteStore.loading()).toBe(false));

    expect(infiniteApi.getPosts).toHaveBeenLastCalledWith({
      force: false,
      query: {
        status: POST_STATUS.approved,
        titleLike: undefined,
        sort: 'createdAt',
        order: 'desc',
        page: 1,
        limit: infiniteStore.pageSize,
      },
    });

    infiniteStore.loadMore();
    await vi.waitFor(() => expect(infiniteStore.posts()).toEqual([approvedPost, secondPost]));

    expect(infiniteStore.loadingMore()).toBe(false);
    expect(infiniteStore.filtering()).toBe(false);
    expect(infiniteApi.getPosts).toHaveBeenLastCalledWith({
      force: false,
      query: {
        status: POST_STATUS.approved,
        titleLike: undefined,
        sort: 'createdAt',
        order: 'desc',
        page: 2,
        limit: infiniteStore.pageSize,
      },
    });
  });
});
