import { Component, computed, inject, OnInit } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../../../core/auth/services/auth.service';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { ErrorStateComponent } from '../../../../shared/components/error-state/error-state.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { PostsFiltersComponent } from '../../components/posts-filters/posts-filters.component';
import { PostsLoadingStateComponent } from '../../components/posts-loading-state/posts-loading-state.component';
import { PostsPaginationComponent } from '../../components/posts-pagination/posts-pagination.component';
import { PostsTableComponent } from '../../components/posts-table/posts-table.component';
import { PostsListStore } from '../../store/posts-list.store';

export type PostsListViewState = 'loading' | 'error' | 'empty' | 'content';

@Component({
  selector: 'app-posts-list-page',
  imports: [
    RouterLink,
    TranslatePipe,
    PostsFiltersComponent,
    PostsPaginationComponent,
    PostsTableComponent,
    PostsLoadingStateComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    PageHeaderComponent,
  ],
  providers: [PostsListStore],
  templateUrl: './posts-list.page.html',
  styleUrl: './posts-list.page.scss',
})
export class PostsListPage implements OnInit {
  public readonly store = inject(PostsListStore);
  public readonly auth = inject(AuthService);

  public readonly viewState = computed<PostsListViewState>(() => {
    if (this.store.loading() && this.store.posts().length === 0) {
      return 'loading';
    }

    if (this.store.error()) {
      return 'error';
    }

    if (this.store.isEmpty()) {
      return 'empty';
    }

    return 'content';
  });

  public ngOnInit(): void {
    this.store.loadPosts();
  }
}
