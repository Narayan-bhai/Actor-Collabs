import React, { useEffect, useState, useRef, useCallback } from "react";
import ForceGraph2D from "react-force-graph-2d";
import "./App.css";

// ── Genre color palette (muted, simple, no gradients) ─────────────────────
const GENRE_COLORS = {
  Action:      "#c0392b",
  Adventure:   "#d35400",
  Animation:   "#16a085",
  Biography:   "#8e6b3e",
  Comedy:      "#b8860b",
  Crime:       "#6c3483",
  Documentary: "#1a6b4a",
  Drama:       "#2471a3",
  Family:      "#cb4e8c",
  Fantasy:     "#7d3c98",
  History:     "#a04000",
  Horror:      "#943126",
  Music:       "#117a8b",
  Mystery:     "#4a235a",
  Romance:     "#a93226",
  "Sci-Fi":    "#1a5276",
  Sport:       "#1e8449",
  Thriller:    "#922b21",
  War:         "#616a6b",
  Western:     "#7e5109",
  Unknown:     "#888888",
};

function genreColor(genre) {
  return GENRE_COLORS[genre] || GENRE_COLORS.Unknown;
}

export default function App() {
  const [graphData, setGraphData]         = useState(null);
  const [movie, setMovie]                 = useState("");
  const [recs, setRecs]                   = useState([]);
  const [loading, setLoading]             = useState(false);
  const [graphLoading, setGraphLoading]   = useState(true);
  const [error, setError]                 = useState("");
  const [allMovies, setAllMovies]         = useState([]);
  const [suggestions, setSuggestions]     = useState([]);
  const [showSug, setShowSug]             = useState(false);
  const [tooltip, setTooltip]             = useState(null);   // { x, y, node }
  const [visibleGenres, setVisibleGenres] = useState([]);

  // Use refs for highlight state so canvas callbacks stay stable
  const highlightNodesRef = useRef(new Set());
  const highlightLinksRef = useRef(new Set());
  const graphRef          = useRef();
  const hoveredRef        = useRef(null);

  // ── load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("http://localhost:5000/movies")
      .then(r => r.json())
      .then(setAllMovies)
      .catch(() => {});

    fetch("http://localhost:5000/matrix")
      .then(r => r.json())
      .then(data => {
        setGraphData(data);
        const genres = [...new Set((data.nodes || []).map(n => n.genre))].filter(Boolean).sort();
        setVisibleGenres(genres);
        setGraphLoading(false);
      })
      .catch(() => setGraphLoading(false));
  }, []);

  // ── tune d3 forces once graph is ready ────────────────────────────────────
  useEffect(() => {
    if (!graphData || !graphRef.current) return;
    const fg = graphRef.current;

    // Strong repulsion → clusters spread apart naturally
    fg.d3Force("charge").strength(-180);
    // Link distance scaled by weight (weak links stretch further → separates clusters)
    fg.d3Force("link").distance(link => {
      const w = link.value || 1;
      return w > 2 ? 30 : 80;   // tight inside cluster, loose between
    }).iterations(2);
    // Collision radius so nodes don't pile up
    if (fg.d3Force("collision")) {
      fg.d3Force("collision").radius(node => nodeRadius(node) + 3);
    }
    // Weak center gravity keeps it from flying off screen
    fg.d3Force("x") && fg.d3Force("x").strength(0.04);
    fg.d3Force("y") && fg.d3Force("y").strength(0.04);

    fg.d3ReheatSimulation();
  }, [graphData]);

  // ── helpers ────────────────────────────────────────────────────────────────
  const nodeRadius = node => Math.max(4, Math.min(14, 3 + Math.sqrt(node.degree || 1) * 1.6));

  // ── autocomplete ───────────────────────────────────────────────────────────
  const handleInput = e => {
    const val = e.target.value;
    setMovie(val);
    if (val.length < 2) { setSuggestions([]); setShowSug(false); return; }
    const hits = allMovies.filter(m => m.toLowerCase().includes(val.toLowerCase())).slice(0, 7);
    setSuggestions(hits);
    setShowSug(hits.length > 0);
  };

  const pickSuggestion = name => {
    setMovie(name);
    setSuggestions([]);
    setShowSug(false);
  };

  // ── recommend ──────────────────────────────────────────────────────────────
  const getRecs = async () => {
    if (!movie.trim()) return;
    setLoading(true);
    setError("");
    setRecs([]);
    try {
      const res  = await fetch(`http://localhost:5000/recommend?movie=${encodeURIComponent(movie)}`);
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        setError("Movie not found. Check the title and try again.");
      } else {
        setRecs(data);
      }
    } catch {
      setError("Cannot reach server. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  // ── graph: node draw ───────────────────────────────────────────────────────
  const nodeCanvasObject = useCallback((node, ctx, globalScale) => {
    const r          = nodeRadius(node);
    const isHovered  = hoveredRef.current?.id === node.id;
    const hasHL      = highlightNodesRef.current.size > 0;
    const isHL       = highlightNodesRef.current.has(node.id);
    const dimmed     = hasHL && !isHL;
    const color      = genreColor(node.genre);

    ctx.save();
    ctx.globalAlpha = dimmed ? 0.1 : 1;

    // Fill
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = isHovered ? "#ffffff" : color;
    ctx.fill();

    // Border — thicker when highlighted / hovered
    ctx.strokeStyle = isHovered ? color : (isHL ? "#fff" : "#1b5e20");
    ctx.lineWidth   = (isHovered || isHL) ? 2.5 / globalScale : 1 / globalScale;
    ctx.stroke();

    // Label — always show when hovered, or at high zoom
    if (isHovered || globalScale > 3) {
      const fs = Math.max(3, 9 / globalScale);
      ctx.globalAlpha = dimmed ? 0 : 1;
      ctx.font = `bold ${fs}px Arial`;
      ctx.fillStyle = "#111";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      // white background stripe for readability
      const lw = ctx.measureText(node.id).width;
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillRect(node.x - lw / 2 - 1, node.y + r + 1, lw + 2, fs + 2);
      ctx.fillStyle = "#111";
      ctx.fillText(node.id, node.x, node.y + r + 2);
    }

    ctx.restore();
  }, []); // stable: reads refs, not state

  // ── graph: link draw ───────────────────────────────────────────────────────
  const linkCanvasObject = useCallback((link, ctx) => {
    const sx = typeof link.source === "object" ? link.source.x : 0;
    const sy = typeof link.source === "object" ? link.source.y : 0;
    const tx = typeof link.target === "object" ? link.target.x : 0;
    const ty = typeof link.target === "object" ? link.target.y : 0;

    const hasHL  = highlightLinksRef.current.size > 0;
    const isHL   = highlightLinksRef.current.has(link);
    const dimmed = hasHL && !isHL;

    ctx.save();
    ctx.globalAlpha  = dimmed ? 0.04 : isHL ? 0.9 : 0.25;
    ctx.strokeStyle  = isHL ? "#f57f17" : "#81c784";
    ctx.lineWidth    = isHL
      ? Math.min((link.value || 1) * 1.2, 4)
      : Math.min((link.value || 1) * 0.5, 1.5);

    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.restore();
  }, []);

  // ── graph: interactions ────────────────────────────────────────────────────
  const handleNodeHover = useCallback((node, prevNode, evt) => {
    hoveredRef.current = node || null;
    if (node && evt) {
      setTooltip({ x: evt.clientX, y: evt.clientY, node });
    } else {
      setTooltip(null);
    }
  }, []);

  const handleNodeClick = useCallback((node) => {
    if (!node || !graphData) return;
    const newNodes = new Set([node.id]);
    const newLinks = new Set();
    graphData.links.forEach(link => {
      const src = typeof link.source === "object" ? link.source.id : link.source;
      const tgt = typeof link.target === "object" ? link.target.id : link.target;
      if (src === node.id || tgt === node.id) {
        newLinks.add(link);
        newNodes.add(src === node.id ? tgt : src);
      }
    });
    highlightNodesRef.current = newNodes;
    highlightLinksRef.current = newLinks;
  }, [graphData]);

  const handleBgClick = useCallback(() => {
    highlightNodesRef.current = new Set();
    highlightLinksRef.current = new Set();
  }, []);

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div id="app">

      {/* ── header ── */}
      <div id="header">
        <h1>🎬 Movie Recommender</h1>
        <p>Based on actor collaboration network (IMDb Top 1000)</p>
      </div>

      <div id="main">

        {/* ── sidebar ── */}
        <div id="sidebar">

          <div className="box">
            <h2>Find Recommendations</h2>

            <div id="search-wrap">
              <input
                id="movie-input"
                type="text"
                value={movie}
                onChange={handleInput}
                onKeyDown={e => { if (e.key === "Enter") { setShowSug(false); getRecs(); } }}
                placeholder="Enter movie name..."
              />
              {showSug && suggestions.length > 0 && (
                <ul id="suggestions">
                  {suggestions.map(s => (
                    <li key={s} onMouseDown={() => pickSuggestion(s)}>{s}</li>
                  ))}
                </ul>
              )}
            </div>

            <button id="rec-btn" onClick={getRecs} disabled={loading || !movie.trim()}>
              {loading ? "Loading..." : "Get Recommendations"}
            </button>

            {error && <p className="error-msg">{error}</p>}
          </div>

          {/* ── results ── */}
          {recs.length > 0 && (
            <div className="box" id="results-box">
              <h2>Results for: <em>{movie}</em></h2>
              <p className="result-count">{recs.length} movies found</p>

              <div id="rec-list">
                {recs.map((m, i) => (
                  <div className="rec-card" key={m.title}>
                    <div className="rec-rank">#{i + 1}</div>
                    <div className="rec-poster">
                      {m.poster
                        ? <img src={m.poster} alt={m.title} onError={e => { e.target.style.display = "none"; }} />
                        : <div className="no-poster">No Image</div>
                      }
                    </div>
                    <div className="rec-info">
                      <div className="rec-title">{m.title}</div>
                      {m.rating > 0 && <div className="rec-rating">IMDb: {m.rating.toFixed(1)}</div>}
                      <div className="rec-score">Score: {m.score}</div>
                      {m.genre && <div className="rec-genre">{m.genre}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── info box ── */}
          {recs.length === 0 && !loading && (
            <div className="box" id="info-box">
              <h2>How it works</h2>
              <ul>
                <li>Type a movie name above</li>
                <li>The system finds actors from that movie</li>
                <li>It scores other movies based on shared actors</li>
                <li>Top matches are shown as recommendations</li>
              </ul>
              <p style={{ marginTop: 12, color: "#555", fontSize: 13 }}>
                Dataset: IMDb Top 1000 movies<br />
                Graph: top 200 actors, colored by genre
              </p>
            </div>
          )}

          {/* ── genre legend ── */}
          {visibleGenres.length > 0 && (
            <div className="box" id="legend-box">
              <h2>Genre Colors</h2>
              <div id="legend-grid">
                {visibleGenres.map(g => (
                  <div key={g} className="legend-item">
                    <span className="legend-swatch" style={{ background: genreColor(g) }} />
                    <span className="legend-label">{g}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* ── graph panel ── */}
        <div id="graph-panel">
          <div id="graph-header">
            <strong>Actor Collaboration Graph</strong>
            <span id="graph-hint">Scroll to zoom &nbsp;|&nbsp; Click node to highlight neighbors &nbsp;|&nbsp; Click bg to reset</span>
          </div>

          <div
            id="graph-wrap"
            onMouseMove={e => {
              if (tooltip) setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null);
            }}
          >
            {graphLoading ? (
              <div id="graph-loading">Loading graph...</div>
            ) : graphData ? (
              <ForceGraph2D
                ref={graphRef}
                graphData={graphData}
                nodeCanvasObject={nodeCanvasObject}
                linkCanvasObject={linkCanvasObject}
                nodeLabel={() => ""}
                onNodeHover={handleNodeHover}
                onNodeClick={handleNodeClick}
                onBackgroundClick={handleBgClick}
                cooldownTicks={150}
                d3AlphaDecay={0.012}
                d3VelocityDecay={0.38}
                backgroundColor="#f9f9f9"
                enableZoomInteraction={true}
              />
            ) : (
              <div id="graph-loading" style={{ color: "red" }}>
                Could not load graph. Is the backend running on port 5000?
              </div>
            )}
          </div>

          <div id="graph-legend-bar">
            <span className="legend-dot-bar"></span> Actor node (size = collaborations) &nbsp;&nbsp;
            <span className="legend-line-bar"></span> Collaborated together &nbsp;&nbsp;
            <span style={{ color: "#f57f17" }}>■</span> Highlighted link
          </div>
        </div>

      </div>

      {/* ── hover tooltip ── */}
      {tooltip && tooltip.node && (
        <div
          id="node-tooltip"
          style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}
        >
          <strong>{tooltip.node.id}</strong>
          <div>🎬 {tooltip.node.movieCount} movie{tooltip.node.movieCount !== 1 ? "s" : ""}</div>
          <div>🤝 {tooltip.node.degree} collaborator{tooltip.node.degree !== 1 ? "s" : ""}</div>
          <div style={{ color: genreColor(tooltip.node.genre), fontWeight: "bold", marginTop: 2 }}>
            {tooltip.node.genre}
          </div>
        </div>
      )}

      {/* ── footer ── */}
      <div id="footer">
        Actor Collaboration Network &mdash; Built with React + Node.js &mdash; Dataset: IMDb Top 1000
      </div>

    </div>
  );
}