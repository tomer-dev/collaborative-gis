import { describe, expect, it } from 'vitest';
import { laneDatabase } from './lane';

describe('laneDatabase', () => {
  it('suffixes the base name with the lane, as a Postgres identifier', () => {
    expect(laneDatabase('cgis_auth', 'm2/integration')).toBe('cgis_auth_m2_integration');
    expect(laneDatabase('cgis_api', 'Feature/Web-Map.2')).toBe('cgis_api_feature_web_map_2');
  });

  it('keeps the base name when there is no lane', () => {
    expect(laneDatabase('cgis_db', '')).toBe('cgis_db');
    expect(laneDatabase('cgis_db', '//')).toBe('cgis_db');
  });

  it('stays within the 63-byte identifier limit', () => {
    const name = laneDatabase('cgis_retention', `worktree-agent-${'a'.repeat(60)}`);
    expect(name).toHaveLength(63);
    expect(name).toMatch(/^cgis_retention_worktree_agent_a+$/);
  });
});
