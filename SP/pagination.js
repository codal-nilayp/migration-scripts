export async function fetchAll(client, query, path, variables = {}) {
    let results = [];
    let cursor = null;
  
    while (true) {
      const data = await client(query, {
        ...variables,
        first: 50,
        after: cursor
      });
  
      const conn = path.reduce((o, k) => o[k], data);
  
      results.push(...conn.edges.map(e => e.node));
  
      if (!conn.pageInfo.hasNextPage) break;
      cursor = conn.pageInfo.endCursor;
    }
  
    return results;
  }
  