import { computed, inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  finalize,
  map,
  of,
  pipe,
  switchMap,
  tap,
} from 'rxjs';

import { PostsApiService } from '../services/posts-api.service';
import { PostsViewStorageService } from '../services/posts-view-storage.service';
import { Post } from '../models/post.model';
import { PostsListQuery } from '../models/posts-list-query.model';
import { PostsListResult } from '../models/posts-list-result.model';
import { PostsListViewMode } from '../models/posts-list-view-mode.model';
import { POST_STATUS } from '../models/post-status.model';
import { POSTS_PAGE_SIZE, PostDateSort } from './posts-list.types';

const emptyListResult = (): PostsListResult => ({ posts: [], totalItems: 0 });

type PostsListState = {
  loading: boolean;
  filtering: boolean;
  loadingMore: boolean;
  error: string | null;
  posts: Post[];
  totalItems: number;
  searchInput: string;
  searchQuery: string;
  sortOrder: PostDateSort;
  viewMode: PostsListViewMode;
  currentPage: number;
  listGeneration: number;
  initialized: boolean;
};

type LoadPostsRequest = {
  force: boolean;
  append: boolean;
};

const initialState = (viewMode: PostsListViewMode): PostsListState => ({
  loading: false,
  filtering: false,
  loadingMore: false,
  error: null,
  posts: [],
  totalItems: 0,
  searchInput: '',
  searchQuery: '',
  sortOrder: 'desc',
  viewMode,
  currentPage: 1,
  listGeneration: 0,
  initialized: false,
});

