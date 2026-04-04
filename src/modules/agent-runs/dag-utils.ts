import { BadRequestException } from '@nestjs/common';

export interface DAGNode {
  id: string;
  parents: string[];
  children: string[];
}

export type DAG = Map<string, DAGNode>;

interface ConnectionInput {
  fromAgentId: string;
  toAgentId: string;
}

export function buildDAG(
  agentIds: string[],
  connections: ConnectionInput[],
): DAG {
  const dag: DAG = new Map();

  for (const id of agentIds) {
    dag.set(id, { id, parents: [], children: [] });
  }

  for (const conn of connections) {
    const from = dag.get(conn.fromAgentId);
    const to = dag.get(conn.toAgentId);
    if (from && to) {
      from.children.push(conn.toAgentId);
      to.parents.push(conn.fromAgentId);
    }
  }

  return dag;
}

export function detectCycle(dag: DAG): boolean {
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(nodeId: string): boolean {
    if (inStack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;

    visited.add(nodeId);
    inStack.add(nodeId);

    const node = dag.get(nodeId);
    if (node) {
      for (const childId of node.children) {
        if (dfs(childId)) return true;
      }
    }

    inStack.delete(nodeId);
    return false;
  }

  for (const nodeId of dag.keys()) {
    if (dfs(nodeId)) return true;
  }

  return false;
}

export function topologicalSort(dag: DAG): string[] {
  if (detectCycle(dag)) {
    throw new BadRequestException(
      'Workflow has a circular dependency — fix connections in the canvas.',
    );
  }

  const inDegree = new Map<string, number>();
  for (const [id, node] of dag) {
    inDegree.set(id, node.parents.length);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    const node = dag.get(current);
    if (node) {
      for (const childId of node.children) {
        const newDegree = (inDegree.get(childId) ?? 1) - 1;
        inDegree.set(childId, newDegree);
        if (newDegree === 0) {
          queue.push(childId);
        }
      }
    }
  }

  return sorted;
}

export function getParentIds(dag: DAG, agentId: string): string[] {
  return dag.get(agentId)?.parents ?? [];
}
