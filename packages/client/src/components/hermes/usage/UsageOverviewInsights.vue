<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUsageStore } from '@/stores/hermes/usage'
import { formatUsageTokens, formatUsagePercent, USAGE_TOKEN_COLORS } from '@/utils/usage-display'

const { t, locale } = useI18n()
const store = useUsageStore()
function tokens(value: number) { return formatUsageTokens(value, locale?.value) }
const modelRows = computed(() => store.modelUsage.map(row => ({
  id: row.model, label: row.model === 'unknown' ? t('usage.agents.unknown') : row.model, totalTokens: row.totalTokens, color: row.color,
})).sort((a, b) => b.totalTokens - a.totalTokens || a.id.localeCompare(b.id)))
const topRows = computed(() => modelRows.value.slice(0, 5))
const ring = computed(() => ({ background: `conic-gradient(${USAGE_TOKEN_COLORS.cache} ${store.cacheHitRate ?? 0}%, var(--bg-secondary) 0)` }))
const rate = computed(() => store.cacheHitRate === null ? '—' : formatUsagePercent(store.cacheHitRate, locale?.value))
function share(value: number) { return store.totalTokens > 0 ? value / store.totalTokens * 100 : 0 }
</script>

<template>
  <div class="overview-lower-grid">
    <section class="overview-panel ranking-panel">
      <div class="panel-head">
        <div><h3>{{ t('usage.dashboard.rankTitle') }}</h3><p>{{ t('usage.dashboard.rankCount', { count: modelRows.length }) }}</p></div>
      </div>
      <div class="rank-list">
        <div v-for="(row, index) in topRows" :key="row.id" class="rank-row">
          <div class="rank-title"><span class="rank-number">{{ String(index + 1).padStart(2, '0') }}</span>
            <span class="rank-name">{{ row.label }}</span><strong>{{ tokens(row.totalTokens) }}</strong><span class="rank-share">{{ formatUsagePercent(share(row.totalTokens), locale) }}</span>
          </div>
          <div class="rank-track"><i :style="{ width: share(row.totalTokens) + '%', background: row.color }" /></div>
        </div>
        <p v-if="!topRows.length" class="rank-empty">{{ t('usage.dashboard.noMatches') }}</p>
      </div>
      <p class="rank-note">{{ t('usage.dashboard.rankNote') }}</p>
    </section>
    <section class="overview-panel cache-panel">
      <div class="panel-head"><div><h3>{{ t('usage.dashboard.cacheEfficiency') }}</h3><p>{{ t('usage.dashboard.cacheSubtitle') }}</p></div></div>
      <div class="cache-summary">
        <div class="cache-ring" :style="ring"><div><strong>{{ rate }}</strong><small>{{ t('usage.cacheHitRate') }}</small></div></div>
        <div class="cache-caption"><strong>{{ tokens(store.totalCacheTokens) }}</strong><p>{{ t('usage.cacheRead') }} {{ t('usage.tokens') }}</p></div>
      </div>
      <div class="cache-note"><p>{{ t('usage.dashboard.cacheNote') }}</p>
        <p v-if="modelRows[0]">{{ t('usage.dashboard.topModel', { model: modelRows[0].label }) }}</p>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;
.overview-lower-grid { display: grid; grid-template-columns: 1.6fr 1fr; gap: 24px; }
.overview-panel { min-width: 0; padding: 24px; border: 1px solid $border-color; border-radius: 12px; background: $bg-card; }
.panel-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 18px; h3 { margin: 0; color: $text-primary; font-size: 15px; font-weight: 600; } p { margin: 5px 0 0; color: $text-secondary; font-size: 11px; line-height: 1.6; } }
.rank-row { padding: 9px 0; color: $text-primary; }
.rank-title { display: flex; gap: 12px; align-items: center; font-size: 12px; font-variant-numeric: tabular-nums; strong { font-weight: 600; white-space: nowrap; flex-shrink: 0; } }
.rank-number { color: $text-muted; font-size: 10px; width: 20px; flex-shrink: 0; }
.rank-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rank-share { width: 44px; text-align: end; font-size: 11px; color: $text-secondary; }
.rank-track { height: 4px; margin: 10px 0 0 32px; background: $bg-secondary; border-radius: 3px; overflow: hidden;
  i { display: block; height: 100%; border-radius: inherit; }
}
.rank-note, .rank-empty { margin: 16px 0 0 32px; color: $text-secondary; font-size: 10px; line-height: 1.8; }
.cache-summary { display: flex; align-items: center; gap: 24px; padding: 4px 0 22px; }
.cache-ring { width: 108px; height: 108px; border-radius: 50%; padding: 8px; flex-shrink: 0;
  > div { height: 100%; background: $bg-card; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  strong { font-size: 23px; letter-spacing: -.8px; font-weight: 600; }
  small { max-width: 76px; margin-top: 5px; font-size: 10px; line-height: 1.25; text-align: center; color: $text-secondary; }
}
.cache-caption { min-width: 0; strong { font-size: 28px; letter-spacing: -1px; font-weight: 600; } p { margin: 5px 0 0; color: $text-secondary; font-size: 11px; } }
.cache-note { border-top: 1px solid $border-light; padding-top: 16px; color: $text-secondary; font-size: 12px; line-height: 1.8; p { margin: 0 0 4px; overflow-wrap: anywhere; } }
@media (max-width: 850px) { .overview-lower-grid { grid-template-columns: 1fr; gap: 20px; } }
@media (max-width: 480px) { .overview-panel { padding: 20px; } .rank-title { gap: 8px; } .panel-head { gap: 8px; } .cache-caption strong { font-size: 24px; white-space: nowrap; } }
</style>
