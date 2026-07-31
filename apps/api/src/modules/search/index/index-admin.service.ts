/**
 * Index lifecycle management (brief §19).
 *
 * The application only ever reads and writes through the `parts_search` alias.
 * Physical indices are versioned (`canonical_parts_v2`, `_v3`, …), which gives:
 *
 *  - zero-downtime reindexing — build the new index, then swap the alias in a
 *    single atomic action;
 *  - instant rollback — swap the alias back, no data movement;
 *  - index versioning — the mapping version is part of the index name.
 *
 * This replaces the previous `ensureIndex()` approach, which could only apply
 * its mapping when creating a brand-new index and therefore never applied it at
 * all in production. See docs/SEARCH_PHASE1_AUDIT.md §4 RC-2.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { Client } from '@opensearch-project/opensearch';
import {
  SEARCH_ALIAS,
  SEARCH_INDEX_VERSION,
  buildIndexBody,
  physicalIndexName,
} from './search-index.schema';

@Injectable()
export class IndexAdminService {
  private readonly logger = new Logger(IndexAdminService.name);

  constructor(private readonly client: Client) {}

  /** True when the index physically exists. */
  async indexExists(index: string): Promise<boolean> {
    try {
      const response = await this.client.indices.exists({ index });
      return Boolean((response as any)?.body ?? response);
    } catch (error: any) {
      this.logger.warn(`indexExists(${index}) failed: ${error?.message}`);
      return false;
    }
  }

  /** Create a versioned index with the full settings + mapping. Idempotent. */
  async createIndex(version = SEARCH_INDEX_VERSION): Promise<string> {
    const index = physicalIndexName(version);
    if (await this.indexExists(index)) {
      this.logger.log(`Index ${index} already exists`);
      return index;
    }
    await this.client.indices.create({ index, body: buildIndexBody() as any });
    this.logger.log(`Created ${index}`);
    return index;
  }

  /** The physical index the alias currently points at, if any. */
  async resolveAlias(alias = SEARCH_ALIAS): Promise<string | null> {
    try {
      const response = await this.client.indices.getAlias({ name: alias });
      const names = Object.keys((response as any).body ?? {});
      return names[0] ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Point the alias at `index`, removing it from every other index in one
   * atomic `_aliases` action. Readers never see zero or two targets.
   */
  async swapAlias(index: string, alias = SEARCH_ALIAS): Promise<void> {
    const current = await this.resolveAlias(alias);
    const actions: any[] = [];
    if (current && current !== index) {
      actions.push({ remove: { index: current, alias } });
    }
    actions.push({ add: { index, alias } });

    await this.client.indices.updateAliases({ body: { actions } });
    this.logger.log(
      `Alias ${alias}: ${current ?? '(none)'} → ${index} (atomic swap)`,
    );
  }

  /**
   * Prepare an index for a bulk rebuild: disable refresh and replicas so the
   * write path is not doing per-document merge work. Restored by `finishBulk`.
   */
  async beginBulk(index: string): Promise<void> {
    await this.client.indices.putSettings({
      index,
      body: { 'index.refresh_interval': '-1', 'index.number_of_replicas': 0 },
    });
  }

  /** Restore normal serving settings and make everything searchable. */
  async finishBulk(index: string, replicas = 0): Promise<void> {
    await this.client.indices.putSettings({
      index,
      body: {
        'index.refresh_interval': '1s',
        'index.number_of_replicas': replicas,
      },
    });
    await this.client.indices.refresh({ index });
  }

  async countDocs(index: string): Promise<number> {
    try {
      const response = await this.client.count({ index });
      return Number((response as any).body?.count ?? 0);
    } catch {
      return 0;
    }
  }

  /**
   * Guard against promoting a broken rebuild. The new index must hold at least
   * `minRatio` of the current index's documents before the alias moves.
   */
  async verifyBeforeSwap(
    candidate: string,
    minRatio = 0.95,
  ): Promise<{ ok: boolean; candidateDocs: number; currentDocs: number; reason?: string }> {
    const current = await this.resolveAlias();
    const candidateDocs = await this.countDocs(candidate);
    const currentDocs = current ? await this.countDocs(current) : 0;

    if (candidateDocs === 0) {
      return { ok: false, candidateDocs, currentDocs, reason: 'candidate index is empty' };
    }
    if (currentDocs > 0 && candidateDocs < currentDocs * minRatio) {
      return {
        ok: false,
        candidateDocs,
        currentDocs,
        reason: `candidate has ${candidateDocs} docs vs ${currentDocs} live (< ${minRatio * 100}%)`,
      };
    }
    return { ok: true, candidateDocs, currentDocs };
  }

  /** Delete a retired version. Never callable against the aliased index. */
  async dropIndex(index: string): Promise<void> {
    const live = await this.resolveAlias();
    if (index === live) {
      throw new Error(`Refusing to drop ${index}: it is currently serving ${SEARCH_ALIAS}`);
    }
    await this.client.indices.delete({ index });
    this.logger.log(`Dropped ${index}`);
  }
}
