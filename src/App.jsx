import React, { useEffect, useState, useRef, useCallback } from "react";
import ForceGraph2D from "react-force-graph-2d";
import "./App.css";

// ── Genre color palette ────────────────────────────────────────────────────
const GENRE_COLORS = {
  Action: "#c0392b",
  Adventure: "#d35400",
  Animation: "#16a085",
  Biography: "#8e6b3e",
  Comedy: "#b8860b",
  Crime: "#6c3483",
  Documentary: "#1a6b4a",
  Drama: "#2471a3",
  Family: "#cb4e8c",
  Fantasy: "#7d3c98",
  History: "#a04000",
  Horror: "#943126",
  Music: "#117a8b",
  Mystery: "#4a235a",
  Romance: "#a93226",
  "Sci-Fi": "#1a5276",
  Sport: "#1e8449",
  Thriller: "#922b21",
  War: "#616a6b",
  Western: "#7e5109",
  Unknown: "#888888",
};

function genreColor(genre) {
  return GENRE_COLORS[genre] || GENRE_COLORS.Unknown;
}

export default function App() {
  const [graphData, setGraphData] = useState(null);
  const [movie, setMovie] = useState("");
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [graphLoading, setGraphLoading] = useState(true);
  const [error, setError] = useState("");
  const [allMovies, setAllMovies] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [showSug, setShowSug] = useState(false);
  const [tooltip, setTooltip] = useState(null); // { x, y, node }
  const [visibleGenres, setVisibleGenres] = useState([]);

  // ── Genre filter state ─────────────────────────────────────────────────────
  // Stored in both React state (for legend UI re-render) and a ref
  // (so stable canvas callbacks can read the current value without rebuilding).
  const [selectedGenre, setSelectedGenre] = useState(null);
  const selectedGenreRef = useRef(null);

  // Keep ref in sync with state
  const updateSelectedGenre = useCallback((genre) => {
    selectedGenreRef.current = genre;
    setSelectedGenre(genre);
    // Clear any node/link highlights when switching genre filter
    highlightNodesRef.current = new Set();
    highlightLinksRef.current = new Set();
  }, []);

  // ── Hover/click highlight refs (stable, no rebuild) ────────────────────────
  const highlightNodesRef = useRef(new Set());
  const highlightLinksRef = useRef(new Set());
  const graphRef = useRef();
  const hoveredRef = useRef(null);

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("http://localhost:5000/movies")
      .then((r) => r.json())
      .then(setAllMovies)
      .catch(() => {});

    fetch("http://localhost:5000/matrix")
      .then((r) => r.json())
      .then((data) => {
        setGraphData(data);
        const genres = [...new Set((data.nodes || []).map((n) => n.genre))]
          .filter(Boolean)
          .sort();
        setVisibleGenres(genres);
        setGraphLoading(false);
      })
      .catch(() => setGraphLoading(false));
  }, []);

  // ── Tune d3 forces once graph is ready ────────────────────────────────────
  useEffect(() => {
    if (!graphData || !graphRef.current) return;
    const fg = graphRef.current;

    fg.d3Force("charge").strength(-180);
    fg.d3Force("link")
      .distance((link) => {
        const w = link.value || 1;
        return w > 2 ? 30 : 80;
      })
      .iterations(2);
    if (fg.d3Force("collision")) {
      fg.d3Force("collision").radius((node) => nodeRadius(node, false) + 3);
    }
    fg.d3Force("x") && fg.d3Force("x").strength(0.04);
    fg.d3Force("y") && fg.d3Force("y").strength(0.04);

    fg.d3ReheatSimulation();
  }, [graphData]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  // Pass `highlighted` to give selected-genre nodes a larger radius
  const nodeRadius = (node, highlighted = false) => {
    const base = Math.max(
      4,
      Math.min(14, 3 + Math.sqrt(node.degree || 1) * 1.6),
    );
    return highlighted ? base * 1.6 : base;
  };

  // ── Autocomplete ───────────────────────────────────────────────────────────
  const handleInput = (e) => {
    const val = e.target.value;
    setMovie(val);
    if (val.length < 2) {
      setSuggestions([]);
      setShowSug(false);
      return;
    }
    const hits = allMovies
      .filter((m) => m.toLowerCase().includes(val.toLowerCase()))
      .slice(0, 7);
    setSuggestions(hits);
    setShowSug(hits.length > 0);
  };

  const pickSuggestion = (name) => {
    setMovie(name);
    setSuggestions([]);
    setShowSug(false);
  };

  // ── Recommend ──────────────────────────────────────────────────────────────
  const getRecs = async () => {
    if (!movie.trim()) return;
    setLoading(true);
    setError("");
    setRecs([]);
    try {
      const res = await fetch(
        `http://localhost:5000/recommend?movie=${encodeURIComponent(movie)}`,
      );
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

  // ── Graph: node draw ───────────────────────────────────────────────────────
  // Reads selectedGenreRef (not state) so this callback stays stable.
  const nodeCanvasObject = useCallback((node, ctx, globalScale) => {
    const genre = selectedGenreRef.current;
    const isGenreHL = genre !== null;
    const matchesGenre = node.genre === genre;

    // Node highlight from click interaction
    const hasHL = highlightNodesRef.current.size > 0;
    const isHL = highlightNodesRef.current.has(node.id);
    const clickDim = hasHL && !isHL;

    const isHovered = hoveredRef.current?.id === node.id;

    // Radius: enlarge genre-highlighted nodes
    const r = nodeRadius(node, isGenreHL && matchesGenre);

    // Opacity logic:
    //  - genre filter active + node doesn't match → very dim
    //  - click highlight active + node not highlighted → very dim
    //  - otherwise full opacity
    let alpha = 1;
    if (isGenreHL && !matchesGenre) alpha = 0.12;
    else if (clickDim) alpha = 0.1;

    const color = genreColor(node.genre);

    ctx.save();
    ctx.globalAlpha = alpha;

    // Fill
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = isHovered ? "#ffffff" : color;
    ctx.fill();

    // Border — bright white ring for genre-highlighted nodes
    const isBright = (isGenreHL && matchesGenre) || isHL || isHovered;
    ctx.strokeStyle = isHovered ? color : isBright ? "#fff" : "#1b5e20";
    ctx.lineWidth = isBright ? 2.5 / globalScale : 1 / globalScale;
    ctx.stroke();

    // Label: always on hover, or when zoomed in, or when genre-selected
    if (isHovered || globalScale > 3 || (isGenreHL && matchesGenre)) {
      const fs = Math.max(3, 9 / globalScale);
      ctx.globalAlpha = isGenreHL && !matchesGenre ? 0 : 1;
      ctx.font = `bold ${fs}px Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const lw = ctx.measureText(node.id).width;
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillRect(node.x - lw / 2 - 1, node.y + r + 1, lw + 2, fs + 2);
      ctx.fillStyle = "#111";
      ctx.fillText(node.id, node.x, node.y + r + 2);
    }

    ctx.restore();
  }, []); // stable: reads refs only

  // ── Graph: link draw ───────────────────────────────────────────────────────
  const linkCanvasObject = useCallback((link, ctx) => {
    const sx = typeof link.source === "object" ? link.source.x : 0;
    const sy = typeof link.source === "object" ? link.source.y : 0;
    const tx = typeof link.target === "object" ? link.target.x : 0;
    const ty = typeof link.target === "object" ? link.target.y : 0;

    const genre = selectedGenreRef.current;
    const srcGenre = typeof link.source === "object" ? link.source.genre : null;
    const tgtGenre = typeof link.target === "object" ? link.target.genre : null;

    // A link is genre-relevant if at least one endpoint matches the selected genre
    const genreRelevant =
      genre === null || srcGenre === genre || tgtGenre === genre;

    const hasHL = highlightLinksRef.current.size > 0;
    const isHL = highlightLinksRef.current.has(link);
    const clickDim = hasHL && !isHL;

    let alpha;
    if (genre !== null && !genreRelevant)
      alpha = 0.04; // fade unrelated links
    else if (clickDim) alpha = 0.04;
    else if (isHL) alpha = 0.9;
    else alpha = 0.25;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = isHL ? "#f57f17" : "#81c784";
    ctx.lineWidth = isHL
      ? Math.min((link.value || 1) * 1.2, 4)
      : Math.min((link.value || 1) * 0.5, 1.5);

    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.restore();
  }, []); // stable: reads refs only

  // ── Graph: interactions ────────────────────────────────────────────────────
  const handleNodeHover = useCallback((node, prevNode, evt) => {
    hoveredRef.current = node || null;
    if (node && evt) {
      setTooltip({ x: evt.clientX, y: evt.clientY, node });
    } else {
      setTooltip(null);
    }
  }, []);

  const handleNodeClick = useCallback(
    (node) => {
      if (!node || !graphData) return;
      const newNodes = new Set([node.id]);
      const newLinks = new Set();
      graphData.links.forEach((link) => {
        const src =
          typeof link.source === "object" ? link.source.id : link.source;
        const tgt =
          typeof link.target === "object" ? link.target.id : link.target;
        if (src === node.id || tgt === node.id) {
          newLinks.add(link);
          newNodes.add(src === node.id ? tgt : src);
        }
      });
      highlightNodesRef.current = newNodes;
      highlightLinksRef.current = newLinks;
    },
    [graphData],
  );

  const handleBgClick = useCallback(() => {
    highlightNodesRef.current = new Set();
    highlightLinksRef.current = new Set();
    // Also clear genre filter on background click
    updateSelectedGenre(null);
  }, [updateSelectedGenre]);

  // ── Genre row click ────────────────────────────────────────────────────────
  const handleGenreClick = (genre) => {
    // Toggle: clicking same genre again resets
    updateSelectedGenre(selectedGenre === genre ? null : genre);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div id="app">
      <div id="header">
        <h1>Movie Recommender</h1>
      </div>

      <div id="main">
        <div id="sidebar">
          <div className="box">
            <h2>Find Recommendations</h2>

            <div id="search-wrap">
              <input
                id="movie-input"
                type="text"
                value={movie}
                onChange={handleInput}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setShowSug(false);
                    getRecs();
                  }
                }}
                placeholder="Enter movie name..."
              />
              {showSug && suggestions.length > 0 && (
                <ul id="suggestions">
                  {suggestions.map((s) => (
                    <li key={s} onMouseDown={() => pickSuggestion(s)}>
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button
              id="rec-btn"
              onClick={getRecs}
              disabled={loading || !movie.trim()}
            >
              {loading ? "Loading..." : "Get Recommendations"}
            </button>

            {error && <p className="error-msg">{error}</p>}
          </div>

          {recs.length > 0 && (
            <div className="box" id="results-box">
              <h2>
                Results for: <em>{movie}</em>
              </h2>
              <p className="result-count">{recs.length} movies found</p>

              <div id="rec-list">
                {recs.map((m, i) => (
                  <div className="rec-card" key={m.title}>
                    <div className="rec-rank">#{i + 1}</div>

                    <div className="rec-poster">
                      {m.poster ? (
                        <img
                          src={m.poster}
                          alt={m.title}
                          onError={(e) => {
                            e.target.style.display = "none";
                          }}
                        />
                      ) : (
                        <div className="no-poster">No Image</div>
                      )}
                    </div>

                    <div className="rec-info">
                      <div className="rec-title">{m.title}</div>

                      {m.rating > 0 && (
                        <div className="rec-rating">
                          IMDb: {m.rating.toFixed(1)}
                        </div>
                      )}

                      {/* ✅ SCORE = YELLOW */}
                      <div className="rec-score">Score: {m.score}</div>

                      {/* ✅ GENRE = DYNAMIC COLOR */}
                      {m.genre && (
                        <div
                          className="rec-genre"
                          style={{
                            color: genreColor(m.genre),
                          }}
                        >
                          {m.genre}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {visibleGenres.length > 0 && (
            <div className="box" id="legend-box">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <h2 style={{ margin: 0 }}>Genre Colors</h2>
                {selectedGenre && (
                  <button
                    id="genre-reset-btn"
                    onClick={() => updateSelectedGenre(null)}
                    title="Clear genre filter"
                  >
                    ✕ Reset
                  </button>
                )}
              </div>
              {selectedGenre && (
                <p className="genre-filter-hint">
                  Showing:{" "}
                  <strong style={{ color: genreColor(selectedGenre) }}>
                    {selectedGenre}
                  </strong>
                </p>
              )}
              <div id="legend-grid">
                {visibleGenres.map((g) => (
                  <div
                    key={g}
                    className={`legend-item ${selectedGenre === g ? "legend-item--active" : ""}`}
                    onClick={() => handleGenreClick(g)}
                    title={`Filter graph by ${g}`}
                  >
                    <span
                      className="legend-swatch"
                      style={{ background: genreColor(g) }}
                    />
                    <span className="legend-label">{g}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div id="graph-panel">
          <div
            id="graph-wrap"
            onMouseMove={(e) => {
              if (tooltip)
                setTooltip((t) =>
                  t ? { ...t, x: e.clientX, y: e.clientY } : null,
                );
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
        </div>
      </div>

      {tooltip && tooltip.node && (
        <div
          id="node-tooltip"
          style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}
        >
          <strong>{tooltip.node.id}</strong>
          {tooltip.node.rating > 0 && (
            <div>⭐ IMDb: {tooltip.node.rating.toFixed(1)}</div>
          )}
          <div
            style={{
              color: genreColor(tooltip.node.genre),
              fontWeight: "bold",
              marginTop: 2,
            }}
          >
            {tooltip.node.genre}
          </div>
        </div>
      )}
    </div>
  );
}
