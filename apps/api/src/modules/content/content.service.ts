import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

const FALLBACK_HANDLING_DAYS = 3;

export type BlogStatus = 'DRAFT' | 'PUBLISHED';

export interface BlogPostInput {
  title?: string;
  slug?: string;
  excerpt?: string | null;
  content?: string;
  coverImageUrl?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  status?: BlogStatus;
}

function clean(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function slugify(value: string) {
  return clean(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function nullable(value: string | null | undefined) {
  const result = clean(value);
  return result || null;
}

@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublishedPosts() {
    return this.prisma.blogPost.findMany({
      where: { status: 'PUBLISHED', publishedAt: { not: null } },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        title: true,
        slug: true,
        excerpt: true,
        coverImageUrl: true,
        seoTitle: true,
        seoDescription: true,
        publishedAt: true,
        updatedAt: true,
      },
    });
  }

  async getPublishedPost(slug: string) {
    const post = await this.prisma.blogPost.findFirst({
      where: {
        slug: slugify(slug),
        status: 'PUBLISHED',
        publishedAt: { not: null },
      },
      select: {
        id: true,
        title: true,
        slug: true,
        excerpt: true,
        content: true,
        coverImageUrl: true,
        seoTitle: true,
        seoDescription: true,
        publishedAt: true,
        updatedAt: true,
      },
    });
    if (!post) throw new NotFoundException('Blog post not found');
    return post;
  }

  async listAdminPosts() {
    return this.prisma.blogPost.findMany({ orderBy: { updatedAt: 'desc' } });
  }

  async getAdminPost(id: string) {
    const post = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Blog post not found');
    return post;
  }

  async createPost(input: BlogPostInput) {
    const title = clean(input.title);
    const content = clean(input.content);
    if (!title || !content) {
      throw new BadRequestException('Title and content are required');
    }

    const slug = await this.uniqueSlug(input.slug || title);
    const status = input.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT';

    return this.prisma.blogPost.create({
      data: {
        title,
        slug,
        excerpt: nullable(input.excerpt),
        content,
        coverImageUrl: nullable(input.coverImageUrl),
        seoTitle: nullable(input.seoTitle),
        seoDescription: nullable(input.seoDescription),
        status,
        publishedAt: status === 'PUBLISHED' ? new Date() : null,
      },
    });
  }

  async updatePost(id: string, input: BlogPostInput) {
    const existing = await this.getAdminPost(id);
    const title =
      input.title === undefined ? existing.title : clean(input.title);
    const content =
      input.content === undefined ? existing.content : clean(input.content);

    if (!title || !content) {
      throw new BadRequestException('Title and content are required');
    }

    const slug =
      input.slug === undefined || !clean(input.slug)
        ? existing.slug
        : await this.uniqueSlug(input.slug, id);
    const status =
      input.status === undefined
        ? (existing.status as BlogStatus)
        : input.status === 'PUBLISHED'
          ? 'PUBLISHED'
          : 'DRAFT';

    return this.prisma.blogPost.update({
      where: { id },
      data: {
        title,
        slug,
        excerpt:
          input.excerpt === undefined
            ? existing.excerpt
            : nullable(input.excerpt),
        content,
        coverImageUrl:
          input.coverImageUrl === undefined
            ? existing.coverImageUrl
            : nullable(input.coverImageUrl),
        seoTitle:
          input.seoTitle === undefined
            ? existing.seoTitle
            : nullable(input.seoTitle),
        seoDescription:
          input.seoDescription === undefined
            ? existing.seoDescription
            : nullable(input.seoDescription),
        status,
        publishedAt:
          status === 'PUBLISHED' ? existing.publishedAt || new Date() : null,
      },
    });
  }

  async deletePost(id: string) {
    await this.getAdminPost(id);
    await this.prisma.blogPost.delete({ where: { id } });
    return { deleted: true };
  }

  async getShippingPolicy() {
    let handlingDays = [FALLBACK_HANDLING_DAYS];
    let handlingSource = 'published listing policy';

    try {
      const offers = await this.prisma.sellerOffer.findMany({
        where: {
          seller: { onboardingStatus: 'ACTIVE' },
          status: 'ACTIVE',
          leadTimeDays: { not: null },
        },
        select: { leadTimeDays: true },
        take: 10_000,
      });
      const offerDays = offers
        .map(({ leadTimeDays }) => leadTimeDays)
        .filter(
          (days): days is number =>
            days !== null && Number.isInteger(days) && days >= 0,
        );

      if (offerDays.length) {
        handlingDays = offerDays;
        handlingSource = 'active offer data';
      } else {
        const profiles = await this.prisma.sellerProfile.findMany({
          where: { seller: { onboardingStatus: 'ACTIVE' } },
          select: { fulfillmentSlaHours: true },
        });
        const profileDays = profiles
          .map(({ fulfillmentSlaHours }) => Math.ceil(fulfillmentSlaHours / 24))
          .filter((days) => Number.isInteger(days) && days >= 0);

        if (profileDays.length) {
          handlingDays = profileDays;
          handlingSource = 'active seller fulfillment data';
        }
      }
    } catch {
      // The fallback is the verified production listing statement. It keeps
      // the policy page available during a rolling deploy/schema transition.
    }

    const minDays = Math.min(...handlingDays);
    const maxDays = Math.max(...handlingDays);

    return {
      cutoffTime: '2:00 PM',
      timezone: 'Gulf Standard Time (GST, UTC+4)',
      fulfillmentDays: 'Monday-Saturday',
      handling: {
        minDays,
        maxDays,
        label:
          minDays === maxDays
            ? String(minDays) + ' working day' + (minDays === 1 ? '' : 's')
            : String(minDays) + ' to ' + String(maxDays) + ' working days',
        source: handlingSource,
      },
      delivery: {
        regions: 'Worldwide to most countries',
        carriers: ['DHL', 'FedEx', 'Aramex'],
        note: 'Transit times vary by destination, service, item size, and carrier availability.',
      },
      duties:
        'Import duties, taxes, and other destination charges are not included unless expressly shown at checkout.',
    };
  }

  private async uniqueSlug(value: string, excludeId?: string) {
    const base = slugify(value);
    if (!base) throw new BadRequestException('A usable slug is required');

    let candidate = base;
    let suffix = 2;

    while (true) {
      const existing = await this.prisma.blogPost.findUnique({
        where: { slug: candidate },
      });
      if (!existing || existing.id === excludeId) return candidate;
      candidate = (base + '-' + suffix++).slice(0, 100);
    }
  }
}
