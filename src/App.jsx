import React, { useEffect, useState, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
import "./App.css";

function App() {
  const fgRef = useRef();
  const [graphData, setGraphData] = useState(null);
  const [stats, setStats] = useState(null);
  const [clusters, setClusters] = useState({});
  const [highlightNodes, setHighlightNodes] = useState(new Set());
  const [highlightEdges, setHighlightEdges] = useState(new Set());
  const [dijkstraInput, setDijkstraInput] = useState({ from: "", to: "" });

  // Fetch graph from backend
  useEffect(() => {
    fetch("http://localhost:5000/matrix")
      .then(res => res.json())
      .then(data => {
        const { actors, matrix } = data;

        const allActors = actors; // ✅ Only backend actors
        const nodes = allActors.map(name => ({ id: name }));
        const links = [];
        const degrees = Array(allActors.length).fill(0);

        for (let i = 0; i < matrix.length; i++) {
          for (let j = i + 1; j < matrix.length; j++) {
            if (matrix[i][j] > 0) {
              links.push({
                source: allActors[i],
                target: allActors[j],
                value: matrix[i][j]
              });
              degrees[i] += 1;
              degrees[j] += 1;
            }
          }
        }

        // Stats
        const nodeStats = allActors.map((name, i) => ({
          name,
          collaborators: degrees[i] || 0
        }));
        nodeStats.sort((a, b) => b.collaborators - a.collaborators);

        setStats({
          totalActors: allActors.length,
          totalLinks: links.length,
          nodeStats
        });

        // Detect clusters
        const visited = {};
        const componentMap = {};
        let clusterId = 0;

        const adj = {};
        allActors.forEach(a => (adj[a] = {}));

        links.forEach(l => {
          adj[l.source][l.target] = 1;
          adj[l.target][l.source] = 1;
        });

        const dfs = node => {
          visited[node] = true;
          componentMap[node] = clusterId;
          Object.keys(adj[node]).forEach(neighbor => {
            if (!visited[neighbor]) dfs(neighbor);
          });
        };

        allActors.forEach(a => {
          if (!visited[a]) {
            dfs(a);
            clusterId++;
          }
        });

        setClusters(componentMap);
        nodes.forEach(n => (n.cluster = componentMap[n.id] ?? 0));

        setGraphData({ nodes, links, matrix });
      })
      .catch(err => console.error(err));
  }, []);

  if (!graphData) return <div className="loading">Loading graph...</div>;

  // Cluster colors
  const distinctColors = [
    "#e6194b","#3cb44b","#ffe119","#4363d8","#f58231","#911eb4","#46f0f0",
    "#f032e6","#bcf60c","#fabebe","#008080","#e6beff","#9a6324","#fffac8",
    "#800000","#aaffc3","#808000","#ffd8b1","#000075","#808080"
  ];

  const clusterColors = {};
  graphData.nodes.forEach(n => {
    if (!clusterColors[n.cluster]) {
      clusterColors[n.cluster] =
        distinctColors[n.cluster % distinctColors.length];
    }
  });

  // Highlight functions
  const highlightTopCollaborators = () => {
    const topNodes = stats.nodeStats.slice(0, 5).map(n => n.name);
    setHighlightNodes(new Set(topNodes));
    setHighlightEdges(new Set());
  };

  const highlightLargestCluster = () => {
    const clusterCounts = {};
    Object.values(clusters).forEach(c => {
      clusterCounts[c] = (clusterCounts[c] || 0) + 1;
    });

    const largestClusterId = Number(
      Object.entries(clusterCounts).sort((a, b) => b[1] - a[1])[0][0]
    );

    const clusterNodes = graphData.nodes
      .filter(n => n.cluster === largestClusterId)
      .map(n => n.id);

    setHighlightNodes(new Set(clusterNodes));
    setHighlightEdges(new Set());
  };

  const resetHighlight = () => {
    setHighlightNodes(new Set());
    setHighlightEdges(new Set());
  };

  // Dijkstra
  const dijkstra = (fromInput, toInput) => {
    if (!fromInput || !toInput) return null;

    const nodeMap = {};
    graphData.nodes.forEach(
      n => (nodeMap[n.id.trim().toLowerCase()] = n.id)
    );

    const from = nodeMap[fromInput.trim().toLowerCase()];
    const to = nodeMap[toInput.trim().toLowerCase()];

    if (!from || !to) {
      alert("Actor names not found");
      return null;
    }

    const adj = {};
    graphData.nodes.forEach(n => (adj[n.id] = {}));

    graphData.links.forEach(l => {
      const src =
        typeof l.source === "object" ? l.source.id : l.source;
      const tgt =
        typeof l.target === "object" ? l.target.id : l.target;

      const weight = 1 / (1 + (l.value || 1));
      adj[src][tgt] = weight;
      adj[tgt][src] = weight;
    });

    const dist = {};
    const prev = {};

    graphData.nodes.forEach(n => (dist[n.id] = Infinity));
    dist[from] = 0;

    const Q = new Set(graphData.nodes.map(n => n.id));

    while (Q.size) {
      let u = null;
      Q.forEach(node => {
        if (u === null || dist[node] < dist[u]) u = node;
      });

      if (u === to) break;

      Q.delete(u);

      for (const v in adj[u]) {
        if (!Q.has(v)) continue;
        const alt = dist[u] + adj[u][v];
        if (alt < dist[v]) {
          dist[v] = alt;
          prev[v] = u;
        }
      }
    }

    const pathNodes = [];
    const pathEdges = new Set();

    let u = to;
    while (u !== undefined) {
      pathNodes.unshift(u);
      if (prev[u] !== undefined) {
        pathEdges.add(`${prev[u]}___${u}`);
      }
      u = prev[u];
    }

    if (pathNodes[0] !== from) {
      alert("No path found between these actors");
      return null;
    }

    return { nodes: pathNodes, edges: pathEdges };
  };

  const runDijkstra = () => {
    const result = dijkstra(
      dijkstraInput.from,
      dijkstraInput.to
    );
    if (result) {
      setHighlightNodes(new Set(result.nodes));
      setHighlightEdges(result.edges);
    }
  };

  return (
    <div id="container">
      <div id="sidebar">
        <h2>Graph Stats & Functions</h2>

        {stats && (
          <>
            <p><b>Total Actors:</b> {stats.totalActors}</p>
            <p><b>Total Collaborations:</b> {stats.totalLinks}</p>

            <h3>Functions</h3>
            <button onClick={highlightTopCollaborators}>
              Top Collaborators
            </button>
            <button onClick={highlightLargestCluster}>
              Largest Cluster
            </button>
            <button onClick={resetHighlight}>
              Reset Highlight
            </button>

            <h3>Dijkstra Shortest Path</h3>
            <input
              placeholder="From Actor"
              value={dijkstraInput.from}
              onChange={e =>
                setDijkstraInput({
                  ...dijkstraInput,
                  from: e.target.value
                })
              }
            />
            <input
              placeholder="To Actor"
              value={dijkstraInput.to}
              onChange={e =>
                setDijkstraInput({
                  ...dijkstraInput,
                  to: e.target.value
                })
              }
            />
            <button onClick={runDijkstra}>
              Compute Path
            </button>
          </>
        )}
      </div>

      <div id="graph-container">
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          nodeLabel="id"
          nodeAutoColorBy={null}
          linkWidth={link => {
            const src =
              typeof link.source === "object"
                ? link.source.id
                : link.source;
            const tgt =
              typeof link.target === "object"
                ? link.target.id
                : link.target;

            return highlightEdges.has(`${src}___${tgt}`) ||
              highlightEdges.has(`${tgt}___${src}`)
              ? 3
              : Math.sqrt(link.value || 1);
          }}
          linkColor={link => {
            const src =
              typeof link.source === "object"
                ? link.source.id
                : link.source;
            const tgt =
              typeof link.target === "object"
                ? link.target.id
                : link.target;

            const srcCluster = clusters[src] ?? 0;

            return highlightEdges.has(`${src}___${tgt}`) ||
              highlightEdges.has(`${tgt}___${src}`)
              ? "#ffff00"
              : clusterColors[srcCluster] || "#aaa";
          }}
          linkDirectionalParticles={0}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          cooldownTicks={300}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const fontSize = 12 / globalScale;
            const baseColor =
              clusterColors[clusters[node.id]] || "#888";

            ctx.fillStyle = highlightNodes.has(node.id)
              ? "#ff9900"
              : baseColor;

            ctx.beginPath();
            ctx.arc(node.x, node.y, 5, 0, 2 * Math.PI, false);
            ctx.fill();

            ctx.font = `${fontSize}px Arial`;
            ctx.fillStyle = "#ffffff";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(node.id, node.x, node.y - 10);
          }}
        />
      </div>
    </div>
  );
}

export default App;