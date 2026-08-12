/**
 * The SEO engine — one import surface for API, buyer, seller, and admin.
 *
 * Nothing in this directory imports Prisma, Next, or React: it is pure data
 * transformation. That is deliberate. The same functions therefore run in a
 * NestJS request, a CLI backfill, a Next.js server component, and a Jest test,
 * which is what makes "SEO belongs to the domain, not to the page" true in
 * practice rather than as an aspiration.
 *
 * See docs/SEO_ARCHITECTURE.md for the generation rules and how new entities
 * inherit them.
 */

export * from './config';
export * from './types';
export * from './text';
export * from './slug';
export * from './url';
export * from './indexability';
export * from './metadata';
export * from './image';
export * from './taxonomy';
export * from './breadcrumbs';
export * from './schema';
export * from './internal-links';
export * from './document';
export * from './validate';
export * from './sitemap';
