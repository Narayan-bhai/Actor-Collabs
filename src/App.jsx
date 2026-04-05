import React, { useEffect, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";

function App() {
  const [graphData, setGraphData] = useState(null);
  const [movie, setMovie] = useState("");
  const [recs, setRecs] = useState([]);

  useEffect(() => {
    fetch("http://localhost:5000/matrix")
      .then(res => res.json())
      .then(data => {
        const nodes = data.actors.map(a => ({ id: a }));
        const links = [];

        for (let i = 0; i < data.matrix.length; i++) {
          for (let j = i + 1; j < data.matrix.length; j++) {
            if (data.matrix[i][j] > 0) {
              links.push({
                source: data.actors[i],
                target: data.actors[j],
                value: data.matrix[i][j]
              });
            }
          }
        }

        setGraphData({ nodes, links });
      });
  }, []);

  const getRecs = () => {
    fetch(`http://localhost:5000/recommend?movie=${movie}`)
      .then(res => res.json())
      .then(setRecs);
  };

  if (!graphData) return <div>Loading...</div>;

  return (
    <div style={{ display: "flex" }}>
      <div style={{ width: 300 }}>
        <h2>🎬 Recommender</h2>

        <input
          value={movie}
          onChange={e => setMovie(e.target.value)}
          placeholder="Movie name"
        />

        <button onClick={getRecs}>Recommend</button>

        <ul>
          {recs.map((m, i) => (
            <li key={i}>{m.title} ({m.score})</li>
          ))}
        </ul>
      </div>

      <div style={{ flex: 1 }}>
        <ForceGraph2D graphData={graphData} />
      </div>
    </div>
  );
}

export default App;