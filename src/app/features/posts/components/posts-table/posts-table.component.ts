import { DatePipe, NgTemplateOutlet } from '@angular/common';
import {
  CdkFixedSizeVirtualScroll,
  CdkVirtualForOf,
  CdkVirtualScrollViewport,
} from '@angular/cdk/scrolling';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  Injector,
  input,
  output,
  signal,
  TrackByFunction,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../../../core/auth/services/auth.service';
import { LocaleService } from '../../../../core/i18n/locale.service';
import { TranslatePipe } from '@ngx-translate/core';
import { Post } from '../../models/post.model';
import { POST_STATUS } from '../../models/post-status.model';
import { getPostDetailsQueryParams, PostNavigationSource } from '../../utils/post-navigation.utils';

const POSTS_TABLE_MOBILE_MAX = 849;
const DESKTOP_ROW_SIZE = 88;
const MOBILE_ROW_SIZE = 208;
const NEAR_END_BUFFER = 5;

@Component({
  selector: 'app-posts-table',
  imports: [
    CdkFixedSizeVirtualScroll,
    CdkVirtualForOf,
    CdkVirtualScrollViewport,
    DatePipe,
    NgTemplateOutlet,
    RouterLink,
    TranslatePipe,
  ],
  templateUrl: './posts-table.component.html',
  styleUrl: './posts-table.component.scss',
})
export class PostsTableComponent {
  protected readonly auth = inject(AuthService);
  protected readonly locale = inject(LocaleService);
  private readonly viewport = viewChild(CdkVirtualScrollViewport);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  public readonly posts = input.required<Post[]>();
  public readonly virtualScroll = input(false);
  public readonly scrollGeneration = input(0);
  public readonly nearEnd = output<void>();
  public readonly itemSize = signal(DESKTOP_ROW_SIZE);
  public readonly showAdminActions = input(true);
  public readonly enableOwnerEdit = input(false);
  public readonly enableOwnerResubmit = input(false);
  public readonly ownerId = input<string | null>(null);
  public readonly detailsFrom = input<PostNavigationSource>();
  public readonly detailsTab = input<string | null>(null);
  public readonly showRejectionCallout = input(false);

  public readonly detailsQueryParams = computed(() =>
    getPostDetailsQueryParams(this.detailsFrom(), this.detailsTab()),
  );

  public readonly ownerEditQueryParams = computed(() => {
    const tab = this.detailsTab();

    return tab ? { from: 'my-posts' as const, tab } : { from: 'my-posts' as const };
  });

  public readonly trackPost: TrackByFunction<Post> = (_index, post) => post.id;

  constructor() {
    this.watchRowSize();

    effect(() => {
      const generation = this.scrollGeneration();

      if (!this.virtualScroll()) {
        return;
      }

      afterNextRender(
        () => {
          this.viewport()?.scrollToIndex(0, 'auto');
          this.syncScrollbarGap();
          this.emitNearEndIfNeeded();
        },
        { injector: this.injector },
      );
      void generation;
    });

    effect(() => {
      const length = this.posts().length;
      const size = this.itemSize();

      if (!this.virtualScroll() || length === 0) {
        return;
      }

      afterNextRender(
        () => {
          this.syncScrollbarGap();
          this.emitNearEndIfNeeded();
        },
        { injector: this.injector },
      );
      void size;
    });
  }

  public onScrolledIndexChange(): void {
    this.emitNearEndIfNeeded();
  }

  public canOwnerEdit(post: Post): boolean {
    const ownerId = this.ownerId();
    return (
      this.enableOwnerEdit() &&
      ownerId !== null &&
      post.submittedBy === ownerId &&
      post.status === POST_STATUS.approved
    );
  }

  public canOwnerResubmit(post: Post): boolean {
    const ownerId = this.ownerId();
    return (
      this.enableOwnerResubmit() &&
      ownerId !== null &&
      post.submittedBy === ownerId &&
      post.status === POST_STATUS.rejected
    );
  }

  private watchRowSize(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const query = window.matchMedia(`(max-width: ${POSTS_TABLE_MOBILE_MAX}px)`);
    const apply = (): void => {
      this.itemSize.set(query.matches ? MOBILE_ROW_SIZE : DESKTOP_ROW_SIZE);
      afterNextRender(
        () => {
          this.viewport()?.checkViewportSize();
          this.syncScrollbarGap();
        },
        { injector: this.injector },
      );
    };

    apply();
    query.addEventListener('change', apply);
    this.destroyRef.onDestroy(() => query.removeEventListener('change', apply));
  }

  private emitNearEndIfNeeded(): void {
    if (!this.virtualScroll()) {
      return;
    }

    const viewport = this.viewport();
    const length = this.posts().length;

    if (!viewport || length === 0) {
      return;
    }

    const renderedEnd = viewport.getRenderedRange().end;
    const contentShorterThanViewport = length * this.itemSize() <= viewport.getViewportSize();

    if (contentShorterThanViewport || renderedEnd >= length - NEAR_END_BUFFER) {
      this.nearEnd.emit();
    }
  }

  private syncScrollbarGap(): void {
    const element = this.viewport()?.elementRef.nativeElement;

    if (!element) {
      return;
    }

    const gap = element.offsetWidth - element.clientWidth;
    element.parentElement?.style.setProperty('--posts-table-scrollbar', `${gap}px`);
  }
}
