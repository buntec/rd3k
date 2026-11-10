import { describe, expect, it } from 'vitest';
import { type Group, exportGroups, mergeGroups, parseGroupsFile, readGroup } from './groups';

const tech: Group = { id: 'a', name: 'Tech', color: 'blue', subreddits: ['programming', 'rust'] };

describe('groups files', () => {
  it('read back what was exported, without IDs', () => {
    expect(parseGroupsFile(exportGroups([tech]))).toEqual([{ name: 'Tech', color: 'blue', subreddits: ['programming', 'rust'] }]);
  });

  it("reject what isn't one", () => {
    expect(() => parseGroupsFile('{"format":"yt3k-groups-1","groups":[]}')).toThrow('Not a groups file');
    expect(() => parseGroupsFile('[]')).toThrow();
  });
});

describe('readGroup', () => {
  it('cleans up names, colors and subreddits', () => {
    expect(readGroup({ name: ' News ', color: 'chartreuse', subreddits: ['WorldNews', 'r/worldnews', '/r/Europe'] })).toEqual({
      name: 'News',
      color: 'blue',
      subreddits: ['worldnews', 'europe'],
    });
  });

  it("returns undefined for what isn't a group", () => {
    expect(readGroup({ name: '', subreddits: [] })).toBeUndefined();
    expect(readGroup({ name: 'x', subreddits: [1] })).toBeUndefined();
    expect(readGroup(null)).toBeUndefined();
  });
});

describe('mergeGroups', () => {
  it('adds new groups and merges those of the same name, ignoring case', () => {
    const merged = mergeGroups([tech], [
      { name: 'tech', color: 'red', subreddits: ['rust', 'golang'] },
      { name: 'Pics', color: 'green', subreddits: ['pics'] },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({ id: 'a', name: 'Tech', color: 'red', subreddits: ['programming', 'rust', 'golang'] });
    expect(merged[1]).toMatchObject({ name: 'Pics', subreddits: ['pics'] });
  });
});
