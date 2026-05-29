import { filterCommunityResultActions } from '../../assistant/pipeline/pipeline.helpers.js';
import type { AiAssistantClientAction } from '../../shared/types/assistant.types.js';

const communityAction: AiAssistantClientAction = {
  type: 'show_community_results',
  payload: {
    source: 'search_communities',
    query: '*',
    communities: [
      {
        resultKey: 'C1',
        groupId: 'g1',
        communityId: 'c1',
        name: 'Hamtech',
        description: null,
        memberCount: 1,
        type: 'public',
      },
      {
        resultKey: 'C2',
        groupId: 'g2',
        communityId: 'c2',
        name: 'Cong nghe',
        description: null,
        memberCount: 2,
        type: 'public',
      },
    ],
  },
};

describe('filterCommunityResultActions', () => {
  it('keeps only selected community cards', () => {
    const actions = filterCommunityResultActions([communityAction], ['C2']);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'show_community_results',
      payload: {
        communities: [expect.objectContaining({ resultKey: 'C2', name: 'Cong nghe' })],
      },
    });
  });

  it('falls back to one card instead of showing every community', () => {
    const actions = filterCommunityResultActions([communityAction], []);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'show_community_results',
      payload: {
        communities: [expect.objectContaining({ resultKey: 'C1', name: 'Hamtech' })],
      },
    });
  });
});
