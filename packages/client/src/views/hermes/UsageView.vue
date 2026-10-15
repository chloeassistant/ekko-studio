<script setup lang="ts">
import PageLoading from '@/components/common/PageLoading.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import { NButton, NSelect } from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUsageStore } from '@/stores/hermes/usage'
import { useProfilesStore } from '@/stores/hermes/profiles'
import StatCards from '@/components/hermes/usage/StatCards.vue'
import UsageOverviewInsights from '@/components/hermes/usage/UsageOverviewInsights.vue'
import type { UsageStatsFilters } from '@/api/studio/sessions'
import DailyTrend from '@/components/hermes/usage/DailyTrend.vue'
import UsagePricing from '@/components/hermes/usage/UsagePricing.vue'

const { t } = useI18n()
const usageStore = useUsageStore()
const profilesStore = useProfilesStore()

const periodOptions = [
  { days: 1 },
  { days: 7 },
  { days: 30 },
  { days: 90 },
  { days: 365 },
] as const

const selectedPeriod = ref(30)
const filters = ref<UsageStatsFilters>({})
const profileScope = computed(() => filters.value.profile || t('usage.dashboard.allProfiles'))
const profileOptions = computed(() => [
  { label: t('usage.dashboard.allProfiles'), value: '' },
  ...profilesStore.profiles.map(profile => ({ label: profile.name, value: profile.name })),
])
const accountOptions = computed(() => {
  const accounts = usageStore.stats?.filter_options?.accounts || []
  const options = [
    { label: t('usage.dashboard.allAccounts'), value: '' },
    ...accounts.map(account => ({ label: `${account.username} · #${account.id}`, value: account.id })),
    { label: t('usage.dashboard.unassigned'), value: 'unassigned' },
  ]
  // Keep the selection readable when another Profile has no usage for this account.
  if (filters.value.account && !options.some(option => option.value === filters.value.account)) {
    options.splice(1, 0, { label: `#${filters.value.account}`, value: filters.value.account })
  }
  return options
})

async function ensureProfileSelection() {
  if (profilesStore.profiles.length === 0) {
    await profilesStore.fetchProfiles()
  }
}

async function loadUsage(days = selectedPeriod.value) {
  selectedPeriod.value = days
  await ensureProfileSelection()
  if (Object.values(filters.value).some(Boolean)) await usageStore.loadSessions(days, { ...filters.value })
  else await usageStore.loadSessions(days)
}

function applyFilters(value: UsageStatsFilters) {
  filters.value = value
  void loadUsage()
}

const initializing = ref(true)

onMounted(() => {
  void loadUsage(30).finally(() => { initializing.value = false })
})
</script>

<template>
  <PageLoading :show="initializing" class="usage-view">
    <PageHeader>
    <header class="page-header">
      <h2 class="header-title">{{ t('usage.title') }}</h2>
      <div class="usage-toolbar">
        <NButton class="refresh-button" size="small" quaternary :loading="usageStore.isLoading" @click="loadUsage()">
          {{ t('usage.refresh') }}
        </NButton>
      </div>
    </header>
    </PageHeader>

    <div class="usage-content" :aria-busy="usageStore.isLoading">
      <div class="overview-heading"><p>{{ t('usage.dashboard.overviewSubtitle') }}</p><span>{{ selectedPeriod === 1 ? t('usage.dashboard.todaySummary') : t('usage.dashboard.periodSummary', { days: selectedPeriod }) }} · {{ profileScope }}</span></div>
      <div class="overview-controls" :aria-label="t('usage.dashboard.filters')">
        <div class="period-selector" role="group" :aria-label="t('usage.dashboard.period')">
          <NButton v-for="option in periodOptions" :key="option.days" class="period-option" size="small"
            :type="selectedPeriod === option.days ? 'primary' : 'default'" :secondary="selectedPeriod === option.days"
            :quaternary="selectedPeriod !== option.days" :aria-pressed="selectedPeriod === option.days" @click="loadUsage(option.days)">
            {{ option.days === 1 ? t('usage.dashboard.today') : t('usage.dashboard.periodLabel', { days: option.days }) }}
          </NButton>
        </div>
        <NSelect class="account-filter" :value="filters.account || ''" :input-props="{ 'aria-label': t('usage.dashboard.account') }"
          :options="accountOptions" filterable
          @update:value="applyFilters({ ...filters, account: $event || undefined })" />
        <NSelect class="profile-filter" :value="filters.profile || ''" :input-props="{ 'aria-label': t('usage.dashboard.profile') }"
          :options="profileOptions" filterable
          @update:value="applyFilters({ ...filters, profile: $event || undefined })" />
        <UsagePricing :profile="filters.profile" />
      </div>
      <p class="account-note">{{ t('usage.dashboard.accountScope') }}</p>
      <div v-if="usageStore.isLoading" class="usage-loading" role="status">{{ t('common.loading') }}</div>
      <div v-else-if="usageStore.loadError" class="usage-empty" role="alert">{{ t('usage.dashboard.loadFailed') }}</div>
      <div v-if="usageStore.hasData && !usageStore.loadError" v-show="!usageStore.isLoading" class="overview-results">
        <StatCards />
        <DailyTrend />
        <UsageOverviewInsights />
      </div>

      <div v-if="!usageStore.isLoading && !usageStore.loadError && !usageStore.hasData" class="usage-empty">
        {{ Object.values(filters).some(Boolean) ? t('usage.dashboard.noMatches') : t('usage.noData') }}
      </div>
    </div>
  </PageLoading>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.usage-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.usage-toolbar,
.period-selector,
.overview-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.period-selector {
  gap: 4px;
  flex-shrink: 0;
}

.usage-content {
  flex: 1;
  overflow-y: auto;
  padding: 28px;
  max-width: 1140px;
  margin: 0 auto;
  width: 100%;
  scrollbar-width: none;
  -ms-overflow-style: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.overview-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; color: $text-secondary; font-size: 12px; p { margin: 0; } span { font-size: 11px; } }
.overview-controls { gap: 12px; flex-wrap: nowrap; overflow-x: auto; padding: 2px 0 6px; > * { flex-shrink: 0; } }
.account-filter, .profile-filter { width: 180px; }
.account-note { font-size: 11px; color: $text-secondary; margin: 6px 0 22px; line-height: 1.6; }
.overview-results > :deep(.daily-trend) { margin-bottom: 24px; }

.usage-loading,
.usage-empty {
  text-align: center;
  padding: 60px 0;
  color: $text-muted;
  font-size: 14px;
}

@media (max-width: $breakpoint-mobile) {
  .usage-content { padding: 22px 18px; }
  .overview-heading { flex-wrap: wrap; gap: 6px; }
  .account-filter, .profile-filter { width: 160px; }
}
</style>