export const PostsListStore = signalStore(
  withState(() => initialState(inject(PostsViewStorageService).read())),
  withProps(() => ({ pageSize: POSTS_PAGE_SIZE })),
  withComputed((store) => ({
    filteredPosts: computed(() => store.posts()),
    isPaginationMode: computed(() => store.viewMode() === 'pagination'),
    isInfiniteScrollMode: computed(() => store.viewMode() === 'infinite-scroll'),
    totalPages: computed(() => Math.max(1, Math.ceil(store.totalItems() / store.pageSize))),
    displayedPosts: computed(() => store.posts()),
    hasMorePosts: computed(
      () => store.viewMode() === 'infinite-scroll' && store.posts().length < store.totalItems(),
    ),
    rangeStart: computed(() => {
      if (store.totalItems() === 0) {
        return 0;
      }

      if (store.viewMode() === 'pagination') {
        return (store.currentPage() - 1) * store.pageSize + 1;
      }

      return 1;
    }),
    rangeEnd: computed(() => {
      if (store.viewMode() === 'pagination') {
        return Math.min(store.currentPage() * store.pageSize, store.totalItems());
      }

      return Math.min(store.posts().length, store.totalItems());
    }),
    isEmpty: computed(
      () =>
        !store.loading() &&
        !store.error() &&
        store.posts().length === 0 &&
        !hasActiveFilters(store.searchQuery()),
    ),
    isEmptySearch: computed(
      () =>
        !store.loading() &&
        !store.filtering() &&
        !store.error() &&
        hasActiveFilters(store.searchQuery()) &&
        store.posts().length === 0,
    ),
  })),
  withMethods(
    (store, api = inject(PostsApiService), viewStorage = inject(PostsViewStorageService)) => {
      let requestId = 0;

      const loadPostsRx = rxMethod<LoadPostsRequest>(
        pipe(
          tap(({ append }) => {
            patchState(store, {
              loading: !append && !store.initialized(),
              filtering: !append && store.initialized(),
              loadingMore: append,
              error: null,
            });
          }),
          switchMap(({ force, append }) => {
            const id = ++requestId;
            const page = append ? store.currentPage() + 1 : store.currentPage();

            return api.getPosts({ force, query: buildListQuery(store, page) }).pipe(
              map((result) => ({ result, append, page, failed: false })),
              catchError(() => {
                patchState(store, { error: 'errors.posts.load' });
                return of({ result: emptyListResult(), append, page, failed: true });
              }),
              finalize(() => {
                if (id !== requestId) {
                  return;
                }

                patchState(store, {
                  loading: false,
                  filtering: false,
                  loadingMore: false,
                  initialized: true,
                });
              }),
            );
          }),
          tap(({ result, append, page, failed }) => {
            if (failed) {
              if (!append) {
                patchState(store, {
                  posts: result.posts,
                  totalItems: result.totalItems,
                  listGeneration: store.listGeneration() + 1,
                });
              }

              return;
            }

            if (append) {
              const posts = appendPosts(store.posts(), result.posts);

              patchState(store, {
                posts,
                totalItems:
                  posts.length === store.posts().length ? posts.length : result.totalItems,
                currentPage: posts.length === store.posts().length ? store.currentPage() : page,
              });
              return;
            }

            patchState(store, {
              posts: result.posts,
              totalItems: result.totalItems,
              listGeneration: store.listGeneration() + 1,
            });
          }),
        ),
      );

      const applySearchRx = rxMethod<string>(
        pipe(
          debounceTime(400),
          distinctUntilChanged(),
          tap((query) => {
            if (query === store.searchQuery()) {
              patchState(store, { filtering: false });
              return;
            }

            patchState(store, {
              searchQuery: query,
              currentPage: 1,
            });
            loadPostsRx({ force: false, append: false });
          }),
        ),
      );

      return {
        loadPosts(force = false): void {
          loadPostsRx({ force, append: false });
        },
        setSearchInput(query: string): void {
          patchState(store, { searchInput: query });

          if (query === store.searchQuery()) {
            patchState(store, { filtering: false });
            return;
          }

          patchState(store, { filtering: true });
          applySearchRx(query);
        },
        setSortOrder(order: PostDateSort): void {
          if (store.sortOrder() === order) {
            return;
          }

          patchState(store, {
            filtering: true,
            sortOrder: order,
            currentPage: 1,
          });
          loadPostsRx({ force: false, append: false });
        },
        setViewMode(mode: PostsListViewMode): void {
          if (store.viewMode() === mode) {
            return;
          }

          viewStorage.write(mode);
          patchState(store, {
            viewMode: mode,
            currentPage: 1,
          });
          loadPostsRx({ force: false, append: false });
        },
        setPage(page: number): void {
          const nextPage = Math.min(Math.max(1, page), store.totalPages());

          if (nextPage === store.currentPage()) {
            return;
          }

          patchState(store, { currentPage: nextPage });
          loadPostsRx({ force: false, append: false });
        },
        loadMore(): void {
          if (
            !store.hasMorePosts() ||
            store.loadingMore() ||
            store.loading() ||
            store.filtering()
          ) {
            return;
          }

          loadPostsRx({ force: false, append: true });
        },
        retry(): void {
          patchState(store, { currentPage: 1 });
          loadPostsRx({ force: true, append: false });
        },
      };
    },
  ),
);

function buildListQuery(
  store: {
    isInfiniteScrollMode: () => boolean;
    isPaginationMode: () => boolean;
    pageSize: number;
    searchQuery: () => string;
    sortOrder: () => PostDateSort;
  },
  page: number,
): PostsListQuery {
  const query = store.searchQuery().trim();
  const base: PostsListQuery = {
    status: POST_STATUS.approved,
    titleLike: query || undefined,
    sort: 'createdAt',
    order: store.sortOrder(),
  };

  if (store.isPaginationMode() || store.isInfiniteScrollMode()) {
    return {
      ...base,
      page,
      limit: store.pageSize,
    };
  }

  return base;
}

function appendPosts(current: Post[], incoming: Post[]): Post[] {
  const seen = new Set(current.map((post) => post.id));
  const next = incoming.filter((post) => !seen.has(post.id));

  return next.length === 0 ? current : [...current, ...next];
}

function hasActiveFilters(searchQuery: string): boolean {
  return searchQuery.trim().length > 0;
}
