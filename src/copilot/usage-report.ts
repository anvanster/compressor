import type { SavingsShare, UsageSummary } from './usage.ts';
import { cacheHitRate, usageAiu } from './usage.ts';
import type { DebugLogProbe } from './debug-log.ts';
import { cardHtml, fmt, kpiHtml } from '../ledger/report.ts';
import type { Kpi } from '../ledger/report.ts';
import { AI_CREDIT_USD } from '../pricing/rates.ts';
import { formatUsd } from '../ledger/valuation.ts';

// Renders the actual-usage section: what Copilot really sent, beside what
// compressor removed. Kept apart from ledger/report.ts because it answers a
// different question from a different source — the ledger is cross-agent and
// estimated, this is Copilot-only and provider-reported, and the two must stay
// visibly distinct even though they appear in one document.
//
// PURE: no fs, no process.

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

/**
 * Empty-state text, chosen from what the probe saw rather than from the absence
 * of a total. "No requests" and "requests exist but their token counters moved"
 * need different actions from the reader, and a single "no data" message would
 * hide the second case entirely.
 */
export function usageEmptyStateHtml(probe: DebugLogProbe, settingId: string): string {
  const requests = probe.byType['llm_request'] ?? 0;
  if (probe.entries === 0) {
    return (
      '<p class="empty">No chat debug logs for this workspace. Enable ' +
      `<code>${escapeHtml(settingId)}</code> and reload the window — logging is not ` +
      'retroactive, so only sessions after that are recorded.</p>'
    );
  }
  if (requests === 0) {
    return (
      `<p class="empty">Chat debug logs exist (${fmt(probe.entries)} entries) but record no model ` +
      'requests yet. Use chat in this workspace and reopen this report.</p>'
    );
  }
  return (
    `<p class="empty">Found ${fmt(requests)} model requests, but none reported token counts. ` +
    (probe.unknownSchema
      ? 'The logs use a newer schema than this build understands — compressor needs an update.'
      : `Attributes seen: <code>${escapeHtml((probe.attrsByType['llm_request'] ?? []).join(', '))}</code>.`) +
    '</p>'
  );
}

/** "totals are a floor" note, present only when something went unreported. */
function floorNote(summary: UsageSummary): string {
  const { inputUnknown, outputUnknown, aiuUnknown, requests } = summary.totals;
  if (inputUnknown === 0 && outputUnknown === 0 && aiuUnknown === 0) {
    return '';
  }
  return (
    `<p class="footer">Floor, not a total: of ${fmt(requests)} requests, ` +
    `${fmt(inputUnknown)} reported no input count, ${fmt(outputUnknown)} no output count and ` +
    `${fmt(aiuUnknown)} no billed amount. Unreported counters are excluded rather than assumed zero.</p>`
  );
}

/**
 * The comparison the two data sources exist to support.
 *
 * Stated as a range of certainty rather than a bare percentage: the numerator
 * is an estimate and the denominator a measurement, so the figure indicates a
 * magnitude and must not be read as a measured reduction.
 */
export function savingsShareHtml(share: SavingsShare): string {
  if (share.savedTokens <= 0 || share.sentInputTokens <= 0) {
    return '';
  }
  const percent = (share.share * 100).toFixed(1);
  const qualifier =
    share.sentUnknownRequests > 0
      ? ' The sent total omits requests that reported no count, so the real share is lower.'
      : '';
  return cardHtml(
    'reduction in context',
    `<p class="totals">≈${percent}% of the prompt tokens Copilot would have sent were removed ` +
      `before sending — ≈${fmt(share.savedTokens)} removed against ${fmt(share.sentInputTokens)} ` +
      'actually sent.</p>\n' +
      '<p class="footer">Mixed units, so treat this as an indication: the removed figure is this ' +
      "project's estimator, the sent figure is the provider's own count." +
      `${qualifier}</p>`,
    true,
  );
}

/** Actual usage for the window: KPI row, model mix table and the caveats. */
export function usageHtml(summary: UsageSummary, windowLabel: string): string {
  const { totals } = summary;
  const rows = summary.byModel
    .map(
      (model) =>
        `<tr><td>${escapeHtml(model.model)}</td><td>${fmt(model.requests)}</td>` +
        `<td>${fmt(model.inputTokens)}</td><td>${fmt(model.cachedTokens)}</td>` +
        `<td>${fmt(model.outputTokens)}</td><td>${formatUsd(usageAiu(model) * AI_CREDIT_USD)}</td></tr>`,
    )
    .join('');
  const aiu = usageAiu(totals);
  const cached = cacheHitRate(totals);
  const kpis: Kpi[] = [
    { value: fmt(totals.requests), label: 'requests', hint: windowLabel },
    { value: fmt(totals.inputTokens), label: 'prompt tokens', hint: 'reported' },
    { value: fmt(totals.outputTokens), label: 'output tokens', hint: 'reported' },
    { value: fmt(summary.sessions), label: 'chat sessions' },
  ];
  if (totals.aiuUnknown < totals.requests) {
    kpis.unshift({
      value: formatUsd(aiu * AI_CREDIT_USD),
      label: 'billed',
      hint: `${fmt(aiu)} AI Units`,
    });
  }
  if (cached !== undefined) {
    kpis.push({ value: `${(cached * 100).toFixed(1)}%`, label: 'prompt cached', hint: 'cache reads' });
  }
  const cacheNote =
    cached === undefined
      ? ''
      : '<p class="footer">Cache reads bill at a fraction of a fresh prompt token, which is why ' +
        'the billed total sits far below what a rate card applied to raw token counts would ' +
        'suggest.</p>';
  const errors = summary.errors === 0 ? '' : `<p class="footer">${fmt(summary.errors)} requests failed.</p>`;
  return (
    '<h2 class="section">actual Copilot usage</h2>\n' +
    kpiHtml(kpis) +
    '<div class="grid">' +
    cardHtml(
      'by model',
      '<table><thead><tr><th>model</th><th>requests</th><th>prompt</th><th>cached</th>' +
        '<th>output</th><th>billed</th></tr></thead><tbody>' +
        rows +
        '</tbody></table>',
      true,
    ) +
    cardHtml(
      'how these numbers were obtained',
      cacheNote +
        floorNote(summary) +
        errors +
        '<p class="footer">Counts and charges reported by the provider in this workspace\u2019s ' +
        'chat debug logs — these are real usage, unlike the estimated ledger figures above.</p>',
      true,
    ) +
    '</div>'
  );
}
