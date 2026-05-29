import {
  BATCH_CONFIRM_TOOL_NAME,
  buildPendingConfirmedTools,
  getPendingConfirmedToolCalls,
} from '../../assistant/tools/confirmation.js';

describe('confirmation tool batches', () => {
  it('keeps non-confirm tools in a mixed confirmed batch', () => {
    const pending = buildPendingConfirmedTools([
      { name: 'search_communities', args: { query: 'HamTech' } },
      { name: 'search_users', args: { query: 'Hiền' } },
    ]);

    expect(pending.toolName).toBe(BATCH_CONFIRM_TOOL_NAME);
    expect(getPendingConfirmedToolCalls(pending)).toEqual([
      { name: 'search_communities', args: { query: 'HamTech' } },
      { name: 'search_users', args: { query: 'Hiền' } },
    ]);
  });
});
