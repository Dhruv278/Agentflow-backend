import { BadRequestException } from '@nestjs/common';
import {
  buildDAG,
  topologicalSort,
  detectCycle,
  getParentIds,
} from '../dag-utils';

describe('DAG Utils', () => {
  describe('buildDAG', () => {
    it('should build a DAG from agents and connections', () => {
      const dag = buildDAG(
        ['a', 'b', 'c'],
        [
          { fromAgentId: 'a', toAgentId: 'b' },
          { fromAgentId: 'b', toAgentId: 'c' },
        ],
      );
      expect(dag.size).toBe(3);
      expect(dag.get('a')!.children).toEqual(['b']);
      expect(dag.get('b')!.parents).toEqual(['a']);
      expect(dag.get('c')!.parents).toEqual(['b']);
    });
  });

  describe('detectCycle', () => {
    it('should return false for a linear graph', () => {
      const dag = buildDAG(
        ['a', 'b', 'c'],
        [
          { fromAgentId: 'a', toAgentId: 'b' },
          { fromAgentId: 'b', toAgentId: 'c' },
        ],
      );
      expect(detectCycle(dag)).toBe(false);
    });

    it('should return true for a circular graph', () => {
      const dag = buildDAG(
        ['a', 'b'],
        [
          { fromAgentId: 'a', toAgentId: 'b' },
          { fromAgentId: 'b', toAgentId: 'a' },
        ],
      );
      expect(detectCycle(dag)).toBe(true);
    });

    it('should return true for a 3-node cycle', () => {
      const dag = buildDAG(
        ['a', 'b', 'c'],
        [
          { fromAgentId: 'a', toAgentId: 'b' },
          { fromAgentId: 'b', toAgentId: 'c' },
          { fromAgentId: 'c', toAgentId: 'a' },
        ],
      );
      expect(detectCycle(dag)).toBe(true);
    });

    it('should return false for disconnected nodes', () => {
      const dag = buildDAG(['a', 'b'], []);
      expect(detectCycle(dag)).toBe(false);
    });
  });

  describe('topologicalSort', () => {
    it('should sort a linear graph A→B→C', () => {
      const dag = buildDAG(
        ['a', 'b', 'c'],
        [
          { fromAgentId: 'a', toAgentId: 'b' },
          { fromAgentId: 'b', toAgentId: 'c' },
        ],
      );
      expect(topologicalSort(dag)).toEqual(['a', 'b', 'c']);
    });

    it('should handle fan-out A→[B,C]', () => {
      const dag = buildDAG(
        ['a', 'b', 'c'],
        [
          { fromAgentId: 'a', toAgentId: 'b' },
          { fromAgentId: 'a', toAgentId: 'c' },
        ],
      );
      const sorted = topologicalSort(dag);
      expect(sorted[0]).toBe('a');
      expect(sorted).toContain('b');
      expect(sorted).toContain('c');
    });

    it('should handle fan-in [A,B]→C', () => {
      const dag = buildDAG(
        ['a', 'b', 'c'],
        [
          { fromAgentId: 'a', toAgentId: 'c' },
          { fromAgentId: 'b', toAgentId: 'c' },
        ],
      );
      const sorted = topologicalSort(dag);
      expect(sorted.indexOf('c')).toBeGreaterThan(sorted.indexOf('a'));
      expect(sorted.indexOf('c')).toBeGreaterThan(sorted.indexOf('b'));
    });

    it('should throw BadRequestException for circular graph', () => {
      const dag = buildDAG(
        ['a', 'b'],
        [
          { fromAgentId: 'a', toAgentId: 'b' },
          { fromAgentId: 'b', toAgentId: 'a' },
        ],
      );
      expect(() => topologicalSort(dag)).toThrow(BadRequestException);
    });

    it('should handle single node with no connections', () => {
      const dag = buildDAG(['a'], []);
      expect(topologicalSort(dag)).toEqual(['a']);
    });

    it('should handle diamond A→B, A→C, B→D, C→D', () => {
      const dag = buildDAG(
        ['a', 'b', 'c', 'd'],
        [
          { fromAgentId: 'a', toAgentId: 'b' },
          { fromAgentId: 'a', toAgentId: 'c' },
          { fromAgentId: 'b', toAgentId: 'd' },
          { fromAgentId: 'c', toAgentId: 'd' },
        ],
      );
      const sorted = topologicalSort(dag);
      expect(sorted[0]).toBe('a');
      expect(sorted[sorted.length - 1]).toBe('d');
    });
  });

  describe('getParentIds', () => {
    it('should return parents for a node', () => {
      const dag = buildDAG(
        ['a', 'b', 'c'],
        [
          { fromAgentId: 'a', toAgentId: 'c' },
          { fromAgentId: 'b', toAgentId: 'c' },
        ],
      );
      expect(getParentIds(dag, 'c')).toEqual(['a', 'b']);
    });

    it('should return empty array for root node', () => {
      const dag = buildDAG(['a', 'b'], [{ fromAgentId: 'a', toAgentId: 'b' }]);
      expect(getParentIds(dag, 'a')).toEqual([]);
    });
  });
});
