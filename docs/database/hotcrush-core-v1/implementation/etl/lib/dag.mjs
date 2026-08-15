function sorted(values) {
  return [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

export function buildTargetLoadPlan(phaseManifest) {
  const nodes = sorted(phaseManifest.tables.map((table) => table.name));
  if (new Set(nodes).size !== nodes.length) throw new TypeError("duplicate_target_table");
  const nodeSet = new Set(nodes);
  const edges = phaseManifest.foreign_keys.map((foreignKey) => {
    if (!nodeSet.has(foreignKey.table) || !nodeSet.has(foreignKey.ref_table)) {
      throw new TypeError("unknown_target_fk_endpoint");
    }
    return {
      child_table: foreignKey.table,
      constraint_name: foreignKey.constraint_name,
      parent_table: foreignKey.ref_table,
    };
  }).sort((left, right) =>
    [left.parent_table, left.child_table, left.constraint_name].join("\0") <
    [right.parent_table, right.child_table, right.constraint_name].join("\0") ? -1 : 1
  );
  if (new Set(edges.map((edge) => edge.constraint_name)).size !== edges.length) {
    throw new TypeError("duplicate_target_fk_constraint");
  }

  const adjacency = new Map(nodes.map((node) => [node, new Set()]));
  for (const edge of edges) adjacency.get(edge.parent_table).add(edge.child_table);

  let nextIndex = 0;
  const indexByNode = new Map();
  const lowLink = new Map();
  const stack = [];
  const onStack = new Set();
  const rawComponents = [];
  const visit = (node) => {
    indexByNode.set(node, nextIndex);
    lowLink.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);
    for (const child of sorted(adjacency.get(node))) {
      if (!indexByNode.has(child)) {
        visit(child);
        lowLink.set(node, Math.min(lowLink.get(node), lowLink.get(child)));
      } else if (onStack.has(child)) {
        lowLink.set(node, Math.min(lowLink.get(node), indexByNode.get(child)));
      }
    }
    if (lowLink.get(node) === indexByNode.get(node)) {
      const component = [];
      while (true) {
        const member = stack.pop();
        onStack.delete(member);
        component.push(member);
        if (member === node) break;
      }
      rawComponents.push(sorted(component));
    }
  };
  for (const node of nodes) if (!indexByNode.has(node)) visit(node);

  const componentTables = rawComponents.sort((left, right) =>
    left.join("+") < right.join("+") ? -1 : 1
  );
  const tableToComponent = new Map();
  for (const tables of componentTables) {
    const id = tables.join("+");
    for (const table of tables) tableToComponent.set(table, id);
  }
  const componentParents = new Map(componentTables.map((tables) => [tables.join("+"), new Set()]));
  const componentChildren = new Map(componentTables.map((tables) => [tables.join("+"), new Set()]));
  const intra = new Map(componentTables.map((tables) => [tables.join("+"), []]));
  for (const edge of edges) {
    const parent = tableToComponent.get(edge.parent_table);
    const child = tableToComponent.get(edge.child_table);
    if (parent === child) {
      intra.get(parent).push(edge.constraint_name);
    } else {
      componentChildren.get(parent).add(child);
      componentParents.get(child).add(parent);
    }
  }

  const indegree = new Map([...componentParents].map(([id, parents]) => [id, parents.size]));
  const ready = sorted([...indegree].filter(([, degree]) => degree === 0).map(([id]) => id));
  const topo = [];
  while (ready.length > 0) {
    const id = ready.shift();
    topo.push(id);
    for (const child of sorted(componentChildren.get(id))) {
      indegree.set(child, indegree.get(child) - 1);
      if (indegree.get(child) === 0) {
        ready.push(child);
        ready.sort();
      }
    }
  }
  if (topo.length !== componentTables.length) throw new TypeError("condensation_graph_cycle");
  const wave = new Map();
  for (const id of topo) {
    const parents = [...componentParents.get(id)];
    wave.set(id, parents.length === 0 ? 0 : Math.max(...parents.map((parent) => wave.get(parent))) + 1);
  }
  const components = componentTables.map((tables) => {
    const componentId = tables.join("+");
    const intraConstraints = sorted(intra.get(componentId));
    const cyclic = tables.length > 1 || intraConstraints.length > 0;
    return {
      child_components: sorted(componentChildren.get(componentId)),
      component_id: componentId,
      cyclic,
      intra_constraints: intraConstraints,
      parent_components: sorted(componentParents.get(componentId)),
      requires_constraint_deferral: cyclic,
      tables,
      topo_rank: topo.indexOf(componentId),
      wave: wave.get(componentId),
    };
  });
  const uniquePairs = new Set(edges.map((edge) => `${edge.parent_table}\0${edge.child_table}`));
  const condensedPairs = new Set(edges
    .map((edge) => [tableToComponent.get(edge.parent_table), tableToComponent.get(edge.child_table)])
    .filter(([parent, child]) => parent !== child)
    .map(([parent, child]) => `${parent}\0${child}`));
  const maxWave = Math.max(...components.map((component) => component.wave));
  const waveCounts = Array.from({ length: maxWave + 1 }, (_, index) =>
    components.filter((component) => component.wave === index).length
  );
  return {
    active_foreign_keys: phaseManifest.foreign_keys.map((foreignKey) => ({
      columns: [...foreignKey.columns],
      constraint_name: foreignKey.constraint_name,
      deferrable: true,
      fk_activation: foreignKey.fk_activation,
      initially: "IMMEDIATE",
      match_type: foreignKey.match_type,
      origin: foreignKey.origin,
      ref_columns: [...foreignKey.ref_columns],
      ref_table: foreignKey.ref_table,
      table: foreignKey.table,
    })).sort((left, right) => compareForeignKeys(left, right)),
    components,
    deferred_declared_foreign_keys: [
      {
        activation: "EXTENSION_PACK:PROCUREMENT_AND_INVENTORY",
        column: "goods_receipt_line_id",
        table: "scm_supplier_price_observation",
      },
      {
        activation: "EXTENSION_PACK:PROCUREMENT_AND_INVENTORY",
        column: "purchase_order_line_id",
        table: "scm_supplier_price_observation",
      },
    ],
    metrics: {
      nodes: nodes.length,
      constraint_edges: edges.length,
      unique_table_pairs: uniquePairs.size,
      components: components.length,
      condensed_edges: condensedPairs.size,
      cyclic_components: components.filter((component) => component.cyclic).length,
      intra_component_constraints: components.reduce(
        (sum, component) => sum + component.intra_constraints.length,
        0,
      ),
      waves: waveCounts.length,
      wave_component_counts: waveCounts,
    },
  };
}

function compareForeignKeys(left, right) {
  const leftKey = [left.table, left.columns.join("\0"), left.ref_table, left.ref_columns.join("\0"), left.constraint_name].join("\0");
  const rightKey = [right.table, right.columns.join("\0"), right.ref_table, right.ref_columns.join("\0"), right.constraint_name].join("\0");
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}
